# Thorns

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Thorns** (`packages/private-games/thorns`, id `thorns`) is a disc-bluffing bidding game for 3 to 6: three roses and a thorn each, discs stacked face down, bids, and the Challenger turns over their own first; two won challenges, or being the last left, wins. The commercial game's name is also one of its disc words, so the repo never uses that word at all.
  - **Ids:** discs are `rose`, `thorn` and `chance` (the Last Chance disc, a host option); text uses name tokens (`{rose}`, `{thorns}`, `{Chance}`, `src/logic/names.ts`, `fillNames`). Without a manifest discs are emoji on the player's room colour.
  - **Rules (the owner's rulings):** the lost disc is secret (random from another's thorn, the Challenger's choice from their own); a revealed thorn that was its owner's last disc knocks its owner out. A player who leaves is away, not out (skipped, discs kept, an away Challenger waited for); the host's `remove` takes them out. Strict timers never put a disc down except a round's first.
  - **`view()`:** your own discs only, others' as counts, turned-over and shown discs public, lost discs only to their owner.

- **UI:** Desktop mats use a fluid grid three across (about 330 px wide in an 84 rem table; shorter in two rows above three players) with 110 px discs, with the first-time tips and the table talk in the rail; on phones the mats grow with the screen's height (up to 10rem with 60 px discs for three players while a disc is turned over, 8rem with four, 6rem above that), a lone last mat sits in the middle of its row, and your own discs are 64 px. Each mat has its player's colour as a 4 px band along the top and a sunk surface lit by the lamp. At the end the table is a one-column part with smaller discs, and what everyone had down shows each stack's discs side by side (72 px wide screens, 52 px phones), the thorn ringed in danger.

## Assets

**Thorns** (`node scripts/r2-upload.mjs thorns <folder>`, dry-run first): each set's disc faces and back in `discs/` (240×240) with `discs/thumb/` copies (120×120), the Last Chance face (+ thumb), each set's two mat sides in `mats/` (300×300) with `mats/thumb/` (150×150), `box/cover.webp`, and a `manifest.json` of the form `{ "title": "…", "names": { "rose", "roses", "thorn", "thorns", "chance" }, "sets": [{ "id", "name", "rose", "thorn", "back", "mat", "matScored", "thumbs": { "rose", "thorn", "back", "mat", "matScored" } }, …], "chance": { "face", "faceThumb", "back": null }, "lobby": "box/cover.webp", "credit": { "title", "paragraphs": […] } }` (shape in `packages/private-games/thorns/src/logic/manifest.ts`). Sets go round the table in seat order; a Last Chance disc without a back shows its face (it is marked anyway). Every field is optional: without the manifest, discs are emoji on each player's colour. Once it is uploaded, set the title with the `thorns` id.
