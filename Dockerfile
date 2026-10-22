# syntax=docker/dockerfile:1
# Keep in sync with the "volta" pin in package.json.
ARG NODE_VERSION=24.22.1

# The build stage runs on the builder's own platform even for the arm64 image: its output is
# platform-independent (bundled JS, and better-sqlite3 ships prebuilt binaries for every platform),
# so nothing is compiled or installed under QEMU emulation.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-slim AS build
ARG PNPM_VERSION=11.28.5
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /src
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile \
 && pnpm --filter @vt/server --filter @vt/web build \
 && pnpm --filter @vt/server deploy --prod --legacy /out/server \
 && cp -r apps/web/dist /out/web
# Ship only the target's SQLite binary, without the C sources it would need to build from scratch.
ARG TARGETARCH
RUN sqlite="$(echo /out/server/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3)" \
 && arch="$(if [ "$TARGETARCH" = arm64 ]; then echo arm64; else echo x64; fi)" \
 && rm -rf "$sqlite/deps" "$sqlite/src" \
 && find "$sqlite/prebuilds" -name '*.node' ! -name "linux-$arch.node" -delete

FROM node:${NODE_VERSION}-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    DATABASE_PATH=/data/tavern.db \
    WEB_DIST=/app/web
WORKDIR /app/server
COPY --from=build /out /app
# Fails the build if the image's platform can't load its SQLite binary.
RUN node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()" \
 && mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --start-interval=1s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
