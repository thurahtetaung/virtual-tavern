# syntax=docker/dockerfile:1
# Keep in sync with the "volta" pin in package.json.
ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-slim AS build
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

FROM node:${NODE_VERSION}-slim
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    DATABASE_PATH=/data/tavern.db \
    WEB_DIST=/app/web
WORKDIR /app/server
COPY --from=build /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
