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

Backups land in the volume under `/data/backups` and the newest 14 are kept. Each deploy also takes a backup first.

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
4. Open `/admin` → **Back room** and set the password.

## Day to day

- **Ship:** merge the open Release PR, then approve the deploy when GitHub asks.
- **Roll back or redeploy:** Actions → _Deploy_ → _Run workflow_, and enter an earlier version (e.g. `0.3.1`).
- **Logs:** `docker compose logs -f app` in `~/virtual-tavern`.
- **Restore a backup:**

  ```sh
  docker compose stop app
  docker compose run --rm --no-deps --entrypoint sh app -c 'cp /data/backups/<file>.db /data/tavern.db && rm -f /data/tavern.db-wal /data/tavern.db-shm'
  docker compose start app
  ```

## Trying the production build locally

```sh
cp .env.example .env   # set ADMIN_PASSWORD and SESSION_SECRET
docker compose up --build
```

Then open http://localhost:3000.
