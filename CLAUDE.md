# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Virtual Tavern is a private, self-hosted website for playing realtime party games with friends. The platform hosts multiple games, and Codenames is the first one. The full design is in the approved plan; its key points are summarised under Architecture below.

## Toolchain

- Node and pnpm are pinned by **Volta** in the root `package.json` (`volta` field). There is no `.nvmrc`. The `packageManager`, `engines`, the CI `setup-node` (`node-version-file: package.json`) and the Docker base image must all stay in sync with that pin.
- Shell commands need `export PATH="$HOME/.volta/bin:$PATH" VOLTA_FEATURE_PNPM=1`, or Volta can't find pnpm.
- pnpm is held at **11.x**. pnpm 12 ships a native binary that Volta's launcher can't run.
- TypeScript is held at **~6.0** because typescript-eslint supports `<6.1` only. Don't move to TS 7 until it does.
- pnpm 11 blocks dependency build scripts. Any dependency that needs one (e.g. `better-sqlite3`) must be listed under `allowBuilds` in `pnpm-workspace.yaml`; `pnpm approve-builds <pkg>` adds it.

## Commands

```sh
pnpm install
pnpm dev                 # server :3000 (tsx watch) + web :5173 (Vite proxies /api, /healthz, /socket.io)
pnpm lint                # ESLint (typed, projectService) over the whole repo
pnpm typecheck           # tsc --noEmit in every package
pnpm test                # Vitest across all workspace projects
pnpm format:check        # Prettier; `pnpm format` to fix
pnpm build               # tsup bundles the server, Vite builds the web app

pnpm vitest run apps/server/src/app.test.ts   # one file
pnpm vitest run -t "reports ok"               # by test name
pnpm vitest run --project server              # one workspace project
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, `test` and `build`. Check workflow edits with `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest`. Third-party actions are pinned to commit SHAs, with the version in a trailing comment.

## Architecture

The repo is a pnpm monorepo (`apps/*`, `packages/*`, `packages/games/*`), with ESM and strict TypeScript throughout.

- **Imports use explicit `.ts` extensions** (`allowImportingTsExtensions`, with `noEmit` everywhere). Workspace packages export TypeScript source and are never compiled on their own.
- The **server** (`apps/server`) is Fastify. `src/app.ts` `buildApp()` builds the instance and tests use `app.inject()`, while `src/index.ts` only listens. The tsup build bundles `@vt/*` workspace packages in (`noExternal`) and leaves npm deps external. This is needed because Node won't type-strip `.ts` under `node_modules`.
- The **web** app (`apps/web`) is React 19, React Router 8 and Tailwind 4 (via `@tailwindcss/vite`). In production the server serves its build.

Planned structure, being built milestone by milestone:

- **Game plugins:** each game implements a `GameDefinition` (`packages/game-sdk`): zod config and action schemas, plus `setup`, `reduce`, `view` (which removes secrets per viewer), optional `nextDeadline`/`onDeadline` for timers, and `isOver`. Game logic is pure, with no I/O. A game package such as `packages/games/codenames` exports `/logic` and `/ui` separately. Server and client registries map `gameId` to each part.
- **Room host** (`apps/server/src/rooms/`): game-agnostic. It processes one action at a time per room, persists state after every accepted action, and broadcasts each player's own `view()` over Socket.IO. Timers are owned by the server and re-armed after a restart.
- **Persistence:** SQLite through Drizzle, behind a `RoomStore` interface so the store can be swapped or sharded by room ID later.
- **Identity:** no accounts. Each browser keeps a random `playerToken` in localStorage, and rooms are reached by unguessable slug links. Admins, who are the only ones allowed to edit word lists, sign in with `ADMIN_PASSWORD` and get a signed cookie.
- **Deploy:** one Docker container plus `cloudflared` on an Oracle ARM VPS (no inbound ports). release-please → GHCR image → deploy over SSH through Cloudflare Access, with a health-check rollback.

## Conventions

- PRs are squash-merged, so the PR title is the commit and must follow Conventional Commits (enforced by `pr-title.yml`). release-please derives SemVer versions and `CHANGELOG.md` from those titles.
- Never mention or link existing online party-game websites in code or docs. Ship self-authored word lists, never the official Codenames card list.
