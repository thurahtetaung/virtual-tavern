# Reverie

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Reverie** (`packages/private-games/reverie`) is the first private game and the template for new ones: card art comes from R2 (`cards/<nnn>.jpg`, set names and the card back from `manifest.json`), while card-number ranges per set are hard-coded in `CARD_SETS` so the pure logic needs no I/O. Without asset storage (tests, dev) cards render as numbered placeholders, so the game stays testable.
  - **Phones:** play is two tabs on the shared `TabBar`, Table (round, table and hand) and Players (scores and seats); the hand and, for the storyteller, the clue form sit in the fixed `StickyBar` with the `reverie-tell` refusal. Wide screens put the players in the 320 px rail.

- **UI:** While cards are being chosen (clue and pick) the hand is a grid that takes the free height (two across on phones, scrolling inside the bar; up to four across wider screens); otherwise it is a sideways strip; phone table cards and results scroll together inside the available height; the host’s Next turn shares the hand’s fixed action bar on phones. On wide screens the round line sits in the rail; while the table is still empty the hand is two rows of three sized to the window's height (the bare "Your hand" row is dropped there), and a table of four or fewer stands in one row as tall as the window allows; on phones the pick hand takes the clue's free height until the first card is on the table.

## Assets

For Reverie the folder holds `cards/000.jpg…`, `back.jpg` and `manifest.json` (set names and the card back); the card-number ranges per set are fixed in the game's `CARD_SETS`. The guide's first steps show `cards/001.jpg`, `cards/002.jpg` and `back.jpg` at those fixed paths (the emoji while they can't load), and the lobby's pitch shows the manifest's card back.
