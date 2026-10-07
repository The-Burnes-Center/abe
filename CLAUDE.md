# ABE

Configurable, white-label AI assistant: a grounded RAG + agentic chatbot you can point at any knowledge base. Combines a Bedrock Knowledge Base (hybrid semantic and keyword search over your documents) with structured spreadsheet indexes through an agentic tool-use loop. Brand, copy, and domain are set in [config/brand.ts](config/brand.ts). Open source (MIT); see [README.md](README.md) for the deploy guide and [CONTRIBUTING.md](CONTRIBUTING.md).

## Stack

| Layer | Tech |
|-------|------|
| IaC | AWS CDK v2 (TypeScript), cdk-nag checks on every synth |
| Chat Lambda | Node.js 22 ESM + Bedrock streaming |
| Other Lambdas | 23 application Lambdas without eval (17 Python 3.12, 6 Node.js 22); 35 with eval (24 Python, 10 Node, 1 container image) |
| LLM | Claude Opus 4.6 (primary), Claude Sonnet 4.6 (fast), via the regional inference profile (`us.`, `eu.`, `apac.`, else `global.`) |
| Vector DB | OpenSearch Serverless (Titan Text Embeddings V2, 1024-dim), standby replicas disabled |
| Data | DynamoDB (13 tables, 10 without eval), S3 (7 data buckets, 5 without eval, plus website and log buckets), SQS (1 queue + DLQ, eval only) |
| Auth | Cognito user pool (email + password, optional TOTP, `Admin` group, invite-only) + WebSocket Lambda authorizer + HTTP API JWT authorizer |
| Frontend | React 18 + TypeScript + Vite + MUI v6 |
| CI/CD | GitHub Actions: tests on every push and PR; CDK deploy on push to `main` when `AWS_ROLE_ARN` is set |

## Commands

```bash
# Backend (CDK)
npm ci
npm run build        # Brand sync + tsc (also emits .js next to .ts, git-ignored)
npm run watch        # Watch mode
npm test             # Jest CDK tests (synth without Docker)
npx tsc --noEmit     # Typecheck
npm run test:lambda  # Vitest: every *.test.mjs under lib/chatbot-api/functions

# Python Lambda tests (Python 3.12), same selection as CI
python3 -m pytest $(git ls-files 'lib/*test_*.py' | grep -E '/test_[^/]+\.py$')

# Frontend
cd lib/user-interface/app
npm ci
npm run dev          # Local dev server (port 3000), needs .env (see .env.example)
npm run build        # Typecheck + production build
npm run lint         # ESLint, zero warnings
npm test             # Vitest + Testing Library

# Brand
npm run brand:sync   # Regenerate the frontend brand.ts and manifest.json from config/brand.ts

# Deploy (Docker must be running for synth and deploy)
npx cdk synth                      # Preview CloudFormation
npx cdk diff                       # Diff against deployed
npx cdk deploy                     # Deploy (npm run deploy syncs the brand first)
npx cdk deploy -c alarmEmail=you@example.com -c enableEval=false
scripts/create-admin.sh --email you@example.org [--stack-name ABEStack] [--region us-east-1]
```

## Architecture

### Chat Request Flow
1. Client connects via WebSocket (token in the query string); the Python Lambda authorizer validates the Cognito ID token (signature, expiry, audience) on `$connect` only
2. Message arrives on the `getChatbotResponse` route and runs in the chat Lambda ([index.mjs](lib/chatbot-api/functions/websocket-chat/index.mjs)). Identity comes from the authorizer context, never the message body
3. Agentic loop (max 25 rounds, `MAX_TOOL_ROUNDS`): Claude calls tools, the Lambda runs them, Claude refines, repeat until done. Modules: `connection.mjs` (sends, stop detection), `stream-turn.mjs` (one streamed response), `tool-runner.mjs` (tool execution), `compaction.mjs` (context window), `persistence.mjs` (DynamoDB and session handler), `citations.mjs`, `kb.mjs`, `tools.mjs`, `retry.mjs`
4. Available tools:
   - `query_db`: Bedrock KB hybrid (semantic + keyword) search, 25 results per page and 2 pages, at most 5 chunks per document, no score threshold; optional `within_document` filter; `metadata.txt` and non-text chunks excluded
   - `retrieve_full_document`: all chunks of one document by (partial) file name; up to 5 pages of 100, capped at 150 chunks and 120,000 characters, and says so when it cuts the document
   - `fetch_metadata`: document inventory from `metadata.txt` (compact map by default; `full` for summaries; `filename_contains` to filter)
   - `query_excel_index`: structured DynamoDB queries (filters, counts, aggregations, sorts, distinct values; default limit 50); built at runtime from the index registry and only offered when an index exists
5. Context management: loads the last 12 exchanges; auto-compacts at 120K estimated tokens (up to 3 rounds via the context-summarizer Lambda, pinning the current question); hard ceiling 160K
6. Response streamed back via WebSocket with `!<|STATUS|>!`, `!<|REPLACE|>!`, `!<|EOF_STREAM|>!` protocol markers (a JSON frame of Sources, Trace and ContextUsage follows EOF); UI renders incrementally
7. Prompt loaded from the DynamoDB registry (LIVE pointer, fallback to the embedded default); the template renders `{{current_date}}` and the brand placeholders. The document inventory is no longer inlined, the model fetches it with `fetch_metadata`
8. After the answer: session history saved (presigned source URIs stripped), response trace written, FAQ classifier invoked asynchronously

### Two Separate Data Systems
| System | Bucket Path | Trigger | Storage | Tool |
|--------|-------------|---------|---------|------|
| Knowledge Base | `KnowledgeSourceBucket` | Manual "Sync data now" or schedule (Sunday 1 AM in the brand timezone) | OpenSearch (semantic chunking, 512 tokens, 95th-percentile breakpoint) | `query_db`, `retrieve_full_document` |
| Spreadsheet index | `ContractIndexBucket`, `indexes/{id}/latest.xlsx` | S3 event (automatic) | DynamoDB (`ExcelIndexDataTable`, registry in `IndexRegistryTable`) | `query_excel_index` |

**Critical:** Uploading an Excel file to the knowledge bucket does NOT populate the spreadsheet index. They are independent pipelines. Detail in [docs/data-ingestion-s3-and-sync.md](docs/data-ingestion-s3-and-sync.md).

### Data Sync Pipeline
1. Browsers upload documents straight to `KnowledgeSourceBucket` and spreadsheets to `ContractIndexBucket` with presigned URLs. Bulk loads can go to `DataStagingBucket` under `documents/` and `indexes/{id}/latest.xlsx`
2. `SyncOrchestratorFunction` moves `documents/*` to the KB bucket (prefix dropped) and `indexes/*` to the index bucket (key kept)
3. It starts a Bedrock KB ingestion job unless one is already running
4. Records history in `SyncHistoryTable` (90-day TTL via `expiresAt`)
5. Scheduled via EventBridge Scheduler (default `cron(0 1 ? * SUN *)` in the brand timezone); editable from the admin UI
6. A second hourly schedule re-invokes the orchestrator in backfill-only mode (`{"backfillOnly": true}`): generates LLM summaries for documents whose KB chunks now exist. Summaries can't be created at upload time because ingestion finishes minutes to hours after the S3 events fire. No staging moves, no ingestion job, no history record

### Auth Model
- Native Cognito only: email + password (SRP), optional TOTP, no SMS, no hosted UI, no federation
- Invite-only: admins create users (Users page or `scripts/create-admin.sh`); Cognito emails a temporary password valid 7 days
- Self sign-up is off unless `allowedSignupDomains` is set; the PreSignUp Lambda enforces the allowlist server-side and fails closed
- Admins are members of the Cognito group `Admin`, read from the `cognito:groups` claim (exact match, many claim encodings parsed). One helper per runtime: `common_utils/auth.py` (Python layer), `shared-node/auth.mjs` (Node), `isAdmin` in `src/common/auth.ts` (frontend)
- Non-admins get 403 from admin APIs; the frontend guards `/admin/*` with `AdminRoute`
- Tokens: ID and access 15 minutes, refresh 30 days; user pool is RETAIN with deletion protection

### Key Files
| File | Role |
|------|------|
| [bin/abe.ts](bin/abe.ts) | CDK app entry point + cdk-nag AwsSolutionsChecks |
| [lib/constants.ts](lib/constants.ts) | Stack name, prompt family, metric namespaces, admin group name, brand env for Lambdas |
| [lib/deployment-config.ts](lib/deployment-config.ts) | Reads per-deployment settings from CDK context and env vars |
| [lib/abe-stack.ts](lib/abe-stack.ts) | Root stack: orchestrates constructs, tags, outputs, CDK nag suppressions |
| [lib/shared/](lib/shared/) | `LAMBDA_DEFAULTS` and runtimes, bundling helpers, model ID and inference-profile helpers, name helpers |
| [lib/authorization/index.ts](lib/authorization/index.ts) | Cognito user pool, Admin group, app client, PreSignUp trigger, WebSocket authorizer |
| [lib/authorization/pre-signup/lambda_function.py](lib/authorization/pre-signup/lambda_function.py) | PreSignUp trigger: domain allowlist for self sign-up |
| [lib/chatbot-api/index.ts](lib/chatbot-api/index.ts) | ChatBotApi construct: tables, buckets, OpenSearch, KB, APIs, Lambdas, routes, monitoring |
| [lib/chatbot-api/functions/functions.ts](lib/chatbot-api/functions/functions.ts) | Core Lambda definitions (plus `excel-index-functions.ts`, `sync-functions.ts`, `eval-functions.ts`) |
| [lib/chatbot-api/functions/websocket-chat/index.mjs](lib/chatbot-api/functions/websocket-chat/index.mjs) | Chat handler + agentic tool-use loop |
| [lib/chatbot-api/functions/websocket-chat/prompt.mjs](lib/chatbot-api/functions/websocket-chat/prompt.mjs) | System prompt default (cached at Bedrock, ~4K tokens) |
| [lib/chatbot-api/functions/websocket-chat/tools.mjs](lib/chatbot-api/functions/websocket-chat/tools.mjs) | Tool definitions (static + dynamic spreadsheet tool), result capping |
| [lib/chatbot-api/functions/websocket-chat/models/chat-model.mjs](lib/chatbot-api/functions/websocket-chat/models/chat-model.mjs) | Bedrock runtime wrapper: streaming, prompt caching, guardrails |
| [lib/chatbot-api/functions/websocket-chat/kb.mjs](lib/chatbot-api/functions/websocket-chat/kb.mjs) | KB retrieval: hybrid search, full-document retrieval, fuzzy filename resolution |
| [lib/chatbot-api/functions/websocket-chat/citations.mjs](lib/chatbot-api/functions/websocket-chat/citations.mjs) | Citations: Bedrock native to `[N]` markers, validation, renumbering, sentence snapping |
| [lib/chatbot-api/functions/websocket-chat/prompt-registry.mjs](lib/chatbot-api/functions/websocket-chat/prompt-registry.mjs) | Prompt registry: LIVE pointer to versioned templates, SHA256 change detection |
| [lib/chatbot-api/functions/user-admin/lambda_function.py](lib/chatbot-api/functions/user-admin/lambda_function.py) | Admin-only user API (invite, role, enable, disable, resend, delete) |
| [lib/chatbot-api/functions/excel-index/parser/lambda_function.py](lib/chatbot-api/functions/excel-index/parser/lambda_function.py) | S3 trigger: parse .xlsx to DynamoDB rows + AI description via Bedrock |
| [lib/chatbot-api/functions/excel-index/query/lambda_function.py](lib/chatbot-api/functions/excel-index/query/lambda_function.py) | DynamoDB queries (filters, fuzzy free text, date ranges, aggregations, sorting, pagination) |
| [lib/chatbot-api/functions/layers/python-common/](lib/chatbot-api/functions/layers/python-common/) | Shared Python layer: auth, logging, responses, validation |
| [lib/chatbot-api/tables/tables.ts](lib/chatbot-api/tables/tables.ts) | DynamoDB tables + SQS queues |
| [lib/chatbot-api/buckets/buckets.ts](lib/chatbot-api/buckets/buckets.ts) | S3 data buckets |
| [lib/chatbot-api/monitoring/monitoring.ts](lib/chatbot-api/monitoring/monitoring.ts) | CloudWatch dashboard, alarms, SNS topic |
| [lib/chatbot-api/knowledge-base/knowledge-base.ts](lib/chatbot-api/knowledge-base/knowledge-base.ts) | Bedrock KB with semantic chunking (Titan Embed v2), optional FM parser |
| [lib/chatbot-api/opensearch/opensearch.ts](lib/chatbot-api/opensearch/opensearch.ts) | OpenSearch Serverless collection, policies, vector index custom resource |
| [lib/chatbot-api/functions/step-functions/step-functions.ts](lib/chatbot-api/functions/step-functions/step-functions.ts) | Evaluation pipeline: state machine + 7 Lambdas (incl. the Docker one) |
| [lib/user-interface/index.ts](lib/user-interface/index.ts) | S3 website + `aws-exports.json` + BucketDeployment (builds the React app); `generate-app.ts` holds CloudFront, WAF, headers |
| [lib/user-interface/app/src/app.tsx](lib/user-interface/app/src/app.tsx) | React router + lazy-loaded pages |
| [lib/user-interface/app/src/components/app-configured.tsx](lib/user-interface/app/src/components/app-configured.tsx) | Auth gate: fetches aws-exports.json, configures Amplify, renders the login page or the app |
| [lib/user-interface/app/src/components/auth/login-page.tsx](lib/user-interface/app/src/components/auth/login-page.tsx) | Branded login: SRP sign-in, optional sign-up with email verification, forgot password, MFA and new-password challenges |
| [lib/user-interface/app/src/hooks/useWebSocketChat.ts](lib/user-interface/app/src/hooks/useWebSocketChat.ts) | WebSocket hook: auto-reconnect, 120s inactivity timeout, protocol parsing, stop |
| [lib/user-interface/app/src/common/theme.ts](lib/user-interface/app/src/common/theme.ts) | MUI theme with light/dark modes, brand colors from `brand.ts` |
| [scripts/create-admin.sh](scripts/create-admin.sh) | Invite the first (or any) admin |
| [scripts/sync-brand.ts](scripts/sync-brand.ts) | Generate the frontend `brand.ts` and `manifest.json` from `config/brand.ts` |

## Key Conventions

### CDK
- Use `scope` (not `this`) when creating sub-resources inside constructs: preserves CloudFormation logical IDs and prevents accidental recreation
- All Lambdas spread `LAMBDA_DEFAULTS` ([lambda-defaults.ts](lib/shared/lambda-defaults.ts)): ARM64, X-Ray, 1-month log retention. Runtimes are pinned in `NODE_RUNTIME` and `PYTHON_RUNTIME`
- Python code with pip dependencies uses `pythonBundledCode` (Docker bundling for ARM64); dependency-free code uses `pythonCode`; Node uses `nodeCode`
- Resources are separated by concern: `functions.ts`, `tables.ts`, `buckets.ts`
- cdk-nag compliance checks run on every synth; add suppressions with explicit reasons, scoped to the resource or an `appliesTo` pattern
- All DynamoDB tables: PAY_PER_REQUEST, PITR enabled, RETAIN removal policy. Data buckets and SQS queues are RETAIN too
- Tags applied stack-wide (the OpenSearch collection is excluded): `Project: <brand slug>`, `Environment: <ENVIRONMENT or dev>`, `ManagedBy: cdk`
- Never hardcode a region. Use `Stack.of(this).region`, `Aws.REGION`, `Aws.PARTITION`; the CloudFront WAF is created only when the stack region is `us-east-1`

### Python Lambdas
- Use Pydantic models for request/response validation where payloads are structured
- Shared utilities (auth, logging, responses) live in the Lambda layer: [layers/python-common](lib/chatbot-api/functions/layers/python-common/)
- Return structured JSON error responses; catch exceptions explicitly
- Structured JSON logging with correlation IDs (session-based) for CloudWatch Insights
- Admin handlers call the shared `require_admin` helper and return 403, never 500, for non-admins

### Node.js Lambdas (ESM)
- All handlers use `.mjs` extension and ESM imports
- AWS SDK v3 modular imports (`@aws-sdk/client-*`)
- Bedrock streaming: parse events chunk-by-chunk; citations need custom validation
- Prompt caching: system prompt wrapped in `cache_control: { type: "ephemeral" }` (5-min TTL, up to 90% input token savings)
- Tool result capping: binary search to fit within 60K chars; rows truncated with a note
- Shared admin check: `shared-node/auth.mjs`, copied into each package at bundle time (symlinks are followed)

### Frontend
- Route-based code splitting via `React.lazy()` + `Suspense`
- `AppConfigured` handles the auth gate (Amplify + Cognito, native sign-in only); `AdminRoute` guards `/admin/*`
- API clients in [src/common/api-client/](lib/user-interface/app/src/common/api-client/): 8 sub-clients (knowledgeManagement, sessions, userFeedback, evaluations, metrics, excelIndex, sync, users)
- WebSocket chat logic in the `useWebSocketChat` hook (auto-reconnect, exponential backoff, 120s inactivity timeout)
- MUI v6 theming via [src/common/theme.ts](lib/user-interface/app/src/common/theme.ts), light/dark modes with CSS variables
- Notification system via React Context (`notif-manager.tsx`) with auto-dismiss (success 4s, info 5s, error 8s)
- ErrorBoundary wraps routes at multiple levels
- Vite build with manual chunk splitting

## Deployment Settings

Read from CDK context (`-c key=value`) then the env var, in [deployment-config.ts](lib/deployment-config.ts) and [shared/bedrock.ts](lib/shared/bedrock.ts):

| Context / env | Default | Effect |
|---------------|---------|--------|
| `allowedSignupDomains` / `ALLOWED_SIGNUP_DOMAINS` | none | Non-empty enables self sign-up for those email domains (PreSignUp trigger) |
| `cognitoFeaturePlan` / `COGNITO_FEATURE_PLAN` | `ESSENTIALS` | `PLUS` adds threat protection |
| `enableEval` / `ENABLE_EVAL` | `true` | `false` drops the eval pipeline, its tables, buckets, queues, routes and the UI page |
| `kbParserModel` / `KB_PARSER_MODEL` | unset | Foundation-model parsing (multimodal); replaces the data source |
| `apiGatewayAccountRole` / `API_GATEWAY_ACCOUNT_ROLE` | `true` | Manage the region-wide API Gateway logs role; `false` for a second stack in the account and region |
| `metadataHandlerConcurrency` / `METADATA_HANDLER_CONCURRENCY` | unset | Reserved concurrency for the summary Lambda (fails in accounts with a quota of 10) |
| `devCorsOrigins` / `DEV_CORS_ORIGINS` | none | Extra localhost CORS origins for `npm run dev` against a deployed backend |
| `alarmEmail` / `ALARM_EMAIL` | none | Alarm SNS subscription |
| `customDomain` + `certificateArn` / `CUSTOM_DOMAIN` + `CERTIFICATE_ARN` | none | Bind a custom domain (both required; cert in us-east-1) |
| `STACK_NAME` | `<SLUG>Stack` (`ABEStack`) | CloudFormation stack name |
| `ENVIRONMENT` | `dev` | `Environment` tag |
| `PRIMARY_MODEL_ID`, `FAST_MODEL_ID` | `<geo prefix>anthropic.claude-opus-4-6-v1`, `<geo prefix>anthropic.claude-sonnet-4-6` | Model or inference-profile overrides |
| `GUARDRAIL_ID`, `GUARDRAIL_VERSION` | unset, `1` | Bedrock Guardrail (empty id = disabled) |
| Brand: `BRAND_SLUG`, `ASSISTANT_NAME`, `SHORT_NAME`, `ORGANIZATION_NAME`, `PARENT_ORG`, `BRAND_TAGLINE`, `WELCOME_MESSAGE`, `SUPPORT_CONTACT`, `DOMAIN_CONTEXT`, `BRAND_TIMEZONE`, `BRAND_DEMO_VIDEO` | see [brand.ts](config/brand.ts) | Override brand fields at sync and deploy time |

## DynamoDB Tables

| Table | PK | SK | GSIs | Purpose |
|-------|----|----|------|---------|
| ChatHistoryTable | user_id | session_id | TimeIndex | Chat sessions and history |
| UserFeedbackTable | Topic | CreatedAt | CreatedAtIndex, AnyIndex | Legacy feedback submissions |
| FeedbackRecordsTable | FeedbackId | none | 5 GSIs (RecordTypeCreatedAt, ReviewStatus, Disposition, Cluster, MessageId) | Detailed feedback with disposition tracking |
| ResponseTraceTable | MessageId | none | SessionCreatedAtIndex | Audit trail for LLM responses; TTL (`expiresAt`) only for disconnect markers |
| PromptRegistryTable | PromptFamily | VersionId | none | Versioned system prompt management |
| MonitoringCasesTable | SetName | CaseId | SourceFeedbackIndex | Monitoring test cases |
| AnalyticsTable | topic | timestamp | DateIndex | Question topic classification |
| ExcelIndexDataTable | pk | sk | none | Parsed spreadsheet rows |
| IndexRegistryTable | pk | sk | none | Index definitions with AI descriptions |
| SyncHistoryTable | pk | sk | none | Sync run history (TTL: expiresAt, 90 days) |
| EvaluationSummariesTable (eval) | PartitionKey | Timestamp | none | Aggregated eval summaries |
| EvaluationResultsTable (eval) | EvaluationId | QuestionId | QuestionIndex | Per-question eval scores |
| TestLibraryTable (eval) | PartitionKey | QuestionId | NormalizedQuestionIndex (KEYS_ONLY) | Test cases for evaluation |

## S3 Buckets

| Bucket | Versioning | Purpose |
|--------|------------|---------|
| KnowledgeSourceBucket | Yes | KB documents (PDFs and other files) and `metadata.txt` |
| KnowledgeBaseSupplementalBucket | No | Bedrock KB multimodal parsing output (extracted page images) |
| FeedbackDownloadBucket | Yes | Feedback CSV exports |
| ContractIndexBucket | No | Spreadsheet index files (`indexes/{id}/latest.xlsx`) |
| DataStagingBucket | No | Staging area for the sync pipeline (`documents/`, `indexes/`) |
| EvalResultsBucket (eval) | Yes | LLM evaluation results |
| EvalTestCasesBucket (eval) | Yes | Test case files (CSV/JSON) |

The stack also creates a private website bucket and two log buckets (DESTROY with auto-delete). Without eval the stack has 8 buckets in total, with eval 10.

## Lambda Functions

Memory is the Lambda default (128 MB) unless listed.

### Core Chat
| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| ChatHandlerFunction | Node | 512 MB | 15 min | Main chat handler + agentic loop |
| SessionHandlerFunction | Python | default | 30s | Session CRUD |
| ContextSummarizerFunction | Python | default | 60s | Compact conversation history |
| FAQClassifierFunction | Python | default | 30s | Classify questions by topic |
| MetadataHandlerFunction | Python | default | 30s | S3 trigger: document summaries and `metadata.txt` |
| MetadataRetrievalFunction | Python | default | 30s | Return `metadata.txt` (fetch_metadata tool) |
| SourcePresignFunction | Node | default | 10s | Presigned URLs for source citations |
| TranscribePresignFunction | Node | default | 10s | Presigned Transcribe streaming URL for dictation |

### Knowledge Management
| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| GetS3FilesHandlerFunction | Node | default | 30s | List files and sync status |
| UploadS3FilesHandlerFunction | Node | default | 30s | Presigned upload URLs for the KB bucket |
| DeleteS3FilesHandlerFunction | Python | default | 30s | Delete KB files (removes KB chunks first; path-traversal checks) |
| SyncKBHandlerFunction | Python | default | 30s | Trigger Bedrock KB ingestion; sync status |
| SyncOrchestratorFunction | Python | 256 MB | 5 min | Staging to KB/index buckets, ingestion, backfill |
| SyncScheduleFunction | Python | default | 30s | Sync schedule and history API |

### Excel Index
| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| ExcelIndexParserFunction | Python | 512 MB | 2 min | S3 trigger: parse .xlsx to DynamoDB + AI description |
| ExcelIndexQueryFunction | Python | 256 MB | 30s | Filters, aggregations, fuzzy search |
| ExcelIndexApiFunction | Node | default | 30s | Index management API |

### Admin, Feedback, Metrics
| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| UserAdminFunction | Python | default | 15s | Invite, roles, enable, disable, delete users |
| FeedbackHandlerFunction | Python | 256 MB | 30s | Feedback, prompts, monitoring, activity log |
| MetricsHandlerFunction | Python | default | 60s | Analytics API |

### Auth and Infrastructure
| Function | Runtime | Timeout | Purpose |
|----------|---------|---------|---------|
| PreSignUpFunction | Python | 5s | Cognito PreSignUp: sign-up domain allowlist |
| AuthorizationFunction | Python | 30s | WebSocket `$connect` JWT authorizer |
| OpenSearchCreateIndexFunction | Python | 5 min | Custom resource: create the vector index |

### Evaluation Pipeline (only with `enableEval`)
| Function | Runtime | Memory | Timeout | Purpose |
|----------|---------|--------|---------|---------|
| StartLlmEvalStateMachineFunction | Node | default | 30s | Start an evaluation run |
| SplitEvalTestCasesFunction | Python | default | 30s | Split test cases (one question per chunk) |
| GenerateResponseFunction | Node | 512 MB | 15 min | Run the production agent loop for one question |
| LlmEvaluationFunction | Container (Python) | 10 GB | 15 min | RAGAS evaluation |
| AggregateEvalResultsFunction | Python | 256 MB | 120s | Average metrics across questions |
| LlmEvalResultsHandlerFunction | Python | default | 30s | Write results to DynamoDB |
| LlmEvalCleanupFunction | Python | default | 30s | Delete S3 evaluation artifacts |
| EvalResultsHandlerFunction | Python | default | 60s | Read eval summaries and results for the admin UI |
| TestLibraryHandlerFunction | Python | default | 30s | Test library CRUD with versioning |
| FeedbackToTestLibraryProcessFunction | Python | 256 MB | 90s | LLM-rewrite questions into the test library (SQS-triggered) |
| GetS3TestCasesFilesHandlerFunction | Node | default | 30s | List test case files |
| UploadS3TestCasesFilesHandlerFunction | Node | default | 30s | Presigned upload for test cases |

## Environment Variables

### Lambda (set by CDK; override in the console for testing)
| Variable | Default | Purpose |
|----------|---------|---------|
| `PRIMARY_MODEL_ID` | `<geo>anthropic.claude-opus-4-6-v1` (e.g. `us.anthropic.claude-opus-4-6-v1`) | Chat, eval judge, prompt rewrite |
| `FAST_MODEL_ID` | `<geo>anthropic.claude-sonnet-4-6` | Titles, summaries, topic classification, compaction, feedback analysis |
| `GUARDRAIL_ID`, `GUARDRAIL_VERSION` | unset (disabled), `1` | Bedrock Guardrail |
| `KB_ID` | set by CDK | Knowledge Base ID |
| `PROMPT_REGISTRY_TABLE` | set by CDK | Versioned prompt storage |
| `PROMPT_FAMILY` | `<SLUG>_CHAT` (e.g. `ABE_CHAT`) | Prompt registry partition key |
| `RESPONSE_TRACE_TABLE` | set by CDK | Audit trail table |
| `INDEX_REGISTRY_TABLE` | set by CDK | Spreadsheet index metadata |
| `METRICS_NAMESPACE` | `<SLUG>/Chat` | CloudWatch EMF namespace for chat metrics (`SessionSaveFailures`) |
| `BRAND_TIMEZONE` | from `config/brand.ts` | IANA zone for dates and schedules |
| `ASSISTANT_NAME`, `ORGANIZATION_NAME`, `SUPPORT_CONTACT`, `DOMAIN_CONTEXT` | from `config/brand.ts` | Prompt placeholders |
| `MAX_TOOL_ROUNDS` | `25` (not set by CDK) | Tool rounds per request |
| `USER_POOL_ID`, `ADMIN_GROUP_NAME` | set by CDK | User-admin Lambda |
| `ALLOWED_SIGNUP_DOMAINS` | from deployment settings | PreSignUp Lambda |

### Frontend (`.env` in `lib/user-interface/app/`, dev server only)
```
ABE_REGION=
ABE_USER_POOL_ID=
ABE_USER_POOL_CLIENT_ID=
ABE_HTTP_ENDPOINT=
ABE_WS_ENDPOINT=
ABE_SELF_SIGNUP_ENABLED=false
ABE_EVAL_ENABLED=true
```
In production CDK writes `aws-exports.json` (user pool, client, endpoints, `selfSignUpEnabled`, `evalEnabled`).

## Constraints & Gotchas

- **Docker is required for every synth and deploy** (Python bundling, the eval image). Jest tests skip bundling and need no Docker
- **KB sync is manual:** no auto-sync when files are uploaded. An admin clicks "Sync data now" (or waits for the Sunday 1 AM schedule)
- **Metadata summaries lag ingestion:** summaries need chunks in the KB, which only exist after ingestion completes. At upload time the metadata handler writes nothing; the hourly backfill fills the summary in afterward. Never summarize when retrieval returns no chunks: historically that produced "could not be retrieved" filler persisted as real summaries
- **Spreadsheet index path:** must be exactly `indexes/{index_id}/latest.xlsx`; other S3 paths are ignored by the parser
- **DynamoDB schema changes:** changing partition or sort keys requires table recreation. Use the `scope` pattern to avoid unintended logical ID changes
- **System prompt caching:** ~4K tokens, cached at Bedrock (5-min TTL). Editing [prompt.mjs](lib/chatbot-api/functions/websocket-chat/prompt.mjs) invalidates the cache temporarily
- **Prompt registry:** the prompt is loaded from DynamoDB with LIVE pointer indirection. The code default is auto-synced via SHA256 comparison. Custom versions (created_by != "system") are preserved. Evals read the LIVE prompt read-only
- **Max output tokens:** 16,384 (lowered from the Bedrock default to prevent truncation on long lists)
- **Context limits:** estimated tokens max 160K; compaction triggers at 120K (up to 3 rounds); aggressive trimming of large tool results if the ceiling is still exceeded; message length cap 10,000 characters
- **Agentic loop cap:** max 25 tool rounds per request (`MAX_TOOL_ROUNDS`); max 3 retries on transient Bedrock errors with jittered backoff
- **Citation markers:** self-managed `[N]` style; validation strips out-of-range indices. Native Bedrock citations are converted and snapped to sentence boundaries. Persisted sources drop presigned `uri`s; the UI reopens sources via `/source-presign` with the `s3Key`
- **Model permissions:** IAM allows `foundation-model/anthropic.*` in any region plus account inference profiles, so model upgrades need no IAM change (intentionally broad; inference profiles route across regions)
- **Tool result size:** capped at 60K chars via binary-search truncation; rows removed with a "results truncated" note. Full-document retrieval has its own caps (150 chunks, 120,000 chars)
- **Spreadsheet query scans:** full partition scan with in-code filtering: fine for current volumes, not indexed for scale
- **WebSocket timeouts:** client-side 120s inactivity timeout (`useWebSocketChat`), server sends a heartbeat every 20s; the chat Lambda runs up to 15 minutes
- **Stop vs. network drop:** `$disconnect` writes a TTL'd `WSDISCONNECT#<connId>` marker to `ResponseTraceTable`. On a mid-stream `GoneException` the chat handler polls for it: marker found means a deliberate stop (abort, discard, no save; a stopped answer must never reappear on reload); absent means a silent network drop (finish generating with sends suppressed and save the exchange so a reload shows the full answer)
- **Auth is native Cognito only.** Admin rights come only from the `Admin` group. The app client has SRP only, no OAuth, and write attributes limited to profile fields. The user pool is RETAIN with deletion protection; moving to a different pool schema needs a new pool
- **Self sign-up is off by default.** The PreSignUp trigger is wired even with an empty allowlist so the SignUp API stays closed
- **Cognito email:** the default sender allows about 50 emails per day; configure SES for larger rollouts
- **WAF only in us-east-1:** the CloudFront web ACL is created only when the stack region is `us-east-1` (a synth warning otherwise)
- **Region-agnostic code:** no hardcoded regions; model IDs take their geo prefix from the stack region
- **Frontend brand copy is committed:** `lib/user-interface/app/src/common/brand.ts` and `public/manifest.json` are generated by `npm run brand:sync` and committed. The deploy workflow runs `npm run brand:sync` after exporting the brand Variables, so CI can apply Variable overrides without a commit; otherwise it ships as committed. After editing `config/brand.ts`, run the sync and commit
- **CORS origin:** a lazy CDK token resolves the CloudFront (or custom) domain at synth time. Extra localhost origins only via `devCorsOrigins`
- **Custom domain is deploy-time config, not a console toggle:** `customDomain` + `certificateArn` (ACM cert in us-east-1) feed one `siteUrl` into three places: the CloudFront alias and certificate, the HTTP API and S3 CORS origin, and the Cognito invitation email link. A deploy missing the values reverts all of them to `*.cloudfront.net`. Do not hand-edit the distribution or CORS in the console (the next deploy overwrites it). Symptom of a domain bound only via console and DNS: the page loads (HTTP 200) but the UI hangs on a spinner or chat hits CORS errors. Runbook: [docs/custom-domain.md](docs/custom-domain.md)
- **One API Gateway account role per region:** a second stack in the same account and region must set `apiGatewayAccountRole=false`
- **Reserved concurrency fails in new accounts** whose total Lambda quota is 10; leave `metadataHandlerConcurrency` unset there

## Monitoring

CloudWatch dashboard: `<StackName>-Operations` (for example `ABEStack-Operations`)

39 alarms without eval, 47 with eval (publish to an SNS topic; `alarmEmail` subscribes):
- **Lambda** (per monitored function: chat, session, feedback, sync-kb, metadata handler, metrics, delete, get, upload, user admin, plus eval results with eval): errors >= 3 in two 5-min periods, throttles >= 1 in two 5-min periods
- **Chat:** average duration > 60s over three 5-min periods; any `SessionSaveFailures` EMF metric in 5 min
- **PreSignUp:** errors or rejected sign-ups >= 5 in 5 min
- **DynamoDB** (per monitored table, 7 without eval and 9 with): read throttles >= 5 and write throttles >= 5 in two 5-min periods
- **HTTP API:** 5xx >= 10 (two periods), 4xx >= 50 (three periods)
- **Step Functions (eval only):** any evaluation pipeline failure
- **SQS DLQ (eval only):** any message in the feedback-to-test-library DLQ

Dashboard rows: Lambda invocations and errors, chat latency (average and p99) and throttles, HTTP API requests, errors and latency, WebSocket connections and DynamoDB throttles, eval pipeline executions and an alarm summary.

## Evaluation Pipeline

Admin-triggered Step Functions state machine, only deployed when `enableEval` is true (6 hour execution timeout):

```
Split Test Cases -> [Map: one question each, max 3 concurrent: generate + evaluate] -> Aggregate Results -> Save to DynamoDB -> Cleanup S3
                          | (on error)
                     Pass Error -> Save partial results
```

1. Upload test cases (CSV/JSON with `question` + `expectedResponse` columns); the state machine starts
2. Split into chunks of 1 question, saved to S3
3. Each question: `GenerateResponseFunction` runs the production agent loop (same LIVE prompt, read-only; same default model; real tools) and `LlmEvaluationFunction` scores it with RAGAS 0.2.14 (judge: the primary model; embeddings: Titan V2)
4. **6 metrics computed:** similarity (semantic), correctness (answer correctness vs expected), context precision, context recall, response relevancy, faithfulness
5. Questions that fail are recorded with their error and excluded from the averages; aggregation validates scores in [0, 1]
6. Results stored in DynamoDB (`EvaluationSummariesTable` + `EvaluationResultsTable`) and S3
7. Cleanup deletes the S3 chunk and partial-result artifacts

### Feedback-to-Test-Library Pipeline
An admin promotes a piece of positive (thumbs-up) feedback from the Feedback Manager (`POST /admin/feedback/{id}/promote-to-candidate`, admin-gated). The feedback handler enqueues it to SQS; the consumer LLM-rewrites the question to be standalone and upserts it into `TestLibraryTable` with normalized-question deduplication and version history. The question and answer are read server-side from the stored response trace, not supplied by the client. Failed messages go to the DLQ after 3 attempts (retained 14 days).

## CI/CD

### Test (`test.yml`, called by deploy and PR check)
Typecheck the CDK app, Jest, Vitest, pytest (every committed `test_*.py` under `lib/`), then frontend lint, typecheck and tests. No AWS credentials, no Docker.

### PR Check (pull requests to `main`)
Runs `test.yml` with coverage (artifact plus a summary). If the `AWS_DIFF_ROLE_ARN` secret exists, writes a `cdk diff` to the job summary. Fork PRs get no secrets, so they skip the diff.

### Deploy (push to `main`, or manual)
1. Run `test.yml`
2. Only if the `AWS_ROLE_ARN` secret is set (otherwise tests only, deploy skipped): checkout, Node from `.nvmrc`, export non-empty repo Variables and Secrets as deployment settings
3. AWS OIDC role assumption (trust scoped to `repo:<owner>/<repo>:ref:refs/heads/main`; no stored keys)
4. `npm ci` (backend and frontend), `npm run brand:sync`
5. `cdk bootstrap` (idempotent), wait for stack stability (up to 30 min), `cdk deploy --require-approval never`
6. Job summary with the app URL and the `create-admin.sh` command

Repo Secrets: `AWS_ROLE_ARN`, `AWS_DIFF_ROLE_ARN`, `CERTIFICATE_ARN`, `ALARM_EMAIL`. Repo Variables: `AWS_REGION`, `STACK_NAME`, `CUSTOM_DOMAIN`, `ALLOWED_SIGNUP_DOMAINS`, `COGNITO_FEATURE_PLAN`, `ENABLE_EVAL`, `KB_PARSER_MODEL`, `API_GATEWAY_ACCOUNT_ROLE`, `ENVIRONMENT`, `PRIMARY_MODEL_ID`, `FAST_MODEL_ID`, `GUARDRAIL_ID`, `GUARDRAIL_VERSION`, `ASSISTANT_NAME`, `SHORT_NAME`, `ORGANIZATION_NAME`, `BRAND_TAGLINE`, `SUPPORT_CONTACT`, `DOMAIN_CONTEXT`, `BRAND_TIMEZONE`.

### Test Coverage
| Area | Tests | Status |
|------|-------|--------|
| CDK stack (synth, nag, Cognito, IAM, eval toggle) | Jest in `test/abe.test.ts` | Covered |
| websocket-chat (agent loop, tools, KB, citations, compaction, persistence, prompt registry, model) | Vitest | Covered |
| shared-node auth, source-presign, excel-index API, generate-response | Vitest | Covered |
| Python admin gates (every admin handler returns 403 for non-admins) | `test_admin_gates.py` | Covered |
| user-admin, pre-signup, websocket-api-authorizer, python-common auth | pytest | Covered |
| session-handler, metrics-handler, context-summarizer | pytest | Covered |
| excel-index parser and query | pytest | Covered |
| metadata-handler, metadata-retrieval | pytest | Covered |
| sync-orchestrator (backfill, placeholder detection), sync-schedule | pytest | Covered |
| eval pipeline (eval, aggregate, results-to-ddb) | pytest (`test_eval_pipeline.py`) | Covered |
| opensearch create-index | pytest | Covered |
| feedback-handler | Admin gate only | Partial |
| faq-classifier, kb-sync, delete-s3, test-library, eval-results, feedback-to-test-library, transcribe-presign, get-s3, upload-s3, start-llm-eval | none | Not tested |
| Frontend (login, chat, admin pages, hooks, api clients, a11y) | Vitest + Testing Library | Covered |

## Frontend Routes

```
/ -> Landing page (no sidebar)
/about -> Landing info (no sidebar)
/get-started -> Landing start (no sidebar)

/chatbot/* (with sidebar)
  /playground/:sessionId -> Chat UI
  /sessions -> Sessions list

/admin/* (with sidebar, admins only)
  /data -> Data management (documents, indexes, automation/sync)
  /users -> User management (invite, roles, enable/disable, delete)
  /user-feedback -> Feedback Manager (queue, trends, instructions)
  /user-feedback/:feedbackId -> Feedback details
  /metrics -> Analytics dashboard (charts via @mui/x-charts)
  /llm-evaluation -> Evaluations list (hidden when eval is disabled)
  /llm-evaluation/:evaluationId -> Detailed evaluation

/help -> Help/FAQ page
* -> 404
```

### Frontend Component Hierarchy
```
AppConfigured (aws-exports, Amplify, auth gate, theme)
  +- LoginPage (signed out)
  +- App (React Router)
     +- LandingPage / LandingPageInfo / LandingPageStart
     +- BaseAppLayout (header + drawer + content)
        +- GlobalHeader (logo, hamburger, account menu with two-step verification, theme toggle)
        +- NavigationPanel (new chat, sessions list, admin links)
        +- Outlet
           +- Playground -> Chat -> ChatMessage[] + ChatInputPanel + useWebSocketChat
           +- SessionsPage
           +- AdminRoute -> admin pages (Data, Users, Feedback, Metrics, Evaluations)
```
