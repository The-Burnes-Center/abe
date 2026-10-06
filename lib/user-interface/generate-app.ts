import * as cdk from "aws-cdk-lib";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

/** CloudFront-scoped WAF web ACLs can only be created in us-east-1. */
const WAF_REGION = "us-east-1";

export interface WebsiteProps {
  readonly websiteBucket: s3.Bucket;
  // Optional custom domain (CloudFront alternate domain name) + its ACM cert ARN
  // (us-east-1). Both must be set for the domain to be bound to the distribution.
  readonly customDomain?: string;
  readonly certificateArn?: string;
}

export class Website extends Construct {
    readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: WebsiteProps) {
    super(scope, id);

    /////////////////////////////////////
    ///// WAF WEB ACL                /////
    /////////////////////////////////////

    // A CLOUDFRONT-scoped web ACL must live in us-east-1. Stacks in any other
    // region deploy without it (and say so at synth) rather than failing.
    const region = cdk.Stack.of(this).region;
    const createWaf = !cdk.Token.isUnresolved(region) && region === WAF_REGION;
    if (!createWaf) {
      cdk.Annotations.of(this).addWarningV2(
        "abe:waf-skipped",
        `CloudFront WAF not created: it requires the stack to be deployed in ${WAF_REGION} (stack region: ${cdk.Token.isUnresolved(region) ? "unresolved" : region}).`,
      );
    }
    const webAcl = createWaf ? new wafv2.CfnWebACL(this, "WebACL", {
      defaultAction: { allow: {} },
      scope: "CLOUDFRONT",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "CloudFrontWebACL",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWSManagedRulesCommonRuleSet",
          priority: 10,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesCommonRuleSet",
              vendorName: "AWS",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesCommonRuleSet",
          },
        },
        {
          name: "AWSManagedRulesAmazonIpReputationList",
          priority: 20,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesAmazonIpReputationList",
              vendorName: "AWS",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesAmazonIpReputationList",
          },
        },
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet",
          priority: 30,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesKnownBadInputsRuleSet",
              vendorName: "AWS",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "AWSManagedRulesKnownBadInputsRuleSet",
          },
        },
        {
          name: "RateLimitPerIP",
          priority: 40,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: "RateLimitPerIP",
          },
        },
      ],
    }) : undefined;

    /////////////////////////////////////
    ///// SECURITY HEADERS           /////
    /////////////////////////////////////

    // The CSP is report-only for now: violations show in the browser console
    // without blocking anything. connect-src uses region wildcards for the
    // API Gateway endpoints because the API's CORS origin depends on this
    // distribution, so referencing the exact API URLs here would be circular.
    const awsRegion = cdk.Aws.REGION;
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      `img-src 'self' data: blob: https://*.s3.amazonaws.com https://*.s3.${awsRegion}.amazonaws.com`,
      `connect-src 'self' https://cognito-idp.${awsRegion}.amazonaws.com https://*.execute-api.${awsRegion}.amazonaws.com wss://*.execute-api.${awsRegion}.amazonaws.com https://*.s3.amazonaws.com https://*.s3.${awsRegion}.amazonaws.com wss://transcribestreaming.${awsRegion}.amazonaws.com:8443`,
      `frame-src 'self' blob: https://*.s3.amazonaws.com https://*.s3.${awsRegion}.amazonaws.com`,
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    const responseHeadersPolicy = new cf.ResponseHeadersPolicy(this, "SecurityHeaders", {
      comment: "HSTS, nosniff, frame denial, referrer policy, report-only CSP",
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cf.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: "Content-Security-Policy-Report-Only", value: csp, override: true },
        ],
      },
    });

    /////////////////////////////////////
    ///// CLOUDFRONT DISTRIBUTION    /////
    /////////////////////////////////////

    const distributionLogsBucket = new s3.Bucket(
      this,
      "DistributionLogsBucket",
      {
        objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        enforceSSL: true,
      }
    );

    // Origin access control (OAC): CloudFront signs S3 requests; the bucket stays private.
    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(props.websiteBucket);

    // Bind a custom domain + ACM certificate only when both are configured.
    // CloudFront requires the certificate to be in ACM us-east-1.
    const useCustomDomain = !!(props.customDomain && props.certificateArn);
    const certificate = useCustomDomain
      ? acm.Certificate.fromCertificateArn(this, "SiteCertificate", props.certificateArn!)
      : undefined;

    const distribution = new cf.Distribution(
      this,
      "Dist",
      {
        ...(useCustomDomain
          ? {
              domainNames: [props.customDomain!],
              certificate,
              minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
            }
          : {}),
        defaultBehavior: {
          origin: s3Origin,
          viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          responseHeadersPolicy,
        },
        defaultRootObject: "index.html",
        priceClass: cf.PriceClass.PRICE_CLASS_100,
        httpVersion: cf.HttpVersion.HTTP2_AND_3,
        enableLogging: true,
        logBucket: distributionLogsBucket,
        webAclId: webAcl?.attrArn,
        errorResponses: [
          {
            httpStatus: 403,
            ttl: cdk.Duration.seconds(0),
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
          {
            httpStatus: 404,
            ttl: cdk.Duration.seconds(0),
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
          },
        ],
      }
    );

    this.distribution = distribution;

    // ###################################################
    // Outputs
    // ###################################################
    new cdk.CfnOutput(this, "UserInterfaceDomainName", {
      value: `https://${distribution.distributionDomainName}`,
    });

    NagSuppressions.addResourceSuppressions(
      distributionLogsBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason: "Bucket is the server access logs bucket for the CloudFront distribution.",
        },
      ]
    );

    const distributionSuppressions = [
      { id: "AwsSolutions-CFR1", reason: "Geo restrictions are deployment-specific; none are applied by default." },
      { id: "AwsSolutions-CFR5", reason: "S3 origins use AWS-internal HTTPS; origin SSL protocol is not configurable for S3 origin types." },
    ];
    if (!useCustomDomain) {
      distributionSuppressions.push({
        id: "AwsSolutions-CFR4",
        reason: "The default *.cloudfront.net certificate fixes the minimum viewer protocol and it cannot be raised. Bind a custom domain (customDomain + certificateArn) to enforce TLSv1.2_2021.",
      });
    }
    if (!createWaf) {
      distributionSuppressions.push({
        id: "AwsSolutions-CFR2",
        reason: "CloudFront-scoped WAF can only be created by a stack in us-east-1; this stack is in another region (see the synth warning).",
      });
    }
    NagSuppressions.addResourceSuppressions(distribution, distributionSuppressions);
    }

  }
