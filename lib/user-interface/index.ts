import * as cdk from "aws-cdk-lib";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import {
  ExecSyncOptionsWithBufferEncoding,
  execSync,
} from "node:child_process";
import * as path from "node:path";
import { ChatBotApi } from "../chatbot-api";
import { Website } from "./generate-app"
import { NagSuppressions } from "cdk-nag";
import { Utils } from "../shared/utils"

export interface UserInterfaceProps {
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly api: ChatBotApi;
  /** Written to aws-exports.json so the login page shows or hides "Create account". */
  readonly selfSignUpEnabled: boolean;
  /** Written to aws-exports.json so the UI can hide the evaluation pages. */
  readonly evalEnabled: boolean;
  // Optional custom domain + ACM cert ARN (us-east-1, a CloudFront requirement).
  // When both are set, the app is served from the custom domain.
  readonly customDomain?: string;
  readonly certificateArn?: string;
}

export class UserInterface extends Construct {
  public readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: UserInterfaceProps) {
    super(scope, id);

    const appPath = path.join(__dirname, "app");
    const buildPath = path.join(appPath, "dist");

    const uploadLogsBucket = new s3.Bucket(this, "WebsiteLogsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      enforceSSL: true,
    });

    const websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      enforceSSL: true,
      serverAccessLogsBucket: uploadLogsBucket,
    });

    const publicWebsite = new Website(this, "Website", {
      websiteBucket,
      customDomain: props.customDomain,
      certificateArn: props.certificateArn,
    });
    this.distribution = publicWebsite.distribution

    // Runtime config the SPA fetches at startup. Native Cognito sign-in only:
    // no OAuth / hosted-UI settings.
    const exportsAsset = s3deploy.Source.jsonData("aws-exports.json", {
      Auth: {
        region: cdk.Aws.REGION,
        userPoolId: props.userPoolId,
        userPoolWebClientId: props.userPoolClientId,
      },
      httpEndpoint: props.api.httpAPI.restAPI.url,
      wsEndpoint: props.api.wsAPI.wsAPIStage.url,
      selfSignUpEnabled: props.selfSignUpEnabled,
      evalEnabled: props.evalEnabled,
    });

    const asset = s3deploy.Source.asset(appPath, {
      bundling: {
        image: cdk.DockerImage.fromRegistry(
          "public.ecr.aws/sam/build-nodejs22.x:latest"
        ),
        command: [
          "sh",
          "-c",
          [
            "npm --cache /tmp/.npm ci",
            `npm --cache /tmp/.npm run build`,
            "cp -aur /asset-input/dist/* /asset-output/",
          ].join(" && "),
        ],
        local: {
          tryBundle(outputDir: string) {
            try {
              const options: ExecSyncOptionsWithBufferEncoding = {
                stdio: "inherit",
                env: {
                  ...process.env,
                },
              };

              execSync(`npm --silent --prefix "${appPath}" ci`, options);
              execSync(`npm --silent --prefix "${appPath}" run build`, options);
              Utils.copyDirRecursive(buildPath, outputDir);
            } catch (e) {
              console.error(e);
              return false;
            }

            return true;
          },
        },
      },
    });

    new s3deploy.BucketDeployment(this, "UserInterfaceDeployment", {
      prune: false,
      sources: [asset, exportsAsset],
      destinationBucket: websiteBucket,
      distribution: this.distribution
    });

    NagSuppressions.addResourceSuppressions(
      uploadLogsBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason: "Bucket is the server access logs bucket for websiteBucket.",
        },
      ]
    );
  }
}
