# Custom domain and TLS certificate

How to serve the ABE web app from your own hostname (for example `chat.example.org`) over HTTPS. The steps cover the certificate, the DNS records, and the deploy-time settings that bind the domain.

## How it works

- The app is served from S3 through a CloudFront distribution. TLS ends at CloudFront, and the certificate is attached to the distribution as the certificate for its alternate domain name.
- The certificate must be an AWS Certificate Manager (ACM) certificate in `us-east-1`, whatever region the rest of the stack runs in. CloudFront only accepts certificates from `us-east-1`. It must be in the same AWS account as the distribution.
- Binding is configuration, not code. You supply two values at deploy time: the hostname (`customDomain`) and the certificate ARN (`certificateArn`). The domain binds only when both are set. With neither, the app stays on the default `*.cloudfront.net` domain.

| Piece | Where it is done | Managed by |
|-------|------------------|------------|
| ACM certificate | ACM console, `us-east-1` | You, outside CloudFormation |
| DNS records (validation, then the app hostname) | Your DNS zone | Whoever owns the zone |
| Alias and certificate on the distribution | CDK settings (`customDomain`, `certificateArn`) | CDK |
| HTTP API and S3 bucket CORS origin | CDK settings (derived from the bound domain) | CDK |
| Link in the Cognito invitation email | CDK settings (derived from the bound domain) | CDK |

The certificate is requested by hand and not in CDK because DNS validation needs a record added to your zone, often by a different person or team. Putting the certificate in the stack would hold `cdk deploy` until that record exists. So you create the certificate first (steps 1 and 2) and the stack only references its ARN (step 3).

## Prerequisites

- Access to the AWS account that holds the stack, with permission to request an ACM certificate in `us-east-1`.
- The ability to add DNS records in the domain's zone, or someone who can.
- For the CI option: permission to add Variables and Secrets to the GitHub repository.

## Step 1: Request the certificate

1. Open AWS Certificate Manager and set the Region selector to **US East (N. Virginia) us-east-1**.
2. Choose **Request**, then **Request a public certificate**, then **Next**.
3. Enter the fully qualified domain name, for example `chat.example.org`.
4. Choose **DNS validation**. Leave the key algorithm at the default (RSA 2048) and choose **Request**.
5. Open the new certificate. Its status is **Pending validation**.

## Step 2: Validate the certificate

1. On the certificate page, under **Domains**, copy the CNAME name and the CNAME value.
   - If the zone is in Route 53 in this same account, choose **Create records in Route 53** and you are done.
   - Otherwise add a CNAME record with that name and value in your DNS zone, or send both values to whoever manages it.
2. Enter the values as absolute names. In particular, do not let your DNS provider append the zone name to the value (`...acm-validations.aws`), or validation never completes.
3. If the domain has a CAA record, it must allow Amazon (`amazon.com` or `amazontrust.com`) to issue certificates.
4. Wait until the status is **Issued**, usually a few minutes after the record propagates.
5. Copy the certificate ARN: `arn:aws:acm:us-east-1:<account-id>:certificate/<id>`.

## Step 3: Bind the domain to the distribution

Set the two values and deploy. Do not edit the distribution in the CloudFront console: the distribution is created by CDK, so a console change is drift, and the next `cdk deploy` rebuilds it from the CDK definition and drops your manual alias.

### Local deploy

```bash
npx cdk deploy \
  -c customDomain=chat.example.org \
  -c certificateArn=arn:aws:acm:us-east-1:<account-id>:certificate/<id>
```

The environment variables `CUSTOM_DOMAIN` and `CERTIFICATE_ARN` work too. Keep passing them on every deploy: a deploy without them reverts the stack to the `*.cloudfront.net` domain.

### GitHub Actions deploy

In the repository settings add the Variable `CUSTOM_DOMAIN` (the hostname) and the Secret `CERTIFICATE_ARN` (the ARN). The deploy workflow passes both to CDK. Then re-run the Deploy workflow or push to `main`.

## Step 4: Point DNS at CloudFront

Create a DNS record for the hostname that targets the distribution's domain name (`dxxxxxxxxxxxx.cloudfront.net`). Before the domain is bound, the `AppUrl` stack output shows that CloudFront URL, so you can read it from there.

```bash
aws cloudformation describe-stacks --stack-name ABEStack \
  --query "Stacks[0].Outputs[?OutputKey=='AppUrl'].OutputValue | [0]" --output text
```

- In Route 53 use an alias A record (and AAAA for IPv6) to the distribution.
- Elsewhere use a CNAME record to the CloudFront domain. A zone apex cannot hold a CNAME, so use a subdomain unless your DNS provider supports alias or flattened records.

## Step 5: Verify

- `https://chat.example.org` loads the app with a valid certificate and no browser warning.
- Sign-in works and chat streams, with no CORS errors in the browser console.
- After binding, `AppUrl` shows the custom domain and invitation emails link to it.

Optional checks after the deploy:

```bash
# DNS, TLS and CloudFront
curl -sI https://chat.example.org | head -5

# HTTP API CORS: the allowed origins should include the custom domain
aws apigatewayv2 get-api --api-id <http-api-id> \
  --query 'CorsConfiguration.AllowOrigins'
```

The HTTP API id is the first label of the `HTTP-API - apiEndpoint` stack output (`https://<http-api-id>.execute-api...`).

After the cutover, use the custom domain. The raw `*.cloudfront.net` URL still serves the static files, but API calls from it fail because the API's allowed origin is now the custom domain.

## Troubleshooting

**The custom domain loads but the UI hangs on a spinner, or chat shows CORS errors, even though the certificate is Issued and the page returns HTTP 200.**
The site is served, but the API and bucket CORS settings still name the old `*.cloudfront.net` origin. Those settings are fixed at deploy time, so adding the CloudFront alias and DNS by hand is not enough: the stack has to be deployed with the domain bound. The usual cause is a deploy that ran without `customDomain` and `certificateArn`. Set them (step 3) and redeploy. Do not patch the API or buckets by hand, since the next deploy reverts manual edits.

**`cdk deploy` fails with a certificate error.**
Check that the certificate is `Issued` and in `us-east-1`, that its domain name matches `customDomain`, and that it belongs to the same account.

**The certificate stays in Pending validation.**
The validation CNAME is missing, was changed by the DNS provider (a suffixed value), or a CAA record blocks Amazon. Re-check step 2.

## Removing or changing the domain

- **Remove:** clear `customDomain` and `certificateArn` (and the matching GitHub Variable and Secret) and deploy. The app reverts to the default CloudFront domain.
- **Change:** request a new certificate for the new hostname (steps 1 and 2), update the two values, redeploy (step 3), then update DNS (step 4).

## How it is wired

`lib/deployment-config.ts` reads `customDomain` and `certificateArn` from CDK context, falling back to the `CUSTOM_DOMAIN` and `CERTIFICATE_ARN` environment variables, and binds them only when both are present. `lib/abe-stack.ts` then computes one site URL (the custom domain, or else the CloudFront domain) and feeds it through a lazy token into three places so they cannot drift apart:

1. The CloudFront alias and imported ACM certificate (`lib/user-interface/generate-app.ts`).
2. The HTTP API and S3 bucket CORS origin (`lib/chatbot-api`).
3. The link in the Cognito invitation email (`lib/authorization/index.ts`).

Sign-in uses Cognito directly from the app (no hosted login page and no OAuth redirect), so there are no Cognito callback or sign-out URLs to maintain.
