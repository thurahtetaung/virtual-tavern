# Deployment

Production is one container on a small VPS (an Oracle Cloud free-tier ARM instance):

- **app**: the game server, which also serves the web app. It is published on `127.0.0.1:${APP_PORT}`, and SQLite lives in the `tavern-data` volume.
- **cloudflared**, already running on the host as a systemd service, routes the public hostname to `http://localhost:${APP_PORT}`. The VPS needs **no open inbound ports**.
- **Tailscale** connects GitHub Actions to the VPS for deploys. CI joins the tailnet as a short-lived `tag:ci` node and SSHes in over the tailnet.

```
open a PR ─▶ CI (the only CI run a change gets)
merge PRs to main ─▶ release-please opens/updates a "Release PR" (no CI of its own)
merge the Release PR ─▶ tag vX.Y.Z + GitHub Release
                      ─▶ multi-arch image pushed to ghcr.io/thurahtetaung/virtual-tavern
                      ─▶ deploy waits for your approval ─▶ Tailscale + SSH ─▶ scripts/deploy.sh
                      ─▶ DB backup, health check, automatic rollback if the new version is unhealthy
                      ─▶ old images removed, keeping the newest 5 versions
```

## One-time setup

### 1. Server

Deploys run as the server's regular login user (here `ubuntu`, which is in the `docker` group), in `~/virtual-tavern`.

```sh
mkdir -p ~/virtual-tavern
```

Authorise a dedicated CI key (generated with `ssh-keygen -t ed25519 -f virtual-tavern-deploy -N ""`). Limit it to tailnet addresses and switch off forwarding, so it can't be used from anywhere else:

```sh
echo "from=\"100.64.0.0/10,fd7a:115c:a1e0::/48\",restrict $(cat virtual-tavern-deploy.pub)" >> ~/.ssh/authorized_keys
```

Create `~/virtual-tavern/.env` (mode 600) from [`.env.example`](../.env.example). Set `ADMIN_PASSWORD`, `SESSION_SECRET` (`openssl rand -hex 32`) and `APP_PORT`, the port the tunnel's hostname points at.

Daily database backups (`crontab -e`):

```
15 3 * * * cd ~/virtual-tavern && docker compose exec -T app node dist/backup.js >/dev/null
```

Backups land in the volume under `/data/backups` and the newest 14 are kept. Each deploy also takes a backup first, named `pre-deploy-<version>-<timestamp>.db`.

**Off-site copies.** Backups never leave the Docker volume on their own, so a lost VPS means lost rooms and word lists. Copy them off the box after the nightly backup, for example by extending the cron line:

```
15 3 * * * cd ~/virtual-tavern && docker compose exec -T app node dist/backup.js >/dev/null && docker compose cp app:/data/backups ./backups && rclone sync ./backups remote:virtual-tavern-backups
```

`scp -r backups other-host:` works just as well. The app itself cannot push them anywhere: its R2 token is read-only, and a separate write token would be needed to send backups to a bucket.

A nightly off-site job that writes its result to `/data/backups/offsite-status.json` (`{ at, ok, key, bytes, copies, totalBytes, error? }`) shows on `/tavern-keeper` as "Last offsite backup: …", with a warning when the last run failed or the last success is over 26 hours old.

### 2. Cloudflare

In Zero Trust → Networks → Tunnels, point the site's public hostname at `http://localhost:<APP_PORT>`.

### 3. Tailscale

In the Tailscale admin console:

1. **Access controls:** declare the CI tag and allow it to reach the server's SSH port only. For example:
   ```jsonc
   "tagOwners": { "tag:ci": ["autogroup:admin"] },
   "grants": [{ "src": ["tag:ci"], "dst": ["<server tailnet IP or tag>"], "ip": ["tcp:22"] }]
   ```
   If your policy still has the default allow-all rule, only `tagOwners` is needed.
2. **Settings → OAuth clients → Generate**, with the _Auth Keys: write_ scope and tag `tag:ci`. Note the client ID and secret.

### 4. GitHub

In the repository settings:

- **General → Pull Requests**: allow squash merging only, and use the PR title as the commit message.
- **Actions → General → Workflow permissions**: tick _Allow GitHub Actions to create and approve pull requests_. release-please needs this.
- **Branches → main**: require a PR and the status checks _Lint, typecheck, test, build, e2e_, _Docker build_, _Conventional Commit title_ and _analyze_.
- **Environments → New environment `production`**: add yourself as a required reviewer, then add:

  | Secret                                   | Value                                                            |
  | ---------------------------------------- | ---------------------------------------------------------------- |
  | `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | the Tailscale OAuth client                                       |
  | `DEPLOY_HOST`                            | the server's tailnet IP                                          |
  | `DEPLOY_USER`                            | the login user, e.g. `ubuntu`                                    |
  | `DEPLOY_SSH_KEY`                         | the private CI key                                               |
  | `DEPLOY_KNOWN_HOSTS`                     | `ssh-keyscan -t ed25519 <tailnet IP>` run from a tailnet machine |

  | Variable     | Value                                                     |
  | ------------ | --------------------------------------------------------- |
  | `DEPLOY_DIR` | optional; defaults to `virtual-tavern` in the user's home |

After the first release publishes, set the `virtual-tavern` package's visibility to **Public** on GitHub, so the VPS can pull it without logging in.

### 5. Private game assets (optional)

Back-room games keep their art in a private Cloudflare R2 bucket.

1. In the Cloudflare dashboard, enable **R2** and create a bucket (for example `virtual-tavern-private`). Leave public access off.
2. **R2 → Manage API tokens → Create**: give the server an **Object Read** token scoped to that bucket, and add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to the server's `.env`.
3. Create a separate **Object Read & Write** token for uploads, and keep it on your own machine in `~/.config/virtual-tavern/r2-upload.env`, never on the server or in the repo.
4. Open `/tavern-keeper` → **Back room** and set the password.
5. Upload a game's assets from the dev machine: `node scripts/r2-upload.mjs <gameId> <folder>` (dry-run first). Each back-room game's folder layout and `manifest.json` shape is under **Assets** in its package's `CLAUDE.md` (`packages/private-games/<id>/CLAUDE.md`).
6. **Back-room titles.** The repository only uses each private game's code name. Set the title unlocked players see on `/tavern-keeper/games` (the game's card), or from the dev machine: `ADMIN_PASSWORD=… node scripts/set-game-title.mjs https://<host> nightfall "<title>"` (`--clear` removes it, `--list` shows them all). The title is stored in the database (`app_settings`, key `private_game_titles`) and sent only to unlocked browsers.
7. **Game categories.** The filter chips on the game lists live only in the database (`app_settings`, key `game_settings`), never in the repository; with none set, the lists show no chips. Edit them on `/tavern-keeper/games`, or apply a private JSON file (`{ "categories": [{ "id", "name", "emoji" }], "games": { "<gameId>": ["<categoryId>", …] } }`) from the dev machine: `ADMIN_PASSWORD=… node scripts/set-game-categories.mjs https://<host> <file.json> [--dry-run]`. It adds or updates the categories by id, puts them first in the file's order, and gives each listed game exactly its listed categories; games the server doesn't have yet are skipped, so run it again after a new game goes live.
8. **Switching a game off.** Each game's card on `/tavern-keeper/games` has an on/off switch (`game_settings` too, on by default). A game that is off leaves the game lists and its chips, and new rooms (and "Same crew, new game") are refused; rooms already open finish their game but can't start another. Playtests still work. Its stats, recaps and hall of fame stay.

### 6. Edge cache for the back room (optional)

Without it, every room join fetches the back room's code again through the tunnel, and art comes from R2 through the server. A Cloudflare Worker in front of those two paths serves them from Cloudflare's cache to browsers it can prove are unlocked. It only ever speeds things up: anything it can't prove (no or an old pass, an admin playtest session, an error) goes to the server unchanged, which applies its usual checks.

1. **Secret.** Generate `EDGE_SECRET` on the server (`openssl rand -hex 32`, appended to `~/virtual-tavern/.env` without echoing it) and restart the app. It must not be the `SESSION_SECRET`. With it set, every back-room unlock also gets a `vt_edge` cookie (`<version>.<issuedAt>.<HMAC>`, the unlock's lifetime), browsers unlocked before get one on their next API call, the lock clears it, and `GET /api/edge/backroom-version` answers `{ version, open }`. Without it nothing changes.
2. **Worker.** `pnpm --filter @vt/edge build` writes one ES module, `apps/edge/dist/worker.js`. Upload it as a module Worker (dashboard, or the Workers scripts API with `main_module: "worker.js"`) with two bindings: the secret `EDGE_SECRET` (the same value, read from the server over SSH, never printed) and the R2 bucket of step 5 as `ART`. Keep account ids, bucket and host names out of the repository.
3. **Routes.** On the site's zone, add Worker routes for `<host>/backroom-assets/*` and `<host>/api/backroom/assets/*`, with the request-limit failure mode set to **fail open**, so the site carries on without the Worker.
   Keep the Worker's own **Workers Caching** setting (`cache`) **off**: that cache runs before the Worker's pass check and keys by URL alone, so it would hand a locked browser's refusal to unlocked players (and their files to anyone). Workers Logs may be on; the Worker logs each time it falls back to origin (the path and the error only).
4. **Check.** As an unlocked browser, fetch a back-room code file (`/backroom-assets/….js`) and an art file twice: the second answer carries `x-vt-edge: hit` (the first `miss`). A locked browser gets `x-vt-edge: pass` and the server's 404. "Sign everyone out" or a new password reaches the edge within about 30 s (the Worker re-reads the version that often).
5. **Rollback.** Delete the two routes; the server serves everything itself, as before. The Worker and `EDGE_SECRET` can stay.

The Worker keeps one copy per URL (never per cookie) in Cloudflare's cache and sends browsers `private, max-age=31536000, immutable`, so no shared cache downstream keeps one. Manifests are never cached at the edge, and byte ranges (Nightfall's audio) are read from the bucket each time.

### 7. Metrics for monitoring (optional)

The server can serve Prometheus metrics at `/metrics` on a port of its own, for a monitoring agent to scrape every 30 to 60 s. It is off unless `METRICS_PORT` is set, and it is never on the app's port: the public reaches the app's port, so a metrics page there would be public too. Nothing in it names a room, a player, an address or a token; labels are game ids, error codes and status classes only.

1. **Enable.** Add `METRICS_PORT=9464` to `~/virtual-tavern/.env` and recreate the app (`docker compose up -d app`). The port listens on `METRICS_HOST` (default: the app's `HOST`, `0.0.0.0` in the container). The compose file does not publish it, so it is reachable only from the server itself (at the container's address on its Docker network) and from containers on that network. To scrape it from an agent on the host at `127.0.0.1` instead, publish it on loopback only with a `docker-compose.override.yml` (`ports: ['127.0.0.1:9464:9464']`), never on a public address.
2. **Scrape.** Point the agent at `http://<container address>:9464/metrics` (an agent with Docker discovery can find the app container by name and use its network address) or at the loopback port of step 1. `curl -s http://127.0.0.1:9464/metrics | head` on the server (with the override) or `docker compose exec app node -e "fetch('http://127.0.0.1:9464/metrics').then(r => r.text()).then(console.log)" | head` shows the page.
3. **What is there.** Live rooms, players and playing rooms per game and open sockets (test rooms and playtests left out, like the Live tab); games started and ended (`finished` or `abandoned`), moves, refused moves by error code, and active play time, per game (from the stats recorder, so test traffic never counts); room snapshot broadcast time and size; HTTP responses by status class; stats flush time and failures; database file sizes; the off-site backup's last run, result and sizes; build version; process memory, CPU and event-loop delay.

Without `METRICS_PORT` nothing listens and nothing changes. Rollback: remove the line and recreate the app.

## Day to day

- **Ship:** merge the PR once its checks pass. Within a minute the Release PR shows the new version. Merge it as an admin (it has no checks of its own: it only changes the version and CHANGELOG), once it is at least a minute old: a merge seconds after release-please opened it has been seen to start no workflow (if that happens, run _Release_ by hand on `main`: it tags the merged Release PR and carries on). Then approve the deploy when GitHub asks. About 10 minutes from the first merge to live, plus the approval. A `test:`/`chore:`/`docs:`/`ci:` change adds nothing to the Release PR.
- **Roll back or redeploy:** Actions → _Deploy_ → _Run workflow_, and enter an earlier version (e.g. `0.3.1`).
- **Logs:** `docker compose logs -f app` in `~/virtual-tavern`.
- **Restore a backup:**

  ```sh
  docker compose exec app ls /data/backups
  docker compose stop app
  docker compose run --rm --no-deps --entrypoint sh app -c 'cp /data/backups/<file>.db /data/tavern.db && rm -f /data/tavern.db-wal /data/tavern.db-shm'
  docker compose start app
  ```

## Migrations and rollbacks

The new container runs its migrations at startup, before the health check decides whether the deploy stands. A failed deploy rolls back the **image**, not the schema: the previous version then runs against the migrated database. So every migration must be backward-compatible with the previous release: add tables and nullable columns freely; rename or drop only in a later release, once nothing deployed still reads the old shape. If a release has to be undone after a destructive migration, restore the `pre-deploy-<version>-*.db` backup that deploy took (see the restore recipe above).

## Runbook

All recipes run in `~/virtual-tavern` on the server unless they say otherwise.

- **Change the admin password:** edit `ADMIN_PASSWORD` in `.env`, then `docker compose up -d app`. Every admin session is signed out, because sessions are bound to the password they were issued under.
- **Rotate `SESSION_SECRET`:** set a new value in `.env` (`openssl rand -hex 32`), then `docker compose up -d app`. It signs both the admin and the back-room cookies, so everyone signs in and unlocks again.
- **Change the back-room password, or sign everyone out of it:** open `/tavern-keeper` → **Back room**. Either action invalidates every unlock at once; no restart needed.
- **Rotate the R2 tokens:** the server's _read_ token lives in `.env` (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`); replace it and `docker compose up -d app`. The _read & write_ upload token lives only on the dev machine in `~/.config/virtual-tavern/r2-upload.env`; replace it there. Revoke the old tokens in the Cloudflare dashboard afterwards.
- **Deploy or roll back by hand:** `bash deploy.sh X.Y.Z` (the script is copied into the deploy directory). It backs up the database, pulls the image, waits for the health check and rolls back to the previous version if that fails. After a healthy deploy it removes old images, keeping only the newest 5 release versions (and the one it replaced); a rollback prunes nothing. Rolling back to an older version pulls its image again, so it needs the registry to be reachable. `DEPLOY_SKIP_PULL=1 bash deploy.sh X.Y.Z` runs a locally built image without pulling.
- **List or restore backups:** `docker compose exec app ls -l /data/backups`, then the restore recipe above.
- **Import question decks** (private trivia and open-question content, never in the repository). From the dev machine, copy the script and the deck folder (`manifest.json` plus one `<slug>.json` per deck, the layout the admin page's question-deck **Download all** writes) to the host, run it there against the app's local port, then delete the copy:

  ```sh
  scp scripts/import-question-decks.mjs <server>:/tmp/ && scp -r private-assets/hoodwink/decks <server>:/tmp/decks
  # on the server:
  read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
  node /tmp/import-question-decks.mjs http://localhost:<APP_PORT> /tmp/decks --dry-run
  node /tmp/import-question-decks.mjs http://localhost:<APP_PORT> /tmp/decks
  rm -rf /tmp/decks /tmp/import-question-decks.mjs; unset ADMIN_PASSWORD
  ```

  Every deck is validated first and nothing is uploaded if any fails. A deck's `games` (in the manifest) may only name games that use question decks (`hoodwink`, the default, and `stampede`); the server refuses anything else. A deck is either trivia (Hoodwink: every question needs an `answer` and a `___` blank or a final `?`) or open (Stampede: list `"games": ["stampede"]` in the manifest; questions are `{ "prompt", "adult"?, "tags"?, "hints"? }` with no answer, any prompt shape, and `hints` up to 10 common answers of at most 40 characters, which only playtest bots read); one deck can't be both. Put each deck's source or theme in its `description`: Stampede's lobby shows it under the deck's name and question count. A deck holds up to 5,000 questions, and there may be any number of decks; the host turns each one on or off in the lobby (adult-only decks start off). Decks whose name already exists are skipped, so re-running is safe; `--only <glob>` / `--skip <glob>` pick decks by slug. To replace a deck, delete it in `/tavern-keeper` first. Node 24 must be on the host's `PATH` (or run it with `docker run --rm --network host -v /tmp:/tmp node:24-alpine node ...`).

- **Import content packs** (private content for back-room games that need more than words or questions: Going Once's title groups and hint lines; never in the repository). Each pack is one JSON file for one game and one kind; the server checks it against the game's own schema (`packages/private-games/going-once/src/logic/content.ts`: `groups` is a list of `{ id, titles: [7–12 titles], house?: [one house key per title] }`, `lines` maps hint kinds to lines with `{player}`, `{value}` and `{random}` placeholders (plus `buyer1`…`buyer3`, each art buyer's own chatter, and `practice`, the practice lot's tip with `{value}`), `host` maps the auctioneer's moments (`packages/private-games/going-once/src/logic/host.ts`, plus `bid-<amount>` and `bid-high`) to lines that name nobody or name a player as `{player}`). Copy the script with the markup cleaner it imports (`packages/game-sdk/src/markup.mjs`, the games' own, so both keep their paths) and the file to the host, run it there against the app's local port, then delete the copy:

  ```sh
  tar -cf - scripts/import-content-pack.mjs packages/game-sdk/src/markup.mjs | ssh <server> 'mkdir -p /tmp/vt-import && tar -xf - -C /tmp/vt-import'
  scp private-assets/<game>/<file>.json <server>:/tmp/
  # on the server:
  read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
  node /tmp/vt-import/scripts/import-content-pack.mjs http://localhost:<APP_PORT> going-once groups /tmp/<file>.json --name "Title groups" --dry-run
  node /tmp/vt-import/scripts/import-content-pack.mjs http://localhost:<APP_PORT> going-once groups /tmp/<file>.json --name "Title groups"
  rm -rf /tmp/<file>.json /tmp/vt-import; unset ADMIN_PASSWORD
  ```

  Markup in any string (HTML tags such as `<i>`, entities such as `&amp;`) is taken out, keeping the words: the script strips it before sending and says how many strings it changed, and the server strips it again, with the same `plainText` (`packages/game-sdk/src/markup.mjs`, from `@vt/game-sdk`: tags stripped until none is left, leftover angle brackets dropped, entities decoded and stripped again). A pack with the same game, kind and name is skipped, so re-running is safe; add `--replace` to update that pack's data in place (`PUT /api/admin/content-packs/:id`: same id, so rooms' memory of the title groups they used carries on). Packs are also switched off, downloaded and deleted in `/tavern-keeper` (**Content packs**). Rooms read every enabled pack of a kind, merged. Until a game has two title groups, its lobby says so and refuses to start.

  **Mission Control** has two kinds (`packages/private-games/mission-control/src/logic/content.ts`): `tasks`, a list of task cards `{ id, check, difficulty: { 3, 4, 5 }, text, reDeal? }` (`check` is a condition kind with its numbers from `checks.ts`, `reDeal` the card sets that deal again when one hand holds a whole set), and `voyage`, one campaign `{ key, name?, missions: [{ n, title?, difficulty, comms, commsFrom?, selection, wanted?, timer?: { seconds, untimed }, conditions?, fixedTasks?, rule?, story?, fresh? }], epilogue?: { difficulty, title?, rule?, story? } }`. A room offers each voyage by its `key` (campaigns are saved under it, so a re-import keeps the logbooks); until a voyage and the task cards are in, the lobby refuses to start. A second `voyage` pack with `taskSet: "cards"` is the one-card campaign: its missions name `cards` and `tokens` and their own rules instead of a difficulty, and need no tasks pack. The packs are built by `private-assets/tools/mission-control-packs.py` into `private-assets/crew/packs/` (`voyage-p9.json` is the one-card campaign):

  ```sh
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> mission-control tasks /tmp/tasks.json --name "Task cards" --dry-run
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> mission-control tasks /tmp/tasks.json --name "Task cards"
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> mission-control voyage /tmp/voyage.json --name "Campaign"
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> mission-control voyage /tmp/voyage-p9.json --name "Campaign (one-card)"
  ```

  **Sketchy** has two kinds (`packages/private-games/sketchy/src/logic/content.ts`): `prompts`, a list of `{ prompt, alternates?, adult?, tags? }` (a prompt is what a player draws and the real title on the board, at most 80 characters, lowercased in play; `alternates` are other spellings a fake title may not use; `{player}` in a prompt is filled with another player's name), and `decoys`, a list of `{ text, adult? }` house titles that pad small boards (scoring for nobody). Every enabled prompts pack is a toggle in Sketchy's lobby (all on by default, except a pack whose every prompt has `{player}`, which is the lobby's Friend mode switch, off by default; adult prompts only with the room's Adult switch), and every enabled decoys pack is merged. The prepared packs (one prompts pack and one decoys pack per source game) are in `private-assets/sketchy/import/`; import the adult-only pack with `--disabled`, so it stays off until an admin switches it on:

  ```sh
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> sketchy prompts /tmp/<source>-prompts.json --name "<Source game>" --dry-run
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> sketchy decoys /tmp/<source>-decoys.json --name "<Source game> house titles"
  node /tmp/import-content-pack.mjs http://localhost:<APP_PORT> sketchy prompts /tmp/<adult source>-prompts.json --name "<Adult source game>" --disabled
  ```

- **Check the running version:** `curl -s localhost:$APP_PORT/healthz` (or the public `/healthz`) answers `{"status":"ok","version":"X.Y.Z"}`; `{"status":"degraded"}` with a 503 means the database is not answering, and Docker's health check turns the container unhealthy.

## Admin stats

The admin stats API (`/api/admin/stats/*`) is served from the same SQLite database, behind the admin sign-in, and is rate-limited to 120 requests a minute.

- **What is recorded:** rooms, joins and the names players used, game starts and ends with their settings, actions, and each game's own insight events (clues, guesses, outcomes). Only the public player id is stored, never the browser token. Reverie clue text is stored too, but only ever shown to admins.
- **Retention:** raw events (`stats_events`) are kept for 90 days. The hourly maintenance job (the same timer that sweeps idle rooms, and once at startup) rolls every finished UTC day up into the `stats_daily*` tables, which are kept forever, then deletes raw events older than 90 days whose day is rolled up. Every range still reads correctly, because queries combine rollups for older days with raw events for recent ones. The stats live in `tavern.db`, so the existing backups cover them.
- **The page:** `/tavern-keeper/stats` (linked from `/tavern-keeper` once signed in) shows live rooms, history for a chosen range, per-game figures, players by device (with every name they used) and fun facts.
- **Export the raw events** (NDJSON, one event per line): the page's **Export events** button downloads the selected range's days (every day from the Live tab), using the admin cookie. From a shell, e.g. before a move to another store: `ADMIN_PASSWORD=... node scripts/stats-export.mjs https://<host> --from 2026-10-01 --to 2026-10-31 --out stats.ndjson`. Leave out `--from`/`--to` for every raw event still kept. Days older than 90 days exist only as rollups.
- **Keep live checks out of the stats:** set `STATS_IGNORE_TOKEN` in `~/virtual-tavern/.env` (`openssl rand -hex 24`), then `docker compose up -d app`. Any request or Socket.IO connection that sends the header `x-vt-test: <token>` is test traffic: a room it opens (`POST /api/rooms`) or joins is marked as a test room for good (`rooms.test`), and nothing about that room is recorded, neither events nor players nor recap nights. The token is compared in constant time; a wrong token, or no `STATS_IGNORE_TOKEN` on the server, makes the header mean nothing. In Playwright, put it in the context's headers, which Chromium also sends on the Socket.IO handshake: `browser.newContext({ extraHTTPHeaders: { 'x-vt-test': process.env.STATS_IGNORE_TOKEN } })` (or `use: { extraHTTPHeaders: … }` in the config); with curl, `-H "x-vt-test: $STATS_IGNORE_TOKEN"`. Keep the token secret: anyone holding it can play off the record. A real room that a test browser joins stops recording from then on, so point live checks at rooms of their own.
- **Playtests** (`/tavern-keeper/playtest`): the admin plays any game alone, one tab of their own browser per seat. A playtest room is a test room (`rooms.test`) and also carries `rooms.playtest` (JSON), so nothing about it is recorded, and the Live tab counts it only on its own "🧪 N playtests running" line, never as rooms, players or open tabs. Only a browser holding the admin session can look it up (`/api/rooms/:id` answers 404 to anyone else) or join it. The admin session counts as a back-room unlock everywhere, so a signed-in admin sees and plays the back room without the password (in playtests and ordinary rooms alike); signing out of the admin area takes that away again. A five-minute timer deletes every playtest with no seat connected for 15 minutes; **End** on the Playtest tab (or in the host seat's TEST bar) deletes one at once. Signing out of the admin area locks its open seat tabs at the next move.
- **Delete one room's stats** (a live check run without the header, say): `ADMIN_PASSWORD=… node scripts/forget-stats-room.mjs https://<host> <roomId>… --dry-run` shows what would go, per table, with the days affected and how many players would be removed; run it again without `--dry-run` to delete. It calls `DELETE /api/admin/stats/rooms/:roomId` (`?dryRun=1` for the dry run), which removes the room's raw events, its recap nights, awards and records, and the players who never appeared anywhere else (their `stats_players` row and names; players also seen elsewhere stay, with that room's games and joins taken off their totals). Every rolled-up day the room touched is rolled up again from the raw events that remain, so the stats page stops counting its games. A room with activity on a day whose raw events were already pruned (older than 90 days) is refused with `409 stats-pruned`, because a rollup can't be split by room. Rebuilding a day also drops what players forgotten through "Forget me" had added to that day's anonymous totals.
- **Reset:** `POST /api/admin/stats/reset` with `{"confirm":"reset all stats"}` (the stats page's **Reset stats** button, after typing "reset") deletes every event, rollup and player record. Take a backup or an export first; it cannot be undone.
- **Cloudflare Access:** if an Access application protects `/tavern-keeper`, make sure it also covers `/api/admin` so the stats API sits behind the same gate.

## Trying the production build locally

```sh
cp .env.example .env   # set ADMIN_PASSWORD and SESSION_SECRET
docker compose up --build
```

Then open http://localhost:3000.
