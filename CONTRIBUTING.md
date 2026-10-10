# Contributing

## Setup

1. Install [Volta](https://volta.sh). It picks up the pinned Node and pnpm versions from `package.json`.
   pnpm support in Volta needs `export VOLTA_FEATURE_PNPM=1` in your shell profile.
2. `pnpm install`
3. `pnpm dev` starts the server on `:3000` and the web app on `:5173`.

## Checks

```sh
pnpm format:check        # Prettier (`pnpm format` fixes)
pnpm lint
pnpm typecheck
pnpm test
pnpm build && pnpm e2e   # Playwright against the production build
```

CI (`.github/workflows/ci.yml`) runs on every pull request and on `main`:

- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- `pnpm e2e` with Chromium (`pnpm exec playwright install --with-deps chromium` first if you don't have it)
- a Docker image build (`docker compose build` is the local equivalent)

A flaky e2e test fails CI (`failOnFlakyTests`), so a test that only passes on retry is a bug to fix.

## Commits and pull requests

- PRs are squash-merged, so the **PR title** becomes the commit on `main`.
- Titles follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Add `!` for breaking changes.
- Versions follow [SemVer](https://semver.org/) and releases are cut from these titles.
- When a change alters a game's rules, update that game's guide (`src/logic/guide.ts`) in the same PR.
