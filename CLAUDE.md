# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Virtual Tavern is a private, self-hosted website for playing realtime party games with friends. It has no accounts: players join rooms through unguessable links, and only admins (who sign in with a password from the environment) can edit word lists and set the back-room password. Always call each game by its name below, never by the game it is modelled on.

- **Public** (`packages/games/`): **Codenames**, **Enigma** (team code-breaking), **Echo** (cooperative one-word clues), **Masquerade** (hidden-spy locations), **Round Table** (hidden-loyalty quests).
- **Back room** (password-gated, `packages/private-games/`, id in brackets where it differs from the name): **Reverie** (picture-clue storytelling; art in private storage), **Hoodwink** (bluffing trivia), **Royal Post** (courtship cards), Masquerade's back-room edition, **Nightfall** (one-night werewolf-style hidden roles), **Inquest** (murder deduction), **Hydra** (hidden-role election, with a themed edition), **Séance** (`seance`, cooperative ghost-and-psychics visions), **Tavern Brawl** (`tavern-brawl`, hero card brawler), **Short Fuse** (`short-fuse`, bomb cards), **Starlight** (`starlight`, picture word association), **Thorns** (`thorns`, disc bluffing), **Iconic** (`iconic`, icon-board word guessing), **Stampede** (`stampede`, answer matching), **Jeweller** (`jeweller`, gem merchants, with its Cities and Strongholds modules), **Going Once** (`going-once`, drawing and live auction), **Sketchy** (`sketchy`, drawing and fake titles), **Mosaic** (`mosaic`, tile drafting), **Encore** (`encore`, shedding cards), **Mission Control** (`mission-control`, cooperative trick-taking campaign), **Skyfire** (`skyfire`, cooperative fireworks), **Conveyor** (`conveyor`, simultaneous dish drafting), **Defuse** (`defuse`, bomb defusal: one defuser, the rest read the manual), **Cliffhanger** (`cliffhanger`, film face-off and describing in two teams), **Red Herring** (`red-herring`, picture cards with a blind Conspirator).

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

The repo is a pnpm monorepo, with ESM and strict TypeScript throughout. Subsystems get one line each below; the full detail is in `docs/architecture.md`. Read its section before changing one.

- **Imports use explicit `.ts`/`.tsx` extensions.** Workspace packages export TypeScript source and are never compiled on their own: Vite bundles them for the web, and tsup bundles them into `apps/server/dist` (`noExternal: /^@vt\//`, which is why they are server *dev*Dependencies).
- **Game plugins** (`packages/games/<id>`, private ones in `packages/private-games/<id>`) implement `GameDefinition` from `packages/game-sdk/src/types.ts`. The step-by-step guide, including the member list, lobby and timer hooks, is `docs/adding-a-game.md`; the invariants are:
  - Logic is pure and its state JSON-serialisable. Randomness comes only from `ctx.rng`, time from `ctx.now`, and word lists from `ctx.content`.
  - `reduce` **returns** a `GameError` rather than throwing.
  - `view` must strip hidden information per viewer. This is the security boundary.
  - Each game package exports `/logic` and `/ui`; the UI takes `GameUiProps` (`packages/game-sdk/src/ui.ts`) and is built from `@vt/ui` primitives (`WordListPicker`, `TimerSettings`, `Modal`, `Countdown`), with `wordPool` from `@vt/game-sdk`.
  - Registries: `apps/server/src/games/registry.ts` and `apps/web/src/games/registry.ts` (private games: `apps/web/src/games/private.ts`).
  - Design every game screen to fit a phone viewport without long scrolling (tabs on phones, as Enigma's Play / Clues / Chat).
- **Drawing canvas** (`packages/game-sdk/src/drawing.ts`, `packages/ui/src/drawing.tsx`): every drawing game uses it; drawings are checked in `reduce` with `validateDrawing`, and `view()` sends only those a viewer needs.
- **Sound panel** (`packages/ui/src/sound/`): every game with sound uses the shared per-player sliders and host controls; nothing musical plays in the lobby.
- **Colours:** UI code uses the semantic tokens in `apps/web/src/index.css` (no `dark:` partner needed); `light-mode.test.ts` rejects light-mode chromatic classes; `stone` is only for surfaces fixed in both themes, and in dark mode it follows the token ramp.
- **Rules guides** (`src/logic/guide.ts`, shown by `GuideView.tsx`): update the guide in the same change as any rule change. Back-room guides take their names from the manifest.
- **Room host** (`apps/server/src/rooms/manager.ts`):
  - It is game-agnostic. better-sqlite3 is synchronous, so each call runs to completion and actions on a room are naturally serialised.
  - Every accepted change goes through `commit()`, which bumps `version`, persists through `RoomStore` (an optimistic version check), re-arms the game's deadline timer, and emits `changed`.
  - `realtime.ts` turns `changed` into a per-socket `room:state` snapshot holding that player's own `view()` plus `serverNow`, which clients use to correct countdowns for clock skew. An unchanged view is never re-sent. Browsers that join with `patch: true` get the whole room first, then `room:patch` updates (`packages/protocol/src/patch.ts`: only what changed in that viewer's own view since update `base`, or the whole room when that is smaller); `room-connection.ts` rebuilds the snapshot and sends `room:resync` when a patch doesn't fit. The socket is never compressed (`SOCKET_OPTIONS`, tested).
  - Rooms load lazily from SQLite, and timers re-arm on load, so play survives restarts.
  - A host who is offline for `HOST_AWAY_MS` hands the role to an online player.
  - Games never hear about disconnects unless they define the optional `playerPresence(state, id, connected, now)` hook: the manager calls it when a member's first connection opens or last one closes (several tabs count as one, bots never), and as disconnected for every member when the room loads, and commits only when the state changed.
- **Table screen** (`apps/server/src/stage.ts`, web `pages/Stage*.tsx`): one TV per room, paired by the host; it gets the spectator view `view(state, null)` and, in the back room, only that room's unlock. It always runs dark (its own Light switch on the pairing page) and every game's TV is built on the shared `Poster` (`@vt/ui/show`): text ≥ 24 px, nothing focusable.
- **Identity:** the browser keeps a secret `playerToken` in localStorage, and the server derives the public player id as `sha256(token)`, so ids shown to others can't be used to impersonate anyone.
- **Linked phones** (`apps/server/src/links.ts`, `routes/link.ts`, web `pages/LinkPage.tsx`, `components/PhoneLink.tsx`): a player's PC shows a four-letter code (`room:link-code`, 2 min, single use, rate-limited); the phone redeems it at `/link` for its own key, a full second identity of the same player in that room and each next table of the night their PC joins. Presence, host hand-off and `playerPresence` see one player. In games with `ClientGame.pcTableScreen` the desktop becomes the player's own table screen. Details in `docs/architecture.md` "Linked phones".
- **Names are unique within a room** (ignoring case and spacing, `apps/server/src/rooms/names.ts`). Joining with a taken name gets the next free number ("Kim" → "Kim 2") so an invite link never bounces; renaming to a taken name is refused.
- **Player colours** (`packages/game-sdk/src/colors.ts`, `rooms/colors.ts`): one per player per room, unique, changeable any time; a game may limit its list (`GameDefinition.colors`). Stats and recaps never see colours.
- **Room shell helpers for games** (`docs/adding-a-game.md` §3, which lists every `@vt/ui` primitive): use the shared `waitingFor`, `Countdown`, `act(…, { anchor })` + `RefusalSlot`, `StickyBar`, `TabBar`, `LobbyLayout` (+ `LobbyPitch`, `LobbyStart`), `Standings`, `EndLayout` (+ `EndHero` with the game's art), `EndTabs` and `FitArea`/`useFitToScreen` (phone fit) before writing your own.
- **Persistence:** the Drizzle schema is in `apps/server/src/db/schema.ts`. After changing it, run `pnpm --filter @vt/server db:generate`; migrations in `apps/server/drizzle/` run when the new container starts. A failed deploy rolls back the image but not the schema, so every migration must be backward-compatible with the previous release (additive only; rename or drop in a later release). The `pre-deploy-<version>-*.db` backup is the manual restore point. Word lists are stored as a JSON array per list, with a `games` JSON array of the games that offer it (games set `usesWordLists`); `WordListRepo.forGame(id)` is the per-room `ctx.content`. An `enabled` flag (admin switch) hides a disabled list from `forGame` and the public `/api/word-lists`; admins still see it. The self-authored starter list (`starter-words.ts`) is seeded only when no lists exist.
- **Saved rooms outlive releases.** New game settings and state fields are optional, and a room saved by an older release must load (missing fields read as their defaults); keep such fallbacks until no saved room can need them.
- **Game settings** (`GameSettingsStore`, `/tavern-keeper/games`): on/off, categories, back-room titles and music live only in the database, never in code; everything that names or plays a game reads through the store.
- **Question decks** (`apps/server/src/question-decks.ts`, rules in `packages/protocol/src/questions.ts`): private content, **never committed**, not even as fixtures. Answers, sources, decoys and hints never appear in an HTTP response except the admin detail and export.
- **Built-in word packs** (`apps/server/word-packs/<slug>.json`) are seeded once per slug, so changing a shipped pack's file updates nothing: add a new slug instead.
- **Content packs** (`apps/server/src/content-packs.ts`): private content for back-room games, **never committed**. Every string passes through `plainText`, and no route but the admin's returns pack data.
- **Admin stats** (`apps/server/src/stats/`): the event props a game emits must match what `figures.ts`/`aggregate.ts` read, and a new game's chart colour is appended at the end of `apps/web/src/stats/palette.ts`.
- **Tavern night recap** (`apps/server/src/recap/`): every game feeds it through its `awards` module; frozen nights are served as they were, never recomputed.
- **Playtests** (`/tavern-keeper/playtest`, `routes/playtest.ts`, bots in `rooms/bots.ts`): admin-only test rooms that every stats and recap path skips; bots play from their own seat's `view()` only.
- **Edge cache** (`apps/edge`, a Cloudflare Worker): serves back-room code and art only to a verified `vt_edge` pass; its Workers Caching setting stays off.
- **Metrics** (`apps/server/src/metrics/`): served only on `METRICS_PORT`, never the app's port; labels are game ids, error codes and status classes only.
- **Config:** `apps/server/src/config.ts` reads env vars, and its default paths resolve the same way from `src/` and `dist/`. Admin auth (`admin-auth.ts`) is a signed, httpOnly cookie bound to the current password, and login is rate-limited (keyed on `cf-connecting-ip` when the peer is a local address such as the tunnel, otherwise on the peer's own address). Errors leave through `setErrorHandler` in `app.ts` as `{ error: { code, message } }`; 5xx bodies never carry the cause.

## Testing notes

- Codenames rules tests use `harness()` and `startedGame()` from `packages/games/codenames/src/logic/test-utils.ts`, which give a seeded, deterministic game with fixed seats.
- Server tests use `testApp()` and `connect()` from `apps/server/src/test/helpers.ts`. `realtime.test.ts` plays a full game across a server restart, and `manager.test.ts` covers timers and host hand-off with fake timers.
- e2e specs fail on any uncaught browser error (`pageErrors` in `e2e/codenames.spec.ts`).
- e2e specs never assume a random outcome: they read the state from the page, use a game's rig, or rely on the test seed. Specs take `test` from `e2e/fixtures.ts` (lint enforces it), which sends a seed per test (a hash of its title) with every room it creates; the e2e server runs with `VT_TEST_SEED` (`apps/server/src/rooms/test-seed.ts`, ignored when `NODE_ENV=production`), so each room's deals, colours, game rng and bot moves come from that seed and the room's version, never from what else the server is doing. No one-off visibility checks: use web-first assertions or `expect.poll`.
- The suite marks every game's first-time lobby intro as seen (`introsSeen`, the config's `storageState`), so it never covers a spec's lobby; add a new game's id there. `e2e/guides.spec.ts` clears it to test it, and `SCREENSHOTS=1 pnpm exec playwright test e2e/guide-shots.spec.ts` shoots every guide (`GUIDE_ART` may point at a private map of local art folders).
- Every Playwright worker starts its own server (the production build, `SERVER_ENV` in `playwright.config.ts`, an in-memory database) on a free port: the worker fixture `serverURL` in `e2e/fixtures.ts` makes it the `baseURL`. Specs that change server-wide state (the back-room password, question decks) run in parallel like the rest, but a worker's specs share its server one after another, so delete what a spec creates in an `afterEach`/`finally`.
- React effects must use block bodies. Newer Chrome returns a Promise from `scrollIntoView()`, and an expression-bodied effect passes that to React as its "cleanup", which crashed the board.

## Releases and deploy

- PRs are squash-merged, so the PR title is the commit and must follow Conventional Commits (enforced by `pr-title.yml`).
- CI runs once per change, on its PR (never again on `main`): format+lint, typecheck+build and unit tests as parallel jobs, the Docker build, and the e2e suite as 8 parallel shards (unit tests as 2, `vitest --shard`), each worker with its own server and in-memory database. `e2e/shards.ts` splits the spec files by the run times in `e2e/timings.json` (`node e2e/shards.ts --plan 8` shows the split); keep every spec under about 3 minutes, since a spec's tests run on one worker and the slowest spec sets a shard's floor; every spec needs a measured time there (the lint job runs `node e2e/shards.ts --check`, and the shard split refuses a spec without one): add a new spec's seconds by hand from a local run, and refresh them from a CI run's `e2e-timings-*` artifacts with `node e2e/shards.ts --update <files>`. The required check `Lint, typecheck, test, build, e2e` is a gate job that passes only when every static job and every shard pass, so keep that job name (and `Docker build`'s).
- CI fails on flaky e2e tests (`failOnFlakyTests`): a test that only passes on retry is a bug to fix. Wait for UI state with `expect.poll` or web-first assertions rather than one-off `isVisible()` checks.
- `release.yml` runs on every push to `main`. After a merged change, release-please opens or updates the Release PR (version and CHANGELOG only; opened with the workflow's token, so it gets no CI). Merging the Release PR (an admin merge, at least 60 s after its last update) makes the same workflow tag `vX.Y.Z`, publish a multi-arch image (`linux/amd64` and `linux/arm64`) to GHCR, then call `deploy.yml`, which needs approval through the `production` environment. That job joins the tailnet (Tailscale OAuth, `tag:ci`), SSHes to the server and runs `scripts/deploy.sh <version>`: back up the DB, pull, wait for health, and roll back automatically on failure. Merge to live is about 10 minutes plus the approval.
- Running `deploy.yml` by hand redeploys or rolls back to any version. One-time server, Cloudflare and GitHub setup is in `docs/deployment.md`.

## Back room (private games)

- Games with `access: 'private'` (in `packages/private-games/`) are only listed, created, joined and played by browsers that have the back room: a current `vt_backroom` unlock, or a current `vt_admin` session (the admin always has the back room, password or not). Every door (`/api/games`, titles, rooms over HTTP and socket, deck summaries, code, manifests, art, recaps, `/api/backroom/status`, which adds `admin: true` so the web shows the lobby without the door) goes through the one `hasBackroom` check in `app.ts`. The admin sets one shared password in `/tavern-keeper`; changing it, or **Sign everyone out**, bumps a version that invalidates every unlock (`apps/server/src/backroom.ts`), and admin logout revokes the admin's own. Sockets re-check the cookies on every action.
- **Never commit protected assets.** The repo is public, and `*.zip` and `private-assets/` are git-ignored. Stage files by explicit path, never `git add -A`. Art and card files live in a private Cloudflare R2 bucket; the server streams them to unlocked players at stable URLs (`/api/backroom/assets/:gameId/*`, `Cache-Control: private, max-age=1y, immutable`, so browsers keep them and the CDN never does) along with each game's `manifest.json`. Upload with `scripts/r2-upload.mjs <gameId> <folder>`, which reads credentials from `~/.config/virtual-tavern/r2-upload.env`.
- Private game UIs are registered in `apps/web/src/games/private.ts`. Vite builds them into `/backroom-assets/`, which the server serves only to unlocked browsers, with `Cache-Control: private, no-store`. Use `ProtectedImage` from `@vt/ui` for their art.

### Shared patterns of back-room games

Every back-room game follows these unless its own `CLAUDE.md` says otherwise.

- **Names.** Never write the commercial game's name, its expansions', publisher, designers, illustrators, characters, card names or any reference or fan site anywhere in the repo (code, tests, docs, commits). Where a game has a real title, it is only the DB title setting (`GameSettingsStore`), falling back to the code name.
- **Ids in code, names from the manifest.** Code uses neutral ids (numbers, plain words); real names, card text, art, sound and credits come from the game's private `<id>/manifest.json` (shape in its `src/logic/manifest.ts` or `src/ui/assets.ts`, folder layout under **Assets** in its `CLAUDE.md`). Without a manifest the game still plays, with numbered or plain-word placeholders and emoji, and is silent. Player-facing text uses name tokens (`{x}`, filled from the manifest's names) where a game needs renaming.
- **`view()` is the boundary.** Each game's `view.test.ts` checks every viewer at every stage with `JSON.stringify` or by comparing views of states whose hidden parts are changed, plus a seeded fuzz (500–1,000 games). Decks and piles never leave the server (counts only), other hands are counts, and everything is shown at the end.
- **State.** `phase` is `lobby`/`playing`/`over` for the stats recorder; `stage` is the real step. `insights` feed the stats page and the awards.
- **Timers.** Soft by default (a reminder and the host's Act for), strict optional. Strict timers, Act for and players who left (after `LEFT_BEAT_MS`, 3 s) all make the game's safe move (often the bot's). Where a game lets the host `remove` a player who left, that player leaves play and one player left ends the game.
- **Rulings.** "The owner's rulings" are deliberate rule choices, tested in the game's `game.test.ts` and listed in its guide; never change one without asking.
- **Testing.** A game's env test rig (`<ID>_TEST_*`) is ignored when `NODE_ENV=production` and set in `playwright.config.ts`, so its e2e spec knows the deal; `<ID>_ART=<folder>` serves local art to its screenshot spec (`STARLIGHT_ART`, `SHORT_FUSE_ART`, `JEWELLER_ART`, `MOSAIC_ART`, `ENCORE_ART`, `SKYFIRE_ART`, `CONVEYOR_ART`, `DEFUSE_ART`, `CLIFFHANGER_ART`, `RED_HERRING_ART`).
- First-time tips and per-player marks use `storageKey()`.
- **Cover.** A manifest may name `cover` (16:9, 800×450), `coverFull` and `coverDarkDim` (`ManifestCover` in `packages/game-sdk/src/cover.ts`); the back-room lobby shows the cover in the game's card, and a game without one shows its emoji emblem there.

## Each game

Every game except Codenames has its own `CLAUDE.md` in its package (`packages/games/<id>/CLAUDE.md`, `packages/private-games/<id>/CLAUDE.md`): its ids, rules and the owner's rulings, what its `view()` hides, its test rig and its asset layout. Read it before changing that game, and update it in the same change. A new game ships with one in the same style.

## Conventions

- Never mention or link existing online party-game websites in code or docs. Ship self-authored word lists, never the official Codenames card list.
