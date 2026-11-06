# Mosaic

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Wall placement and removal accept only own player entries; wall indexes must be legal integers.
- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Mosaic** (`packages/private-games/mosaic`, id `mosaic`) is a tile-drafting game for 2 to 4, with three host options (grey wall, jokers, special factories).
  - **Ids:** colours `blue`, `yellow`, `red`, `black` and `aqua` (the manifest may key it `white`), each with a symbol (`SYMBOL`) on every tile and wall space. The wall is a plain 5 × 5 grid (`rules.ts`); only `columnOf` is the coloured wall's.
  - **Rules that surprise (the owner's rulings in `game.test.ts`, `options.test.ts` and the guide):** taking the first-player marker with a full floor costs nothing; an empty bag takes the whole lid, and a round that would start with no tiles ends the game. A joker on a colour's space bars that colour from the row; jokers count for rows and columns, never a colour. Any choice of wall space runs the `wall` stage. There is no undo; the pick sheet has a confirm step.
  - **`view()`:** everything on the table is public; the bag only as counts per colour.
  - **Testing:** `MOSAIC_TEST_BAG` (e.g. `top:<letters>;wall0:<letters>;sf:sf4,-,sf5`) stacks the bag, fills the first seat's wall rows and fixes special factory faces, with the first seat starting.
  - **Phones:** the wall choice and the wall-tiling's Next round sit in the fixed `StickyBar`. First-time tips are a closed fold on phones.

## Assets

**Mosaic** (`node scripts/r2-upload.mjs mosaic <folder>`, dry-run first): the five tile faces in `tiles/` (256×256; the light blue may be named `white`), `tiles/first.webp` (the first-player marker), small copies in `tiles/thumb/` (96×96), the factory disc `factory.webp` (a round picture with a transparent outside, + `thumb/factory.webp`), the board pictures `board/colour.webp` and `board/grey.webp` (the guide shows both), `box.webp`, the joker `tiles/joker.webp` (a decal on a plain ground), the special factory faces in `special-factories/` (`sf1`, `sf3`, `sf4`, `sf5` and one `sf2-<colour>` per colour, round with a transparent outside, + `special-factories/thumb/`; the game lays its own tile over an `sf2` face's centre), and a `manifest.json` of the form `{ "title": "…", "credit": "…", "tiles": { "blue", "yellow", "red", "black", "white", "joker" }, "jokers": "…" (older key for the joker), "thumbs": { "blue", …, "white", "joker", "first", "factory", "box", "sf1", "sf2-blue", …, "sf2-white", "sf3", "sf4", "sf5" }, "first": "…", "factory": "…", "board": { "colour", "grey" }, "specialFactories": { "sf1", "sf3", "sf4", "sf5", "sf2": { "blue", "yellow", "red", "black", "white" } }, "box": "…" }` (shape in `packages/private-games/mosaic/src/logic/manifest.ts`; every field is optional). Without it, tiles are plain colours, each with its symbol. Once it is live, set the title with the `mosaic` id.
