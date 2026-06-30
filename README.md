# Sonar

**Sonar** is a white-label, domain-agnostic AI assistant: a grounded **RAG + agentic** chatbot you point at any knowledge base and structured data. Ask a question, and Sonar searches your documents and tabular indexes, then answers with cited sources — no hallucination, no domain lock-in.

It's a **configurable template**: every piece of brand identity (name, colors, logo, fonts, copy, system-prompt framing) comes from a single config file, so the same codebase can be deployed under any brand by editing one file. The default brand is the **Burnes Center for Social Change** (Northeastern University).

Built on AWS — serverless, CDK-managed, and production-grade (CloudFront + WAF, Cognito auth, 40+ CloudWatch alarms).

---

## Configure your brand

Everything brand-specific lives in **[`config/brand.ts`](config/brand.ts)** — the single source of truth.

```ts
export const brand = {
  slug: "sonar",                                  // drives stack/Cognito/resource names
  assistantName: "Sonar",                         // the bot's display name
  organizationName: "Burnes Center for Social Change",
  tagline: "Ask anything about your knowledge base.",
  welcomeMessage: "What can I help you with?",
  supportContact: "your administrator",           // used when the assistant can't answer
  domainContext: "",                              // optional extra system-prompt context ("" = fully generic)
  suggestedPrompts: [ /* starter chips */ ],
  palette: { red: "#C8102E", navy: "#0C3354", lightBlue: "#297496", ... },
  colorsLight: { /* theme tokens */ }, colorsDark: { /* … */ },
  fontFamily: '"Libre Franklin", …', fontUrl: "https://fonts.googleapis.com/…",
  assets: { logo, logoDark, favicon, icon },      // files in lib/user-interface/app/public/images
};
```

**To rebrand:**

1. Edit `config/brand.ts` (or set env overrides: `BRAND_SLUG`, `ASSISTANT_NAME`, `ORGANIZATION_NAME`, `SUPPORT_CONTACT`, `DOMAIN_CONTEXT`, `STACK_NAME`, `COGNITO_DOMAIN_PREFIX`, `OIDC_PROVIDER_NAME`).
2. Drop your logo/icon SVGs into `lib/user-interface/app/public/images/` (`logo.svg`, `logo-white.svg`, `icon.svg`).
3. Run `npm run brand:sync` to regenerate the frontend brand module + PWA manifest.
4. Deploy. (`npm run synth` / `npm run deploy` run `brand:sync` automatically.)

The brand config flows to: the MUI theme + CSS variables, the Cognito hosted-login UI, `index.html` (title/favicon/font/theme-color), `manifest.json`, the React app copy, the CDK stack/resource names + tags, and the system-prompt template variables (`{{assistant_name}}`, `{{organization}}`, `{{support_contact}}`, `{{domain_context}}`).

> The system prompt and tools are domain-neutral by default. Point Sonar at any corpus; set `domainContext` if you want to give the assistant a sentence of domain framing.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| **IaC** | AWS CDK (TypeScript) |
| **LLM** | Claude Opus 4.6 (chat) + Claude Sonnet 4.6 (fast tasks) via Amazon Bedrock |
| **Knowledge Base** | Bedrock Knowledge Base + OpenSearch Serverless (semantic chunking, Titan Embed v2) |
| **Structured data** | Spreadsheet indexes parsed into DynamoDB, queried via the `query_excel_index` tool |
| **Backend** | Node.js 20 ESM + Python 3.12 Lambdas (ARM64, X-Ray) |
| **Frontend** | React 18 + TypeScript + Vite + MUI v6 |
| **Auth** | Amazon Cognito (hosted login: username/password + sign-up, optional OIDC/SSO) |
| **APIs** | API Gateway (REST + WebSocket streaming) |
| **Storage** | DynamoDB + S3 |
| **CDN/Security** | CloudFront + WAF + OAC |
| **Eval** | Step Functions + RAGAS (Docker Lambda) |

See [`CLAUDE.md`](CLAUDE.md) for the full architecture map, data flows, and API routes.

---

## Getting started

### Prerequisites
- Node.js v20+, AWS CLI v2 (configured), AWS CDK v2, Python 3.12, Docker (for the RAGAS eval Lambda).

### Install
```bash
npm install                                                # CDK / backend
cd lib/user-interface/app && npm install && cd ../../..    # frontend
```

### Build & test
```bash
npm run build          # brand:sync (prebuild) + CDK TypeScript compile
npm test               # Jest CDK assertion tests
npm run test:lambda    # Vitest unit tests for the chat handler
```

### Deploy
```bash
export AWS_PROFILE=<your-profile>
npm run synth          # brand:sync + cdk synth   (stack name derives from brand.slug, e.g. SonarStack)
npm run deploy         # brand:sync + cdk deploy
npx cdk deploy SonarStack -c alarmEmail=you@example.com    # subscribe to alarm emails
```

> `cognitoDomainName` (`<slug>-auth`) must be globally unique across AWS — override with `COGNITO_DOMAIN_PREFIX` if taken.

---

## Project structure

```
config/brand.ts                  # ← single source of truth for brand identity
scripts/sync-brand.ts            # generates the frontend brand module + manifest from config/brand.ts
bin/                             # CDK app entry point
lib/
  constants.ts                   # stack / Cognito / OIDC names (derived from brand.slug)
  sonar-stack.ts            # root CDK stack + tags
  authorization/                 # Cognito user pool + hosted-login branding + WS JWT authorizer
  chatbot-api/                   # tables, buckets, OpenSearch, Bedrock KB, monitoring, Lambdas
    functions/websocket-chat/    # chat handler: agentic loop, prompt, tools, citations
  user-interface/app/            # React + Vite frontend (theme, brand, components, pages)
```

---

## Monitoring

A CloudWatch dashboard (`<StackName>-Operations`) and 40+ alarms are created on deploy (Lambda errors/throttles/latency, API 4xx/5xx, WebSocket health, DynamoDB throttles, eval pipeline failures). Subscribe to alerts with `-c alarmEmail=...` or the `ALARM_EMAIL` CI secret.
