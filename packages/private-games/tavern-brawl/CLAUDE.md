# Tavern Brawl

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Tavern Brawl** (`packages/private-games/tavern-brawl`, id `tavern-brawl`) is a hero card brawler for 2 to 6: twelve heroes with 28-card decks, 10 hit points; draw 1, play 1, resolve its symbols in printed order. Never write its heroes' names either.
  - **Ids:** heroes are class words (`brute`, `mage`, `knight`, `thief`, `ranger`, `druid`, `dragon`, `owl`, `psychic`, `slime`, `eye`, `mimic`), cards `<hero>.<nn>` in `src/logic/cards.ts`. `private-assets/tools/tavern-brawl-manifest.py` builds the manifest and checks the card table against the art.
  - **Engine** (`src/logic/engine.ts`, mutating a `structuredClone` draft): card instances are random tokens with an `owner` (whose discard it goes to); a taken shield keeps its damage. Cards resolve as a stack of `frames` with a damage `queue`; a step needing an answer opens one `choice`, skipped when only one answer really differs. `debt` is the cards still owed, `played` the played-this-turn zone. Knockouts are checked once the whole outer card has resolved; nobody left is a tie. Choices asked of other players get a fixed 20 s with a fallback. With 5 or 6 players regular attacks reach only the nearest living neighbours, and knocked-out players stay as ghosts that attack for 1 once a turn, never for a knockout. The owner's rulings are in the guide's Table rulings.
  - **`view()`:** your own hand only; cards taken in secret are only a count in the log; choice options only to the chooser.
  - **Testing:** `TAVERN_BRAWL_TEST_DECK` stacks deck tops and makes the first seat start; `TAVERN_BRAWL_TEST_HP` (`3:3,6:3`, by player count) starts e2e games on fewer hit points.
  - **Phones:** Table, Log, Discards and ✦ Powers on the shared `TabBar`; Play sits in the fixed `StickyBar` with `tb-play`.

- **UI:** Each hand card reserves its top-right 44 px Read target above the card-selection button.

## Assets

**Tavern Brawl** (`node scripts/r2-upload.mjs tavern-brawl <folder>`, dry-run first; the folder is what `private-assets/tools/tavern-brawl-manifest.py` checks and completes): `cards/<deck>/<card>.webp` faces (400×630) with `cards/<deck>/thumb/<card>.webp` (240×378), `heroes/<deck>/{hp,ref,portrait,back}.webp` (+ `thumb/`), `box/<set>.webp`, and a `manifest.json` of the form `{ "title": "…", "sets": { "core" | "x1" | "x2": { "name", "box" } }, "heroes": { "<hero>": { "name", "class", "portrait", "portraitThumb", "portraitFocus": [x, y], "hp", "ref", "back" } }, "cards": { "<hero>.<nn>": { "name", "face", "thumb", "text" } }, "credit": { "title", "paragraphs": […] } }` (shape in `packages/private-games/tavern-brawl/src/ui/assets.ts`). Hero ids and card ids (`brute.01`…) are the neutral ones in `packages/private-games/tavern-brawl/src/logic/cards.ts`; `text` is the printed power text with `{atk}`, `{shd}`, `{heal}`, `{play}` and `{draw}` symbol tokens. Every field is optional: without the manifest, heroes show as coloured discs with their class word and cards as coloured placeholders named from their symbols. Once it is uploaded, set the game's title (next step) with the `tavern-brawl` id.
