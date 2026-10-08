# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-08

First public release. ABE is now ready to fork and deploy into your own AWS account.

### Added

- Native Cognito sign-in as the only login mode: invite-only by default, a branded in-app login page (SRP, new-password and MFA challenges, forgot password), and an `Admin` Cognito group that gates every admin route and API.
- An admin Users page to invite, promote, demote, disable, re-enable, resend an invitation to, and delete users. Admins cannot lock themselves out. Disabling or demoting a user signs them out everywhere.
- Optional self sign-up limited to listed email domains (`allowedSignupDomains`), enforced server-side by a PreSignUp Lambda.
- Optional two-step verification with an authenticator app (TOTP). There is no SMS and no phone number.
- `scripts/create-admin.sh` to create the first admin after a deploy.
- A region-agnostic deploy. The stack picks the Bedrock inference profile prefix from its region, and the CloudFront WAF is created only in `us-east-1`.
- The `enableEval` setting (`ENABLE_EVAL`) to leave out the whole evaluation pipeline, its resources and its admin page.
- More deployment settings: `allowedSignupDomains`, `cognitoFeaturePlan`, `kbParserModel`, `apiGatewayAccountRole`, `metadataHandlerConcurrency`, `devCorsOrigins` (for local frontend work against a deployed backend), `alarmEmail`, `customDomain` and `certificateArn`.
- The AI for Impact default brand (palette, Public Sans, wordmarks) in `config/brand.ts`, with `npm run brand:sync` to regenerate the frontend brand files and brand overrides through environment variables.
- A frontend `.env.example` and a rewritten app README for running the dev server against a deployed stack.
- Open-source project files: README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, LICENSE (MIT), issue and pull request templates, and docs for custom domains and data ingestion.
- Tests for auth, the eval toggle, region independence and cdk-nag cleanliness, and CI that runs every Python Lambda test file.

### Changed

- Node.js 22 is required (`.nvmrc`) and is the Lambda runtime. The README notes the 30 April 2027 end of support and the move to Node.js 24.
- The evaluation pipeline now scores the same prompt, model and tools that production chat uses, read-only, from a single generate-response call. Failures are reported as failures instead of as empty scores, and the RAGAS image is pinned.
- Chat fixes: Stop is now a true cancel that aborts Bedrock and discards the answer, one shared socket so Stop works, sessions are isolated while one is streaming, switching sessions mid-stream is safe, answers lost to a silent network drop are saved, and the tool loop is capped at 25 rounds with bounded Bedrock retries.
- Citation fixes: markers are placed at the end of the cited text, realigned after context compaction, and the current question is pinned during compaction. Presigned URLs stay out of session history, and sources open without popup blocking.
- Session size limits and write guards: session writes are invoke-only, items are size-capped, turns are counted without reading chat bodies, and concurrent appends no longer corrupt trimming.
- Document summaries are generated from ingested chunks by an hourly backfill, in any region, and real summaries are not regenerated.
- Excel index fixes: correct min and max, atomic rebuilds, and the API no longer scans to delete or overwrites on create.
- Frontend: brand-neutral help, onboarding and feedback copy, AA-contrast dark mode, one brand focus ring, error states with Retry, a better mobile header and drawer, and a simpler Data page.
- Cognito ID and access tokens last 15 minutes.
- The CDK app was split into shared helpers for Lambda defaults, Bedrock model IDs, naming and deployment settings. `getUserResponse` and the tool runner were split into focused modules.
- The default stack name and resource names come from the brand slug (`ABEStack`).
- Dependency updates, including `aws-cdk-lib`, Amplify v6 and fixes for critical PyJWT, nltk, langchain-core and anyio advisories.
- Deploy and PR workflows work in forks: tests always run, and the deploy runs only when `AWS_ROLE_ARN` is set. The first-time CDK bootstrap runs only when the toolkit stack is missing.

### Removed

- SSO and OIDC sign-in, and the Cognito hosted UI (Managed Login) path that went with it.
- Agency analytics: agency attribution in chat, the agency index and the agency views on the analytics page.
- Vendored Python packages in the WebSocket authorizer. It now installs PyJWT through `requirements.txt`.
- The demo recorder, stale state assets and dead frontend modules.
- Hardcoded `us-east-1` assumptions and the previous procurement-specific copy and test fixtures.

### Security

- The WebSocket authorizer verifies tokens with PyJWT (signature, expiry, issuer, token use and audience), with rate-limited JWKS fetches.
- Admin endpoints in both the Node and Python Lambdas check the `Admin` group claim, and tests cover the gate on every admin handler.
- Users cannot change their own Admin group membership, so a user token cannot grant admin rights.
- CloudFront serves security headers (HSTS, no-sniff, frame denial, referrer policy, report-only CSP) from an origin access control, with a WAF in `us-east-1`.
- IAM permissions are scoped to specific resources, and cdk-nag suppressions carry a reason each. Bedrock `ApplyGuardrail` is granted only when a guardrail is configured.
- Admin file uploads are limited to a safe file-name set and cannot overwrite `metadata.txt` or index keys. Admin and eval APIs no longer return internal error details.
- Markdown images are blocked in model answers, and tool handlers are looked up by own property only.
- CI never uses the deploy role for pull requests. An optional read-only role is used only for the PR `cdk diff`, and the AWS account ID is masked in deploy logs.
- Fixes for critical advisories in PyJWT, nltk, langchain-core and anyio, and a Dependabot configuration for ongoing updates.

[Unreleased]: https://github.com/The-Burnes-Center/abe/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/The-Burnes-Center/abe/releases/tag/v1.0.0
