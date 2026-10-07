# Security policy

## Supported versions

Only the `main` branch is supported. Fixes land on `main` and are not
back-ported. If you run a fork or a pinned commit, update to the latest `main`
to receive security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue or pull
request for a security problem.

Use GitHub's private vulnerability reporting: on the repository page, open the
**Security** tab, choose **Report a vulnerability**, and fill in the advisory
form. This opens a private thread with the maintainers.

Helpful details to include:

- What the issue is and which component it affects (for example the chat
  Lambda, an admin API, the Cognito configuration, the CDK stack).
- Steps to reproduce, or a proof of concept.
- The commit or deployment settings you tested against.
- The impact you expect (data exposure, privilege escalation, denial of
  service, and so on).

We aim to acknowledge a report within 5 business days and to share a
remediation plan or a fix timeline within 15 business days. We will credit you
in the advisory if you want to be named.

## Scope

In scope: the code in this repository, including the CDK infrastructure it
deploys, the Lambda functions, and the web app.

Out of scope: vulnerabilities in AWS services themselves, in third-party
dependencies with no exploitable path in this project (report those upstream),
and findings that need an already-compromised admin account or AWS account.

## Deploying safely

The README has a security model section covering authentication, the Admin
group, data retention and logging. If you operate a deployment, keep
dependencies current, restrict who holds AWS and Cognito admin access, and
review the README's deployment settings that affect exposure (self sign-up
domains, custom domain, CORS origins).
