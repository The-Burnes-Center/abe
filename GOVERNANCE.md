# Governance

ABE is a small open-source project run by AI for Impact, a nonprofit program. This document says who decides what, and how. It is kept short on purpose.

## Roles

- **Users** deploy and use ABE. They ask questions in [Discussions](https://github.com/The-Burnes-Center/abe/discussions) and report bugs as issues.
- **Contributors** send pull requests, write docs, review changes, triage issues or answer questions. Anyone can be one. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Maintainers** review and merge pull requests, cut releases, handle security reports and enforce the Code of Conduct. They are listed in [MAINTAINERS.md](MAINTAINERS.md), which also explains how to become one.

## How decisions are made

Most decisions use lazy consensus. A change is proposed in an issue or pull request. If nobody with a stake objects after a reasonable wait (usually a few days, longer for large changes), a maintainer can approve it. Silence is treated as agreement, so say so if you disagree.

When there is no consensus, the maintainers decide. With one maintainer, that maintainer decides, and explains the reasoning in the thread. With several, a simple majority decides, and the lead maintainer breaks ties. Decisions can be revisited when new facts appear.

`main` is protected. Every change lands through a pull request with passing CI and a maintainer review. Admins can bypass this for emergencies, such as a broken deploy or a security fix, and should say so in the pull request or commit message when they do.

## What needs an issue or discussion first

Open an issue or Discussion and reach agreement before writing code for:

- **Breaking changes**: anything that changes a CDK context key, environment variable, stack output, resource name, DynamoDB key schema, or API route in a way that forces existing deployments to change something or recreate a resource.
- **New AWS services** or a new dependency that changes cost, quotas or required permissions.
- **Changes to the auth or security model**: Cognito settings, the Admin group, the authorizers, IAM permissions, public exposure of any resource, or the data retention behavior.
- **Large refactors** and anything that touches the evaluation pipeline's scoring.

Small fixes, docs, tests and dependency updates can go straight to a pull request.

## Releases

- Versions follow [Semantic Versioning](https://semver.org/). Before 1.0.0 the API was not stable. From 1.0.0, a breaking change means a new major version.
- User-visible changes are recorded in [CHANGELOG.md](CHANGELOG.md) in the same pull request, under `Unreleased`, in [Keep a Changelog](https://keepachangelog.com/) format.
- To release, a maintainer moves the `Unreleased` entries under a new version heading with the date, updates the version in `package.json`, `lib/user-interface/app/package.json` and `CITATION.cff`, merges that through a pull request, then tags the merge commit (`vX.Y.Z`) and publishes a GitHub Release with the changelog entries as its notes.
- Only the latest release and `main` receive fixes (see [SECURITY.md](SECURITY.md)).

## Support expectations

ABE is maintained on a best-effort basis. There is no service level agreement, and no promise of a reply time, a fix or a release date. See [SUPPORT.md](SUPPORT.md).

## Changing this document

Changes to governance go through a pull request, with a Discussion first if they change how decisions are made.

## Handover and archival

If AI for Impact can no longer maintain the project, the maintainers will:

1. Say so in the README and a pinned Discussion, with as much notice as possible.
2. Look for new maintainers among active contributors, or transfer the repository to another organization that agrees to run it.
3. If nobody takes it on, make a final release, mark the repository as archived (read-only) and point to any active fork they know of.

The code is MIT licensed, so anyone can fork it at any time. Releases and the history stay available after archival.
