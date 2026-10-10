## What

<!-- What does this change and why? -->

## How to test

<!-- Steps a reviewer can follow. -->

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(codenames): add turn timer`)
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] `pnpm build && pnpm e2e` pass locally
- [ ] If a game's rules changed, its guide (`src/logic/guide.ts`) is updated in this PR
