# Edge Worker

A Cloudflare Worker that serves the back room's code (`/backroom-assets/*`) and art
(`/api/backroom/assets/*`) from Cloudflare's cache to browsers whose `vt_edge` pass it can verify.
It never refuses anyone: without a pass it can prove, or on any error, it hands the request to
origin unchanged. The routes run fail open.

- `src/pass.ts`: reads and verifies the pass (HMAC-SHA256 with `EDGE_SECRET`, the unlock's
  lifetime, the current password version).
- `src/paths.ts`: which paths it handles, and the R2 key for an art path (the server's `assetKey`).
- `src/worker.ts`: the request handler (`handle`, with its cache, fetch and clock passed in, so the
  tests run in Node) and the Worker entry.

```sh
pnpm vitest run --project edge     # tests
pnpm --filter @vt/edge build       # dist/worker.js, one ES module to upload
```

Bindings: `EDGE_SECRET` (secret, the server's value) and `ART` (the private art bucket). Deploy-time
values (account, zone, bucket, host) never go in the repository. Setup, checks and rollback are in
`docs/deployment.md` (One-time setup, step 6).
