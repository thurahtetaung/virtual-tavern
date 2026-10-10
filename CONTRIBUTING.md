# Contributing

## Setup

1. Install [Volta](https://volta.sh). It picks up the pinned Node and pnpm versions from `package.json`.
   pnpm support in Volta needs `export VOLTA_FEATURE_PNPM=1` in your shell profile.
2. `pnpm install`
3. `pnpm dev` starts the server on `:3000` and the web app on `:5173`.

## Checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same commands on every pull request.

## Commits and pull requests

- PRs are squash-merged, so the **PR title** becomes the commit on `main`.
- Titles follow [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`. Add `!` for breaking changes.
- Versions follow [SemVer](https://semver.org/) and releases are cut from these titles.
