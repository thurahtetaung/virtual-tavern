# Virtual Tavern

A private, self-hosted place to play party games with friends in the browser.
Create a room, share the link, and play together in real time.

The platform hosts multiple games. The first one is **Codenames**, with custom word lists that admins manage.

> Status: early development.

## Development

Requires [Volta](https://volta.sh) (it installs the pinned Node LTS and pnpm automatically).

```sh
pnpm install
pnpm dev
```

- Web app: http://localhost:5173
- Server: http://localhost:3000 (health check at `/healthz`)

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and commit conventions.

## Project layout

```
apps/server   Fastify + Socket.IO game server
apps/web      React + Vite frontend
```

## License

[MIT](LICENSE)
