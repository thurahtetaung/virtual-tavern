# Deployment

Production runs as two containers on one small VPS (an Oracle Cloud free-tier Ampere/ARM instance works well):

- **app**: the game server, which also serves the web app. SQLite lives in the `tavern-data` volume.
- **cloudflared**: a Cloudflare Tunnel. It provides HTTPS and SSH access for deploys, and the VPS keeps **no open inbound ports**.

Releases are automatic once the one-time setup below is done:

```
merge PRs to main ─▶ release-please opens/updates a "Release PR"
merge the Release PR ─▶ tag vX.Y.Z + GitHub Release
                      ─▶ multi-arch image pushed to ghcr.io/thurahtetaung/virtual-tavern
                      ─▶ deploy waits for your approval ─▶ SSH (via Cloudflare) ─▶ scripts/deploy.sh
                      ─▶ health check, automatic rollback if the new version is unhealthy
```

## One-time setup

### 1. Server

On the VPS (Ubuntu):

```sh
# Docker Engine + Compose plugin: https://docs.docker.com/engine/install/ubuntu/
sudo adduser --disabled-password deploy
sudo usermod -aG docker deploy
sudo -u deploy mkdir -p /home/deploy/virtual-tavern /home/deploy/.ssh
```

Create a key pair for GitHub Actions (on any machine) and authorise it:

```sh
ssh-keygen -t ed25519 -C "virtual-tavern deploy" -f deploy_key -N ""
sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys < deploy_key.pub
```

Create `/home/deploy/virtual-tavern/.env` from [`.env.example`](../.env.example):

- `ADMIN_PASSWORD`: the password for `/admin`, where word lists are managed.
- `SESSION_SECRET`: generate with `openssl rand -hex 32`.
- `TUNNEL_TOKEN`: from step 2. Keep `COMPOSE_PROFILES=tunnel`.

Daily database backups (the `deploy` user's crontab, `crontab -e`):

```
15 3 * * * cd ~/virtual-tavern && docker compose exec -T app node dist/backup.js >/dev/null
```

Backups land in the volume under `/data/backups` and the newest 14 are kept. Each deploy also takes a backup first.

### 2. Cloudflare

In the Cloudflare dashboard, under Zero Trust:

1. **Networks → Tunnels → Create tunnel** (type _Cloudflared_). Choose the Docker option and copy the token into `TUNNEL_TOKEN`.
2. Add two **public hostnames** to the tunnel:
   - `tavern.example.com` → `HTTP` → `app:3000`
   - `ssh-tavern.example.com` → `SSH` → `host.docker.internal:22`
3. **Access → Service auth → Create service token**. Note its client ID and secret.
4. **Access → Applications → Add a self-hosted app** for `ssh-tavern.example.com`. Give it a policy with action **Service Auth** that includes that service token. The SSH hostname now only accepts the deploy pipeline.

### 3. GitHub

In the repository settings:

- **General → Pull Requests**: allow squash merging only, and use the PR title as the commit message.
- **Actions → General → Workflow permissions**: tick _Allow GitHub Actions to create and approve pull requests_. release-please needs this to open the Release PR.
- **Branches → main**: require a PR and the status checks _Lint, typecheck, test, build, e2e_, _Docker build_, _Conventional Commit title_ and _analyze_.
- **Environments → New environment `production`**: add yourself as a required reviewer, then add:

  | Secret                    | Value                                                                                                         |
  | ------------------------- | ------------------------------------------------------------------------------------------------------------- |
  | `DEPLOY_HOST`             | `ssh-tavern.example.com`                                                                                      |
  | `DEPLOY_USER`             | `deploy`                                                                                                      |
  | `DEPLOY_SSH_KEY`          | contents of `deploy_key` (the private key)                                                                    |
  | `DEPLOY_KNOWN_HOSTS`      | output of `echo "ssh-tavern.example.com $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"` run on the VPS |
  | `CF_ACCESS_CLIENT_ID`     | service token client ID                                                                                       |
  | `CF_ACCESS_CLIENT_SECRET` | service token client secret                                                                                   |

  | Variable     | Value                                                            |
  | ------------ | ---------------------------------------------------------------- |
  | `PUBLIC_URL` | `https://tavern.example.com` (used for the post-deploy check)    |
  | `DEPLOY_DIR` | optional; defaults to `virtual-tavern` in the deploy user's home |

After the first release publishes, open the package page (`ghcr.io/thurahtetaung/virtual-tavern`) and set its visibility to **Public**, so the VPS can pull it without logging in.

## Day to day

- **Ship:** merge the open Release PR, then approve the deploy when GitHub asks.
- **Roll back or redeploy:** Actions → _Deploy_ → _Run workflow_, and enter an earlier version (e.g. `0.3.1`).
- **Logs:** `docker compose logs -f app` in `~/virtual-tavern`.
- **Restore a backup:** stop the app, copy the backup over `/data/tavern.db` inside the volume, and start it again:

  ```sh
  docker compose stop app
  docker compose run --rm --no-deps --entrypoint sh app -c 'cp /data/backups/<file>.db /data/tavern.db && rm -f /data/tavern.db-wal /data/tavern.db-shm'
  docker compose start app
  ```

## Trying the production build locally

```sh
cp .env.example .env   # set ADMIN_PASSWORD/SESSION_SECRET, and clear COMPOSE_PROFILES
docker compose up --build
```

Then open http://localhost:3000.
