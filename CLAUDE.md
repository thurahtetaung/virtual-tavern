# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Virtual Tavern is a private, self-hosted website for playing realtime party games with friends. The platform hosts multiple games: **Codenames** and **Enigma** (a team code-breaking game; only ever call it Enigma). It has no accounts: players join rooms through unguessable links, and only admins (who sign in with a password from the environment) can edit word lists.

## Toolchain

- Node and pnpm are pinned by **Volta** in the root `package.json` (`volta` field). There is no `.nvmrc`. The `packageManager`, `engines`, the CI `setup-node` (`node-version-file: package.json`) and the `Dockerfile` `NODE_VERSION`/`PNPM_VERSION` args must all stay in sync with that pin.
- Shell commands need `export PATH="$HOME/.volta/bin:$PATH" VOLTA_FEATURE_PNPM=1`, or Volta can't find pnpm.
- pnpm is held at **11.x**. pnpm 12 ships a native binary that Volta's launcher can't run.
- TypeScript is held at **~6.0** because typescript-eslint supports `<6.1` only.
- pnpm 11 blocks dependency build scripts. Any dependency that needs one must be listed under `allowBuilds` in `pnpm-workspace.yaml`; `pnpm approve-builds <pkg>` adds it.
- Never pass `-g` through `pnpm` (`pnpm e2e -g x`): Volta takes it as "global". Use `pnpm exec playwright test --grep x`.

## Commands

```sh
pnpm dev                 # server :3000 (tsx watch) + web :5173 (Vite proxies /api, /healthz, /socket.io)
pnpm lint                # ESLint (typed) over the whole repo, e2e included
pnpm typecheck           # root tsconfig (configs + e2e) then tsc --noEmit in every package
pnpm test                # Vitest across all workspace projects
pnpm format:check        # Prettier; `pnpm format` to fix
pnpm build               # tsup bundles the server, Vite builds the web app
pnpm e2e                 # Playwright against the production build: run `pnpm build` first

pnpm vitest run apps/server/src/realtime.test.ts   # one file
pnpm vitest run -t "server restart"                 # by test name
pnpm vitest run --project codenames                # one workspace project
SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts   # UI screenshots -> test-results/shots
docker compose up --build                          # production container locally (see docs/deployment.md)
```

To check workflow and shell edits, run `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest` and `docker run --rm -v "$PWD":/mnt koalaman/shellcheck:stable scripts/deploy.sh`. Third-party actions are pinned to commit SHAs, with the version in a trailing comment.

## Architecture

The repo is a pnpm monorepo, with ESM and strict TypeScript throughout.

- **Imports use explicit `.ts`/`.tsx` extensions.** Workspace packages export TypeScript source and are never compiled on their own: Vite bundles them for the web, and tsup bundles them into `apps/server/dist` (`noExternal: /^@vt\//`, which is why they are server *dev*Dependencies).
- **Game plugins** (`packages/games/<id>`) implement `GameDefinition` from `packages/game-sdk/src/types.ts`:
  - Members: `actionSchema` (zod), `create`, `reduce`, `playerJoined` (upsert, also used for renames), `playerLeft`, `view`, the required `guide`, and optional `nextDeadline`/`onDeadline` for timers.
  - Logic is pure and its state JSON-serialisable. Randomness comes only from `ctx.rng`, time from `ctx.now`, and word lists from `ctx.content`.
  - `reduce` **returns** a `GameError` rather than throwing.
  - `view` must strip hidden information per viewer. This is the security boundary.
  - A game handles its own lobby (seats, settings) as ordinary actions, and the room host supplies `isHost`.
  - Each game package exports `/logic` and `/ui`. The UI component takes `GameUiProps` (`packages/game-sdk/src/ui.ts`), built from the `@vt/ui` primitives.
  - Registries: `apps/server/src/games/registry.ts` and `apps/web/src/games/registry.ts`.
  - Steps for adding a game: `docs/adding-a-game.md`. Shared lobby widgets (`WordListPicker`, `TimerSettings`, `Modal`, `Countdown`) live in `@vt/ui`, and `wordPool` lives in `@vt/game-sdk`.
  - **Enigma** (`packages/games/enigma`): votes only resolve when every eligible teammate has picked the same code and pressed Lock in. Team chat and shared notes live in game state and are filtered per team by `view()`. On phones the play screen is split into Play / Clues / Chat tabs (`EnigmaGame.tsx`); design every game screen to fit a phone viewport without long scrolling.
- **Rules guides:** each game's `GameGuide` (`src/logic/guide.ts`) renders on `/rules/:gameId` and in the in-room rules drawer, through `apps/web/src/components/GuideView.tsx`. Update the guide in the same change as any rule change.
- **Room host** (`apps/server/src/rooms/manager.ts`):
  - It is game-agnostic. better-sqlite3 is synchronous, so each call runs to completion and actions on a room are naturally serialised.
  - Every accepted change goes through `commit()`, which bumps `version`, persists through `RoomStore` (an optimistic version check), re-arms the game's deadline timer, and emits `changed`.
  - `realtime.ts` turns `changed` into a per-socket `room:state` snapshot holding that player's own `view()` plus `serverNow`, which clients use to correct countdowns for clock skew.
  - Rooms load lazily from SQLite, and timers re-arm on load, so play survives restarts.
  - A host who is offline for `HOST_AWAY_MS` hands the role to an online player.
- **Identity:** the browser keeps a secret `playerToken` in localStorage, and the server derives the public player id as `sha256(token)`, so ids shown to others can't be used to impersonate anyone.
- **Persistence:** the Drizzle schema is in `apps/server/src/db/schema.ts`. After changing it, run `pnpm --filter @vt/server db:generate`; migrations in `apps/server/drizzle/` run at startup. Word lists are stored as a JSON array per list. The self-authored starter list (`starter-words.ts`) is seeded only when no lists exist.
- **Built-in word packs** are `apps/server/word-packs/<slug>.json` (`{slug, name, description, words}`; file name must match the slug; entries ≤ 20 chars, ≥ 100 unique words). On startup `WordListRepo.seedPacks` adds any pack whose slug isn't in `seeded_packs` yet, exactly once, so admin edits and deletions stick. Changing a shipped pack's file does not update existing databases; add a new slug instead. `word-packs.test.ts` validates every pack file.
- **Config:** `apps/server/src/config.ts` reads env vars, and its default paths resolve the same way from `src/` and `dist/`. Admin auth (`admin-auth.ts`) is a signed, httpOnly cookie, and login is rate-limited (keyed on `cf-connecting-ip`).

## Testing notes

- Codenames rules tests use `harness()` and `startedGame()` from `packages/games/codenames/src/logic/test-utils.ts`, which give a seeded, deterministic game with fixed seats.
- Server tests use `testApp()` and `connect()` from `apps/server/src/test/helpers.ts`. `realtime.test.ts` plays a full game across a server restart, and `manager.test.ts` covers timers and host hand-off with fake timers.
- e2e specs fail on any uncaught browser error (`pageErrors` in `e2e/codenames.spec.ts`).
- React effects must use block bodies. Newer Chrome returns a Promise from `scrollIntoView()`, and an expression-bodied effect passes that to React as its "cleanup", which crashed the board.

## Releases and deploy

- PRs are squash-merged, so the PR title is the commit and must follow Conventional Commits (enforced by `pr-title.yml`).
- CI fails on flaky e2e tests (`failOnFlakyTests`): a test that only passes on retry is a bug to fix. Wait for UI state with `expect.poll` or web-first assertions rather than one-off `isVisible()` checks.
- release-please (`release.yml`) runs only after CI succeeds on `main` (`workflow_run`), and keeps a Release PR open. Merging it tags `vX.Y.Z`, publishes a multi-arch image to GHCR, then calls `deploy.yml`, which needs approval through the `production` environment. That job joins the tailnet (Tailscale OAuth, `tag:ci`), SSHes to the server and runs `scripts/deploy.sh <version>`: back up the DB, pull, wait for health, and roll back automatically on failure.
- Running `deploy.yml` by hand redeploys or rolls back to any version. One-time server, Cloudflare and GitHub setup is in `docs/deployment.md`.

## Back room (private games)

- Games with `access: 'private'` (in `packages/private-games/`) are only listed, created, joined and played by browsers holding a current `vt_backroom` unlock. The admin sets one shared password in `/admin`; changing it, or **Sign everyone out**, bumps a version that invalidates every unlock (`apps/server/src/backroom.ts`). Sockets re-check the cookie on every action.
- **Never commit protected assets.** The repo is public, and `*.zip` and `private-assets/` are git-ignored. Stage files by explicit path, never `git add -A`. Art and card files live in a private Cloudflare R2 bucket; the server hands unlocked players 10-minute signed links (`/api/backroom/assets/:gameId/*`) and each game's `manifest.json`. Upload with `scripts/r2-upload.mjs <gameId> <folder>`, which reads credentials from `~/.config/virtual-tavern/r2-upload.env`.
- Private game UIs are registered in `apps/web/src/games/private.ts`. Vite builds them into `/backroom-assets/`, which the server serves only to unlocked browsers, with `Cache-Control: private, no-store`. Use `ProtectedImage` from `@vt/ui` for their art.
- The Peek demo (`packages/private-games/demo`) is the template for new private games. It is registered only with `ENABLE_DEMO_PRIVATE_GAME=1`, as in e2e, and never in production.

## Conventions

- Never mention or link existing online party-game websites in code or docs. Ship self-authored word lists, never the official Codenames card list.
