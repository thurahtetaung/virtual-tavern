# Conveyor

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Conveyor** (`packages/private-games/conveyor`, id `conveyor`) is a simultaneous card-drafting game of dishes for 2 to 8: pick a card at once, reveal together, pass the rest; 3 rounds, then desserts; a menu of 8 dish types out of 23. Never write its card or menu names either.
  - **Ids:** plain dish ids (`nigiri-egg`, `maki-2`, `chopsticks-1`…), menus our own ids (`PRESETS`). Phones load only thumbnails, warmed into Cache Storage (`preloadThumbs`).
  - **Rules:** a pick is secret and changeable until the last is in; then the turn resolves in a fixed order (`advance`); a spoon's request and the giver's options only reach the two of them. The owner's and designer's rulings are in `game.test.ts`.
  - **`view()`:** picks only as "picked", a menu's draw only to its player; trays and kept desserts public.
  - **Testing:** `CONVEYOR_TEST_DECK` (e.g. `2:miso onigiri-circle …`, by table size) tops each round's deck.
  - **Phones:** Play (hand and choices), Table (the trays) and Scores (totals and log) on the shared `TabBar`; Lock in and Ready sit in the fixed `StickyBar`.

- **UI:** End actions share equal-width columns so the phone’s Play again label fits.

## Assets

**Conveyor** (`node scripts/r2-upload.mjs conveyor <folder>`, dry-run first): the 45 card faces in `cards/<variant>.webp` (440 × 690) with small copies in `cards/thumb/` (phones show only these in hands and trays, and load a full face only when a card is opened big), the 22 dish tiles in `tiles/<type>.webp` (+ `tiles/thumb/`, and the group backs in `tiles/back/`), the card back, `board` and `box`, and a `manifest.json` of the form `{ "cards": { "nigiri-egg": { "art": "cards/….webp", "thumb": "cards/thumb/….webp" }, "maki-2": …, "spoon-5": …, "icecream": …, "order": … }, "tiles": { "<type id>": { "art", "thumb" } }, "tileBacks": { … }, "back": { "art", "thumb" }, "board": …, "box": …, "names": { "types": { "<type id>": "…" }, "cards": { "<variant id>": "…" }, "menus": { "first": "…", "classic": "…", "sampler": "…", "master": "…", "points": "…", "cutthroat": "…", "banquet": "…", "two": "…" } }, "credit": "…" or { "title", "paragraphs": […], "links": [{ "label", "href" }] } }` (shape in `packages/private-games/conveyor/src/logic/manifest.ts`; the ids are those of `cards.ts`). Every field is optional: without the manifest, cards are drawn from their dish, points and icons, with plain dish words for names. Once it is uploaded, set the title with the `conveyor` id. The guide's steps show the nigiri, maki and pudding tiles and the card back when the manifest has them, and the lobby's pitch shows the box.
