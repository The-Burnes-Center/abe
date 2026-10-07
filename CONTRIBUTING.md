# Contributing to ABE

Thanks for helping. This guide covers setting up a development environment, how changes flow into `main`, and the checks every pull request has to pass. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Ways to help

- Report a bug or propose a feature with an issue (templates are provided).
- Improve the docs: the README, `docs/`, and code comments.
- Pick up an open issue. For anything bigger than a small fix, comment on the issue first so we can agree on the approach before you write code.

## Development setup

Prerequisites: Git, Node.js 22 (`.nvmrc` pins it, `nvm use` picks it up), Docker running (needed to run `cdk synth` and `cdk deploy`, see below), and Python 3.12 if you want to run the Python tests. You do not need an AWS account to run the unit tests.

```bash
git clone https://github.com/The-Burnes-Center/abe.git
cd abe
nvm use
npm ci                              # backend and CDK dependencies
npm --prefix lib/user-interface/app ci   # frontend dependencies
```

Deploying a copy of the stack to your own AWS account (recommended before you change infrastructure) is covered in the [README quick start](README.md#quick-start). For frontend work against a deployed backend, see [Local development](README.md#local-development).

## Branches and pull requests

1. Fork the repository and branch from `main` (`feat/short-name`, `fix/short-name`).
2. Make small, focused commits.
3. Run the checks below before you push.
4. Open a pull request against `main` and fill in the template, including the test plan.
5. CI (`.github/workflows/test.yml`, called by `pr-check.yml`) runs the same checks. Expect a green run and a maintainer review before merge.

`main` deploys automatically in repositories that configure AWS credentials (see [CI/CD](README.md#cicd-with-github-actions)), so keep `main` releasable.

## Commit messages

Use Conventional Commits: `<type>: <description>`, where type is one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. Keep the description short and in the imperative ("add", not "added"). Explain the why in the body when it is not obvious.

## Tests are required

Every behavior change needs a test. Run what applies to your change, and run all of them before opening the pull request.

```bash
# CDK stack tests (Jest). Synthesis tests run without Docker or a frontend build.
npm test

# TypeScript check for the CDK app
npx tsc --noEmit

# Node Lambda unit tests (Vitest): every *.test.mjs under lib/chatbot-api/functions
npm run test:lambda

# Python Lambda tests (pytest). Same file selection as CI.
python3 -m pip install pytest pytest-cov "moto[cognitoidp]" boto3 pydantic openpyxl "PyJWT[crypto]" cryptography opensearch-py
python3 -m pytest $(git ls-files 'lib/*test_*.py' | grep -E '/test_[^/]+\.py$')

# Frontend (from lib/user-interface/app)
npm run lint          # ESLint, zero warnings allowed
npx tsc --noEmit
npm test              # Vitest + Testing Library
```

Infrastructure changes should also pass `npx cdk synth` (this needs Docker) and keep the cdk-nag checks clean. Add a suppression only with a specific reason, next to the resource it applies to.

## Code style

Match the surrounding code's idiom, comment density and naming. The project conventions are in [CLAUDE.md](CLAUDE.md); the short version:

- **Simplicity:** the simplest thing that works. Add an abstraction only when the repetition is real. Prefer new objects to mutating existing ones, early returns to stacked conditionals, and named constants to magic numbers.
- **Size:** files of 200 to 400 lines (800 is the hard limit) and functions under 50 lines.
- **Naming:** `camelCase` values, `PascalCase` types and components, `UPPER_SNAKE_CASE` constants, a `use` prefix for hooks, and `is`/`has`/`should`/`can` for booleans.
- **Errors:** handle them explicitly. Show a friendly message in the UI, log the detail on the server, and never swallow an error silently. Validate at system boundaries and fail fast.
- **Secrets:** no hardcoded secrets. Use environment variables or a secret manager.
- **CDK:** create sub-resources on `scope` (not `this`) inside constructs so CloudFormation logical IDs stay stable. Every application Lambda spreads `LAMBDA_DEFAULTS` from `lib/shared/lambda-defaults.ts`. Keep resources split by concern (`functions.ts`, `tables.ts`, `buckets.ts`).
- **Node Lambdas:** ESM (`.mjs`), AWS SDK v3 modular imports.
- **Python Lambdas:** shared helpers (auth, logging, responses) live in the layer `lib/chatbot-api/functions/layers/python-common`. Return structured JSON errors, catch exceptions explicitly, and log structured JSON.
- **Admin checks:** admin APIs are gated on membership of the Cognito `Admin` group, using the shared helpers (`common_utils/auth.py`, `shared-node/auth.mjs`, `isAdmin` in the frontend). Do not write a new ad hoc check.
- **Frontend:** route-level code splitting with `React.lazy`, MUI theming through `src/common/theme.ts`.

### Branding

If you change `config/brand.ts`, run `npm run brand:sync` and commit the regenerated files under `lib/user-interface/app` (`src/common/brand.ts`, `public/manifest.json`). A plain `npx cdk deploy` and the tests do not regenerate them (the deploy workflow does, but only to apply brand Variables).

### Docs

Update the README, `CLAUDE.md` and `docs/` in the same pull request when you change behavior, settings, environment variables, routes or the architecture. If the architecture changes, update `docs/generate_architecture.py` and regenerate `docs/architecture.png` (instructions are at the top of the script).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
