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
- Optionally implement `insights` to feed the stats page: a pure `insights(before, after, action, by)` returning `InsightEvent`s (clues, guesses, outcomes) for each change. To show figures and fun facts from them, add readers for your event types in `apps/server/src/stats/figures.ts` and `aggregate.ts`, and test the real game through `apps/server/src/routes/stats.test.ts` (or with insight-shaped events in `stats/sqlite-store.test.ts`). On the page, list the word kinds your game reports in `apps/web/src/stats/word-kinds.ts` and append its id to the end of `FIXED_ORDER` in `apps/web/src/stats/palette.ts`. Figures can be `number`, `percent`, `split`, `histogram` or `matrix` (a small table drawn as a heatmap, each column shaded on its own scale). The stats recorder detects a game's start and end from its state's `phase` (`playing`, then `over`), so keep any finer stages in another field.

## 2. Guide: `src/logic/guide.ts`

Every game must ship a `GameGuide` (the `guide` field is required). The same guide renders on the "How to play" page and in the in-game rules drawer, so all games read alike. Write it for someone who has never played: say the goal first, then short setup steps, then the rules in play order, and finish with tips. Also give it a `quickStart`: 5 or 6 short bullets that cover a whole game ("what do I do now?"). It renders first, both on `/rules/:id` and in the room's rules drawer, and `apps/server/src/games/guides.test.ts` checks every game has one. Update the guide in the same PR as any rule change.

## 3. UI: `src/ui`

Export a React component that takes `GameUiProps<View, Action>`. Use the `@vt/ui` building blocks (`Button`, `Panel`, `Hint`, `Countdown`, `Modal`, and the lobby's `WordListPicker` and `TimerSettings`) so the game matches the rest of the site. Give `WordListPicker` a `summary` that says how your game uses the words (its default describes the Codenames board). Report `statusFor(...).yourMove` through `setYourMove` in a block-bodied effect while a game is in play, so the tab title shows "● Your turn". Design for a phone first: a player should never need to scroll through more than about one screen to act. Split dense screens into tabs, as Enigma does. Always show a `Hint` telling the viewer what to do right now.

The shell and `@vt/ui` share the patterns every game needs, so use them rather than rolling your own:

- **Who we're waiting for:** name people, never count them. `waitingFor(ids, room.players, { you })` from `@vt/game-sdk` gives "Waiting for: Ana, Ben (offline)", and `waitingForHost(room)` gives "Waiting for Ana (host) to start…". List players with `PlayerTag` (👑 for the host, an "offline" mark).
- **Timers:** give `Countdown` a `label` for what it times ("to give a clue"). Strict timers add `atZero` (what happens at 0:00); reminder timers set `soft` and an `expiredHint` (what happens now that time is up). When `onDeadline` acts for someone, record it in the log and show it with `TimeoutNote` or `timedOut()` ("⏱ Time ran out: a word was picked for you").
- **Watchers:** call `useSpectatorPrompt(setSpectator, watching ? { text, actionLabel, action } : null)` from the game root. The shell shows "You're watching" at the top of the room, and the button runs your action, usually `revealElement(id)` on your seat control or a direct "sit" action.
- **Lobby:** wrap the Start or Deal control in `StickyBar`, so it floats at the bottom of a phone screen while its spot is out of view.
- **Refusals:** put a `RefusalSlot anchor="…"` under a form and send its action with `act(action, { anchor: '…' })`. The server's refusal then appears there, or as a toast when the slot isn't on screen.
- **End screens:** use `Standings` for scored games. It shows a podium, ties sharing a place, and the full final standings. Say "X wins" once, in the status line or the result panel, never both.

## Word content

Games read word lists through `ctx.content`. Set `usesWordLists: true` on the definition: each list is tagged with the games that offer it ("Used by" in the admin editor), and a room's `ctx.content` only sees the lists tagged for its game, with lists made only for that game first; lists an admin has switched off are hidden too, so a saved selection may name lists `ctx.content` no longer returns. Built-in packs live in `apps/server/word-packs/` and are shared by every word game; see CLAUDE.md for the format.

## Question content

Trivia games read admin question decks through `ctx.content`. Set `usesQuestionDecks: true` on the definition, and the room's `ctx.content` gains `questionDecks()` (the enabled decks tagged for the game: id, name, description, question count and an `adult` flag) and `questions(deckIds)` (each `Question` has `id` `<deckId>:<index>`, `deckId`, `prompt`, `answer`, `alternates` and optional `decoys`, built-in fake answers a game may use as house lies). Both methods are optional in `ContentProvider`, so check they exist and treat a missing deck as empty: a saved selection may name decks an admin has since switched off or deleted. Each deck's `games` array says which games offer it (new decks default to `["hoodwink"]`); the admin API accepts only registered games that set `usesQuestionDecks`, so register the game before tagging decks for it. The decks are protected content, so only **private** (back-room) games may use them: lobbies list decks with `GET /api/backroom/question-decks/:gameId`, which answers 404 unless the browser holds a current back-room unlock and the game is private and sets `usesQuestionDecks`, and then returns summaries only. Simpler still, and what Hoodwink does: keep the summaries from `ctx.content.questionDecks()` in your state (refreshed on lobby actions), so they only ever reach players already in an unlocked room. A public trivia game would need its own endpoint and a decision about exposing deck names. The decks themselves are private and never go in the repository: tests use small made-up decks.

## Private games

A back-room game (`access: 'private'`) never names its commercial original in the repository: it uses a code name, and the admin sets the title unlocked players see (`/tavern-keeper` → Back-room titles, or `scripts/set-game-title.mjs`). Names, art and sound come from the game's private `manifest.json` in asset storage, with placeholders when there is none.

## 4. Register it

- Server: `apps/server/src/games/registry.ts`
- Web: `apps/web/src/games/registry.ts` (with a lazy import of the UI; keep the literal `id: '<id>',` line, which a test reads)
- Add the package to `apps/server/package.json` (devDependencies) and `apps/web/package.json` (dependencies), run `pnpm install`, and update the tests that list every game id (`apps/server/src/app.test.ts`, `apps/server/src/routes/backroom.test.ts`).

## 5. Test it

- Unit-test the rules with a seeded harness (see `packages/games/codenames/src/logic/test-utils.ts`).
- Add a Playwright spec in `e2e/` that plays one game with several browser contexts.
