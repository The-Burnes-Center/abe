# ABE frontend

The web app for ABE: a React 18 + TypeScript + Vite single-page app using MUI v6.
It signs users in against the stack's Cognito user pool, streams chat answers over
a WebSocket, and gives administrators pages for data, feedback, analytics, quality
monitoring and user management.

In production you don't build this by hand: `cdk deploy` (from the repo root) builds
it and uploads it to S3 behind CloudFront, together with a generated
`/aws-exports.json` that tells the app which user pool and APIs to use.

## Run it locally

You need a deployed stack (the app talks to the real Cognito pool and APIs) and
Node.js 22.

```bash
cd lib/user-interface/app
npm install
cp .env.example .env      # then fill in the values (see below)
npm run dev               # http://localhost:3000
```

The dev server serves `/aws-exports.json` from the `ABE_*` values in `.env`, in the
same shape CDK writes at deploy time. Get the values from the stack outputs:

```bash
aws cloudformation describe-stacks --stack-name <STACK_NAME> --query "Stacks[0].Outputs"
```

| `.env` key | Stack output |
|------------|--------------|
| `ABE_REGION` | the region you deployed to |
| `ABE_USER_POOL_ID` | `UserPoolId` |
| `ABE_USER_POOL_CLIENT_ID` | `UserPoolClientId` |
| `ABE_HTTP_ENDPOINT` | `HTTP-API - apiEndpoint` |
| `ABE_WS_ENDPOINT` | `WS-API - apiEndpoint` followed by `/prod` |
| `ABE_SELF_SIGNUP_ENABLED` | `true` only if the stack allows self sign-up |
| `ABE_EVAL_ENABLED` | `false` if the stack was deployed with `enableEval=false` |

Alternatively, download the deployed config once and skip `.env`:

```bash
curl https://<your-cloudfront-domain>/aws-exports.json -o public/aws-exports.json
```

Both `.env` and `public/aws-exports.json` are git-ignored.

**CORS:** the deployed HTTP API only accepts requests from the site's own origin. To
call it from `http://localhost:3000` the stack has to allow that origin too;
otherwise sign-in works but data requests fail with CORS errors in the browser
console.

## Signing in

There is one sign-in mode: the app's own login page, talking to Cognito directly.

- **Accounts are invite-only by default.** An administrator invites people from
  **Admin > Users** (or with `scripts/create-admin.sh` for the first admin). Invitees
  get an email with a temporary password and choose their own password on first
  sign-in.
- **Self sign-up** appears on the login page only when the deployment enables it
  (`selfSignUpEnabled: true` in `aws-exports.json`, set by the stack when an email
  domain allowlist is configured). The allowlist is enforced server-side.
- **Two-step verification:** authenticator-app (TOTP) codes are supported, including
  first-time setup with a QR code. There is no SMS.
- **Admins** are members of the Cognito group `Admin`. The app reads the
  `cognito:groups` claim to show admin pages; every admin API checks the same group.

## Rebranding

Edit `config/brand.ts` at the repo root (names, colors, fonts, time zone, logo paths),
then run `npm run brand:sync` from the repo root and commit the regenerated
`src/common/brand.ts` and `public/manifest.json`. CI deploys don't run the sync, so
the committed file is what ships. Logos and the favicon live in `public/images/`.

Values you can override per deployment with environment variables at sync time include
`ASSISTANT_NAME`, `SHORT_NAME`, `ORGANIZATION_NAME`, `SUPPORT_CONTACT`, `BRAND_TIMEZONE`
and `BRAND_DEMO_VIDEO`.

The optional demo clip shown on the Help page and in onboarding is read from
`brand.assets.demoVideo` (default `/demos/demo.mp4`, i.e. `public/demos/demo.mp4`).
If the file doesn't exist, the video and its card are hidden.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests (Vitest + Testing Library) |
| `npm run lint` | ESLint, zero warnings allowed |

## Where things are

| Path | What |
|------|------|
| `src/components/app-configured.tsx` | Loads `aws-exports.json`, configures Amplify, shows the login page or the app |
| `src/components/auth/` | Login page (sign-in, invites, TOTP, reset, optional sign-up) |
| `src/common/auth.ts` | `isAdmin()` from the ID token's `cognito:groups` |
| `src/components/admin-route.tsx` | Guard for everything under `/admin` |
| `src/hooks/useWebSocketChat.ts` | Streaming chat protocol, reconnects and cancellation |
| `src/components/chatbot/` | Chat UI (messages, sources, feedback, input) |
| `src/pages/admin/` | Admin pages (data, feedback, analytics, quality monitoring, users) |
| `src/common/api-client/` | REST clients, one per API area |
| `src/common/theme.ts` | MUI theme; brand colors come from `src/common/brand.ts` |
| `docs/ACCESSIBILITY.md` | Accessibility notes and manual test checklist |
