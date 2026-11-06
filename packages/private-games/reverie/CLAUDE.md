# Reverie

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Reverie** (`packages/private-games/reverie`) is the first private game and the template for new ones: card art comes from R2 (`cards/<nnn>.jpg`, set names and the card back from `manifest.json`), while card-number ranges per set are hard-coded in `CARD_SETS` so the pure logic needs no I/O. Without asset storage (tests, dev) cards render as numbered placeholders, so the game stays testable.

## Assets

For Reverie the folder holds `cards/000.jpg…`, `back.jpg` and `manifest.json` (set names and the card back); the card-number ranges per set are fixed in the game's `CARD_SETS`.
