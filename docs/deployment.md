# Deployment

Production is one container on a small VPS (an Oracle Cloud free-tier ARM instance):

- **app**: the game server, which also serves the web app. It is published on `127.0.0.1:${APP_PORT}`, and SQLite lives in the `tavern-data` volume.
- **cloudflared**, already running on the host as a systemd service, routes the public hostname to `http://localhost:${APP_PORT}`. The VPS needs **no open inbound ports**.
- **Tailscale** connects GitHub Actions to the VPS for deploys. CI joins the tailnet as a short-lived `tag:ci` node and SSHes in over the tailnet.

```
merge PRs to main ─▶ release-please opens/updates a "Release PR"
merge the Release PR ─▶ tag vX.Y.Z + GitHub Release
                      ─▶ multi-arch image pushed to ghcr.io/thurahtetaung/virtual-tavern
                      ─▶ deploy waits for your approval ─▶ Tailscale + SSH ─▶ scripts/deploy.sh
                      ─▶ DB backup, health check, automatic rollback if the new version is unhealthy
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

  | Variable     | Value                                                        |
  | ------------ | ------------------------------------------------------------ |
  | `PUBLIC_URL` | the public site URL (shown as the deployment link on GitHub) |
  | `DEPLOY_DIR` | optional; defaults to `virtual-tavern` in the user's home    |

After the first release publishes, set the `virtual-tavern` package's visibility to **Public** on GitHub, so the VPS can pull it without logging in.

### 5. Private game assets (optional)

Back-room games keep their art in a private Cloudflare R2 bucket.

1. In the Cloudflare dashboard, enable **R2** and create a bucket (for example `virtual-tavern-private`). Leave public access off.
2. **R2 → Manage API tokens → Create**: give the server an **Object Read** token scoped to that bucket, and add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to the server's `.env`.
3. Create a separate **Object Read & Write** token for uploads, and keep it on your own machine in `~/.config/virtual-tavern/r2-upload.env`, never on the server or in the repo.
4. Open `/tavern-keeper` → **Back room** and set the password.
5. Upload a game's assets from the dev machine: `node scripts/r2-upload.mjs <gameId> <folder>`. For Reverie the folder holds `cards/000.jpg…`, `back.jpg` and `manifest.json` (set names and the card back); the card-number ranges per set are fixed in the game's `CARD_SETS`. For Royal Post (`node scripts/r2-upload.mjs royal-post <folder>`, dry-run first) the folder holds the card images and a `manifest.json` of the form `{ "editions": { "classic": { "back": "<path>", "cards": { "guard": { "name": "…", "art": "<path>" }, … } }, "2019": { … } } }`, where paths are relative to the game's folder; any card left out shows a styled placeholder. For Masquerade's back-room edition (`node scripts/r2-upload.mjs masquerade-originals <folder>`, dry-run first) the folder holds the location pictures and a `manifest.json` of the form `{ "back": "<path>", "editions": { "e1": { "name": "…" }, "e2": { … } }, "locations": { "e1-01": { "name": "…", "art": "<path>", "emoji": "…", "tip": "…", "questions": ["…"] }, … } }` (ids `e1-01`…`e1-30` and `e2-01`…`e2-20`; every field optional; location art is landscape, 5:3 such as 600×360, and the back is shown on the spy's card); a location left out shows as "Location n".
6. **Nightfall** (`node scripts/r2-upload.mjs nightfall <folder>`, dry-run first): the folder holds `roles/<role-id>.webp` portraits, `audio/*.ogg` narration clips, `music/*.ogg` background tracks and a `manifest.json` of the form `{ "sets": { "<set>": { "name": "…", "roles": […], "artifacts": […] } }, "roles": { "<role-id>": { "name": "…", "text": "…", "art": "roles/<id>.webp" } }, "artifacts": { "<id>": { "name": "…", "text": "…" } }, "narration": { "<step>:wake": ["audio/….ogg"], "<step>:close": […], "night:start": […], … }, "music": { "lobby" | "night" | "day" | "vote" | "reveal": ["music/….ogg"] }, "musicTracks": { "<id>": { "name": "…", "file": "music/….ogg", "duration": 42.1 } } }`. Role ids are the plain words in `packages/private-games/nightfall/src/logic/roles.ts` (set ids `base`, `daybreak`, `bonus1`, `bonus2`, `vampire`…), and the Vampire set's Marks come from `"marks": { "<mark id>": { "name", "text", "art": "marks/<id>.webp" } }` and the Most Votes tokens from `"tokens": { "most-votes-1" | "most-votes-2": { "art": … } }`; narration keys follow `stepLines` in `plan.ts` (`seer:wake`, `doppelganger:insomniac:wake`, `werewolf:wake:dream-wolf`…). Every field is optional: without the manifest, roles show as styled placeholders and the game is silent. In `/tavern-keeper`, **Nightfall music** picks the tracks per phase (with previews) once the manifest is uploaded.
7. **Back-room titles.** The repository only uses each private game's code name. Set the title unlocked players see in `/tavern-keeper` → **Back-room titles**, or from the dev machine: `ADMIN_PASSWORD=… node scripts/set-game-title.mjs https://<host> nightfall "<title>"` (`--clear` removes it, `--list` shows them all). The title is stored in the database (`app_settings`, key `private_game_titles`) and sent only to unlocked browsers.

## Day to day

- **Ship:** merge the open Release PR, then approve the deploy when GitHub asks.
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
- **Deploy or roll back by hand:** `bash deploy.sh X.Y.Z` (the script is copied into the deploy directory). It backs up the database, pulls the image, waits for the health check and rolls back to the previous version if that fails. `DEPLOY_SKIP_PULL=1 bash deploy.sh X.Y.Z` runs a locally built image without pulling.
- **List or restore backups:** `docker compose exec app ls -l /data/backups`, then the restore recipe above.
- **Import question decks** (private trivia content, never in the repository). From the dev machine, copy the script and the deck folder (`manifest.json` plus one `<slug>.json` per deck, the layout the admin page's question-deck **Download all** writes) to the host, run it there against the app's local port, then delete the copy:

  ```sh
  scp scripts/import-question-decks.mjs <server>:/tmp/ && scp -r private-assets/hoodwink/decks <server>:/tmp/decks
  # on the server:
  read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD
  node /tmp/import-question-decks.mjs http://localhost:<APP_PORT> /tmp/decks --dry-run
  node /tmp/import-question-decks.mjs http://localhost:<APP_PORT> /tmp/decks
  rm -rf /tmp/decks /tmp/import-question-decks.mjs; unset ADMIN_PASSWORD
  ```

  Every deck is validated first and nothing is uploaded if any fails. A deck's `games` (in the manifest) may only name games that use question decks (today just `hoodwink`, the default); the server refuses anything else. Decks whose name already exists are skipped, so re-running is safe; `--only <glob>` / `--skip <glob>` pick decks by slug. To replace a deck, delete it in `/tavern-keeper` first. Node 24 must be on the host's `PATH` (or run it with `docker run --rm --network host -v /tmp:/tmp node:24-alpine node ...`).

- **Check the running version:** `curl -s localhost:$APP_PORT/healthz` (or the public `/healthz`) answers `{"status":"ok","version":"X.Y.Z"}`; `{"status":"degraded"}` with a 503 means the database is not answering, and Docker's health check turns the container unhealthy.

## Admin stats

The admin stats API (`/api/admin/stats/*`) is served from the same SQLite database, behind the admin sign-in, and is rate-limited to 120 requests a minute.

- **What is recorded:** rooms, joins and the names players used, game starts and ends with their settings, actions, and each game's own insight events (clues, guesses, outcomes). Only the public player id is stored, never the browser token. Reverie clue text is stored too, but only ever shown to admins.
- **Retention:** raw events (`stats_events`) are kept for 90 days. The hourly maintenance job (the same timer that sweeps idle rooms, and once at startup) rolls every finished UTC day up into the `stats_daily*` tables, which are kept forever, then deletes raw events older than 90 days whose day is rolled up. Every range still reads correctly, because queries combine rollups for older days with raw events for recent ones. The stats live in `tavern.db`, so the existing backups cover them.
- **The page:** `/tavern-keeper/stats` (linked from `/tavern-keeper` once signed in) shows live rooms, history for a chosen range, per-game figures, players by device (with every name they used) and fun facts.
- **Export the raw events** (NDJSON, one event per line): the page's **Export events** button downloads the selected range's days (every day from the Live tab), using the admin cookie. From a shell, e.g. before a move to another store: `ADMIN_PASSWORD=... node scripts/stats-export.mjs https://<host> --from 2026-10-01 --to 2026-10-31 --out stats.ndjson`. Leave out `--from`/`--to` for every raw event still kept. Days older than 90 days exist only as rollups.
- **Reset:** `POST /api/admin/stats/reset` with `{"confirm":"reset all stats"}` (the stats page's **Reset stats** button, after typing "reset") deletes every event, rollup and player record. Take a backup or an export first; it cannot be undone.
- **Cloudflare Access:** if an Access application protects `/tavern-keeper`, make sure it also covers `/api/admin` so the stats API sits behind the same gate.

## Trying the production build locally

```sh
cp .env.example .env   # set ADMIN_PASSWORD and SESSION_SECRET
docker compose up --build
```

Then open http://localhost:3000.
