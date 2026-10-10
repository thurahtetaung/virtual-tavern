#!/usr/bin/env bash
# Deploys an image version on the server and rolls back automatically if it never becomes healthy.
# Usage (from the deploy directory holding docker-compose.yml and .env): ./deploy.sh 1.2.3
set -euo pipefail

version="${1:?usage: deploy.sh <version>}"
cd "$(dirname "$0")"
[ -f docker-compose.yml ] || { echo "docker-compose.yml not found in $(pwd)" >&2; exit 1; }
[ -f .env ] || { echo ".env not found in $(pwd); copy .env.example and fill it in" >&2; exit 1; }

current() { sed -n 's/^IMAGE_TAG=//p' .env | tail -1; }
set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env; else echo "IMAGE_TAG=$1" >> .env; fi
}
up() { docker compose up -d --no-deps --wait --wait-timeout 90 app; }

previous="$(current)"
echo "==> Deploying $version (currently ${previous:-none})"

if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  echo "==> Backing up the database"
  docker compose exec -T app node dist/backup.js "/data/backups/pre-deploy-$version-$(date +%Y%m%dT%H%M%S).db"
fi

set_tag "$version"
# DEPLOY_SKIP_PULL=1 is for testing with locally built images.
[ "${DEPLOY_SKIP_PULL:-}" = 1 ] || docker compose pull app

if up; then
  echo "==> $version is healthy"
  docker image prune -f >/dev/null
  exit 0
fi

echo "==> $version failed its health check" >&2
docker compose logs --tail 50 app >&2 || true
if [ -n "$previous" ] && [ "$previous" != "$version" ]; then
  echo "==> Rolling back to $previous" >&2
  set_tag "$previous"
  up
fi
exit 1
