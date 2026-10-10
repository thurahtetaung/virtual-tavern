# Adding a game

Each game is a self-contained workspace package under `packages/games/<id>`. The platform (rooms, presence, persistence, timers and the web shell) needs no changes beyond two registry lines.

## 1. Rules: `src/logic`

Implement `GameDefinition` from `@vt/game-sdk` (see `packages/games/codenames/src/logic/game.ts`):

- **State is plain JSON.** The server stores it after every move and reloads it after restarts.
- **Logic is pure.** Use `ctx.rng` for randomness, `ctx.now` for time and `ctx.content` for word lists. Never read `Math.random`, `Date.now` or the network.
- `reduce` **returns** a `GameError` for an illegal move; the player sees its message as a toast.
- `view(state, playerId)` must strip anything that player may not see. The whole security model rests on this, so test it.
- Lobby setup (teams, seats, settings) is ordinary game actions; `ctx.isHost` tells you who may change settings.
- Timers: return the next deadline from `nextDeadline`, and the server calls `onDeadline` when it passes. **The timer contract:** `onDeadline` must always make progress (end the turn, mark the round timed out…), so that the returned state's `nextDeadline` is later than now, or null. If it is not, the room host logs it, allows one short back-off, then stops the timer until the next player action. An `onDeadline` that throws is logged and retried a few seconds later.
- **State stays small.** The room host rejects any change whose state exceeds about 256 KB of JSON (`MAX_STATE_JSON_LENGTH`), with a `state-too-large` error to the player who made the move, so cap your own logs, chat and history (keep the last N entries) rather than letting them grow for the life of a room.

## 2. Guide: `src/logic/guide.ts`

Every game must ship a `GameGuide` (the `guide` field is required). The same guide renders on the "How to play" page and in the in-game rules drawer, so all games read alike. Write it for someone who has never played: say the goal first, then short setup steps, then the rules in play order, and finish with tips. Update it in the same PR as any rule change.

## 3. UI: `src/ui`

Export a React component that takes `GameUiProps<View, Action>`. Use the `@vt/ui` building blocks (`Button`, `Panel`, `Hint`, `Countdown`, `Modal`, and the lobby's `WordListPicker` and `TimerSettings`) so the game matches the rest of the site. Design for a phone first: a player should never need to scroll through more than about one screen to act. Split dense screens into tabs, as Enigma does. Always show a `Hint` telling the viewer what to do right now.

## Word content

Games read word lists through `ctx.content`. Built-in packs live in `apps/server/word-packs/` and are shared by every word game; see CLAUDE.md for the format.

## 4. Register it

- Server: `apps/server/src/games/registry.ts`
- Web: `apps/web/src/games/registry.ts` (with a lazy import of the UI)

## 5. Test it

- Unit-test the rules with a seeded harness (see `packages/games/codenames/src/logic/test-utils.ts`).
- Add a Playwright spec in `e2e/` that plays one game with several browser contexts.
