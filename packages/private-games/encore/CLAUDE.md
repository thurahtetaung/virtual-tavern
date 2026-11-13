# Encore

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Encore** (`packages/private-games/encore`, id `encore`) is a shedding card game for 2 to 5 with a hand you can never rearrange: Show cards that beat the set on the table, Recruit an end card of it into your hand, or once a round Recruit & Show. The action's word comes from the manifest (`names.recruit`, `reword`); the code never uses the title's word.
  - **Ids:** cards are their two numbers, low first (`"3-8"`), a held card `{ id, up }`; faces are stored low number upright and turned 180° for the other end (`artUp`).
  - **Rules:** Recruit & Show is atomic (refused whole unless its Show beats what is left); a round ends when a hand empties or play comes back to an unbeaten Show's owner (checked as play reaches them); 2 players use reserve cards and own chips. Safe moves are the bot's (`encoreBot`, a one-ply search).
  - **`view()`:** your own hand only; the flip choice only to its maker; where a recruited card went and which way up never; every last hand at `over`.
  - **Testing:** `ENCORE_TEST_DECK` (e.g. `3:1/2 4/1 …`, each card up-number first) deals that order every round.
  - **Phones:** Table (with your hand), Log and Scores on the shared `TabBar`; the turn's actions and Ready sit in the fixed `StickyBar`. First-time tips are a closed fold on phones.

## Assets

**Encore** (`node scripts/r2-upload.mjs encore <folder>`, dry-run first): the 45 card faces in `cards/<id>.webp` (ids are the two numbers, low first: `1-2`…`9-10`; each face stored with its lower number upright, the app turns it 180° for the other end) with small copies in `cards/thumb/` for phone hands, the card back (`back`, `backThumb`), the chip (`chip`), the Recruit & Show marker (`marker`, `markerUsed`), the start player's hat (`startHat`), `box` and `logo`, and a `manifest.json` of the form `{ "cards": { "1-2": { "art": "cards/1-2.webp", "thumb": "cards/thumb/1-2.webp" }, … }, "artUp": "low", "back": "…", "backThumb": "…", "chip": "…", "marker": "…", "markerUsed": "…", "startHat": "…", "box": "…", "logo": "…", "names": { "recruit": "…" }, "credit": "…" or { "title", "paragraphs": […], "links": [{ "label", "href" }] } }` (shape in `packages/private-games/encore/src/logic/manifest.ts`). `names.recruit` is the word the game uses for taking a card from the table (its other forms are derived, or given as `recruits`, `recruited`, `recruiting`); without it the game says "recruit". Every field is optional: without the manifest, cards are drawn from their two numbers. Once it is uploaded, set the title with the `encore` id.
