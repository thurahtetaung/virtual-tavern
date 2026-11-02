#!/usr/bin/env bash
# Deploys an image version on the server and rolls back automatically if it never becomes healthy.
# Usage (from the deploy directory holding docker-compose.yml and .env): ./deploy.sh 1.2.3
set -euo pipefail

version="${1:?usage: deploy.sh <version>}"
cd "$(dirname "$0")"
[ -f docker-compose.yml ] || { echo "docker-compose.yml not found in $(pwd)" >&2; exit 1; }
[ -f .env ] || { echo ".env not found in $(pwd); create .env (see docs/deployment.md)" >&2; exit 1; }

current() { sed -n 's/^IMAGE_TAG=//p' .env | tail -1; }
set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env; else echo "IMAGE_TAG=$1" >> .env; fi
}
up() { docker compose up -d --no-deps --wait --wait-timeout 90 app; }

# Release images kept on the server after a successful deploy; older ones are removed (a rollback
# to one of them pulls it again).
KEEP_IMAGES="${KEEP_IMAGES:-5}"

# Reads image tags on stdin and prints the release tags (X.Y.Z) to remove: all but the newest
# $1 by version, never any of the tags named after it.
stale_tags() {
  local keep="$1"; shift
  grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -uV | head -n "-$keep" | grep -vxF -f <(printf '%s\n' "$@") || true
}

# Removes the app's old release images, keeping the newest $KEEP_IMAGES and the tags given.
# Other repositories' images are left alone, and a failed removal never fails the deploy.
prune_images() {
  local repo tag
  repo="$(docker compose config --images app 2>/dev/null | head -n 1)"
  repo="${repo%:*}"
  [ -n "$repo" ] || return 0
  docker image ls "$repo" --format '{{.Tag}}' 2>/dev/null | stale_tags "$KEEP_IMAGES" "$@" |
    while read -r tag; do
      docker image rm "$repo:$tag" >/dev/null 2>&1 && echo "==> Removed old image $tag" || true
    done
}

previous="$(current)"
echo "==> Deploying $version (currently ${previous:-none})"

# Pull before touching .env: if the tag was never published (or GHCR is down) the script stops
# before set_tag and the running version stays the one recorded in .env. The pull runs while the
# backup is taken; both must succeed before anything changes.
# DEPLOY_SKIP_PULL=1 is for testing with locally built images.
pull=
if [ "${DEPLOY_SKIP_PULL:-}" != 1 ]; then
  IMAGE_TAG="$version" docker compose pull --quiet app &
  pull=$!
fi

if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  echo "==> Backing up the database"
  docker compose exec -T app node dist/backup.js "/data/backups/pre-deploy-$version-$(date +%Y%m%dT%H%M%S).db"
fi

if [ -n "$pull" ]; then
  echo "==> Pulling $version"
  wait "$pull" || { echo "==> Pulling $version failed; nothing changed" >&2; exit 1; }
fi
set_tag "$version"

if up; then
  echo "==> $version is healthy"
  prune_images "$version" "$previous" || true
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
