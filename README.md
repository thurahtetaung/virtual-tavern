# Virtual Tavern

A private, self-hosted place to play party games with friends in the browser.
Create a room, share the link, and play together in real time. There are no accounts and nothing to install.

- **Multiple games, one platform.** Every game plugs into the same rooms, presence, timers and persistence. The first game is **Codenames**.
- **Beginner friendly.** Each game ships a rules guide, shown on its "How to play" page and in a rules drawer during play, and the screen always tells you what to do next.
- **Your words.** Admins curate word lists, and hosts mix and match them per game.
- **Survives restarts.** Rooms are saved after every move, so players reconnect and carry on.

## Development

Requires [Volta](https://volta.sh), which installs the pinned Node LTS and pnpm automatically. Set `VOLTA_FEATURE_PNPM=1` in your shell profile.

```sh
pnpm install
pnpm dev          # web on http://localhost:5173, server on :3000
```

Set `ADMIN_PASSWORD=...` in the environment of `pnpm dev` to try the `/admin` area.

| Command                                        | What it does                                            |
| ---------------------------------------------- | ------------------------------------------------------- |
| `pnpm test`                                    | Unit and integration tests (Vitest)                     |
| `pnpm build && pnpm e2e`                       | Browser tests against the production build (Playwright) |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | Code quality                                            |

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions.

## Project layout

```
apps/server              Fastify + Socket.IO room server, SQLite (Drizzle), admin API
apps/web                 React + Vite site: home, rooms, rules, admin
packages/game-sdk        The contract every game implements (rules, guide, UI props)
packages/protocol        Shared HTTP and socket types
packages/ui              Shared React building blocks
packages/games/codenames Codenames rules, guide and UI
```

- [Adding a game](docs/adding-a-game.md)
- [Deployment](docs/deployment.md): Docker, Cloudflare Tunnel, Tailscale, and automated releases

## License

[MIT](LICENSE)
