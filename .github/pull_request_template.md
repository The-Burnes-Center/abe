## What and why

<!-- What does this change do, and why is it needed? Link the issue if there is one. -->

## Changes

-

## Test plan

<!-- How did you verify this? List the commands you ran and what you checked by hand. -->

- [ ] `npm test` (CDK Jest tests)
- [ ] `npm run test:lambda` (Node Lambda tests)
- [ ] `pytest` on the Python tests under `lib/`
- [ ] Frontend: `npm run lint`, `npx tsc --noEmit`, `npm test` in `lib/user-interface/app`
- [ ] Manual check (describe):

## Checklist

- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, ...)
- [ ] New behavior has tests
- [ ] Docs updated (README, CLAUDE.md, `docs/`) if behavior, settings or env vars changed
- [ ] If `config/brand.ts` changed, I ran `npm run brand:sync` and committed the result
- [ ] No secrets, account IDs or personal data in the diff
