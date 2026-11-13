# Skyfire

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Skyfire** (`packages/private-games/skyfire`, id `skyfire`) is a cooperative fireworks card game for 2 to 5: you see everyone's cards but your own; clue, play or discard to build five fireworks. Never write its edition names either.
  - **Ids:** suits are colour ids (`red`…`multi`, `black`) with a symbol on every card so colour is never the only clue. Card ids are dealing positions (`c1`…), so an id says nothing about its card. Hands load only thumbs.
  - **Rules (the owner's rulings):** empty clues are allowed unless `zeroClues` is off; host options multicolour, black powder and the expert ending combine. The clue memory setting `memory` drops older clue log entries from `view()`.
  - **`view()`:** every hand but your own (yours as ids and marks only), who clued which card never, the replay at `over`. Safe moves never play a card.
  - **Testing:** `SKYFIRE_TEST_DECK` (e.g. `r1 y1 g5 m3 k5 …`, top first) tops the deck.
  - **Phones:** Table, Discards and Log on the shared `TabBar`; your hand stays pinned above it.

- **UI:** Discard counts on completed fireworks retain full-opacity secondary text. Wide screens in play put the top strip beside the firework piles (up to 96 px, capped at 9.5% of the screen's height) and leave the "since your last turn" lines to the rail's log, whose list is capped by the height too, so your own hand stays in view at 1280 × 720 with the playtest bar; the end card's piles are sized by the end's fit (`--vt-fit`) so Play again stays in view; the end's table part is one column with 64 px piles. The replay slider is 24 px tall (44 px on touch). An empty firework pile is a soft wash of its colour with its symbol in it (white and yellow take their dark ink in light mode, so the symbol clears 3:1). The top strip's counters are at least 24 px tall. On phones with one or two teammates each name sits over its hand as a 44 px row so the cards take the row (about 65 × 91 px); the end's replay cards keep a 44 px target with the shared tap band. The first-time tips line sits at the top of the rail on wide screens, above the play on phones.

## Assets

**Skyfire** (`node scripts/r2-upload.mjs skyfire <folder>`, dry-run first): card faces in `cards/<suit>-<number>.webp` (suits `red`, `yellow`, `green`, `blue`, `white`, `multi` and `black`, numbers 1–5, each with an optional small `thumb` for the hands and an optional sharper `zoom` for the card sheet), the card back (`back`, `backThumb`), the clue token (`tokens.clue`), the three fuse tiles (`tokens.fuse`, a list of `{ "unused", "used" }` in order), a picture per firework (`suits.<suit>`, the empty stacks' backdrop and the guide's tiles), `box` and `lobby`, and a `manifest.json` of the form `{ "cards": { "red-1": "cards/red-1.webp" | { "art": "…", "thumb": "…" }, … }, "back": "…", "backThumb": "…", "tokens": { "clue": { "art", "thumb" }, "fuse": [{ "unused": { "art", "thumb" }, "used": { … } }, …] }, "suits": { "red": "…", … }, "box": "…", "lobby": "…", "guide": { "tagline": "…" }, "credit": "…" or { "title", "paragraphs": […], "links": [{ "label", "href" }] } }` (shape in `packages/private-games/skyfire/src/logic/manifest.ts`). Every field is optional: without the manifest, cards are drawn from their colour, symbol and number, and the tokens are emoji. The number and symbol are always drawn over small card art. Once it is uploaded, set the title with the `skyfire` id.
