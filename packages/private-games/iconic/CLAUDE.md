# Iconic

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- Seat changes accept only own entries in the seat map and reject prototype keys before mutation.

- **Iconic** (`packages/private-games/iconic`, id `iconic`) is an icon-board word-guessing game for 3 to 12: clue givers describe a secret word only with markers and cubes on a board of 118 icons; everyone else types guesses. Never write the online version's site either.
  - **Ids:** icons are numbers `1`…`118` in the printed board's order with a group each (`src/logic/board.ts`); stats and recaps name icons as `{card:17}`. Every marker set shows its symbol and number, never colour alone.
  - **Words** (`usesWordLists`, lists per level, e.g. the built-in "Iconic: Easy/Hard/Challenging" packs; Iconic is a phrase game for word packs): the deal keeps a shuffled deck per level in state (secret). `ICONIC_TEST_WORD` is every card's first word.
  - **Judging (the owner's rulings):** the clue givers mark guesses; a `wordKey` match is flagged "looks right" for them only, never awarded by itself; ✓ can be undone for 5 s.
  - **`view()`:** the card only to the clue givers while choosing, the word to them and a helper, the pair's proposal and vetoes only to the pair, the pending award and "looks right" flags only to the clue team; guesses and marks are public. No bot.
  - **Phones:** while clues are given, Board, Guesses and Scores sit on the shared `TabBar` (Guesses carries a count of the guesses waiting for the clue givers' judgement); the guess box sits in the fixed `StickyBar` (`ic-guess`) under every view, and the choose step's actions too (`ic-choose`); the icon groups use the shared `Tabs`. First-time tips are a closed fold on phones. At the end phones show the standings as a table, without the podium, so a tie still fits.

- **UI:** while the clue givers choose, everyone else sees the wait and the scores in one row on wide screens, so the board under them gets the height (icons about 62 px at 1440 × 900, where the window's width caps them). On phones the reveal's word stands in the middle of the free height, with the clue that led to it under the result. Wide boards draw a rule between icon groups under uppercase group captions.

## Assets

**Iconic** (`node scripts/r2-upload.mjs iconic <folder>`, dry-run first): the 118 board icons as `icons/<id>.webp` (160×160, ids `1`…`118` in the printed board's order: column by column, each row left then right; 1–28 things, 29–56 qualities, 57–78 matter, 79–106 shapes, 107–118 colours), the five set markers `markers/main.webp` and `markers/sub1.webp`…`sub4.webp` (178×178), `box/front.webp`, `logo.webp`, `back.webp`, and a `manifest.json` of the form `{ "title": "…", "icons": { "1": { "name", "meanings": […], "art": "icons/1.webp" }, … }, "markers": { "main", "sub1", "sub2", "sub3", "sub4" }, "box", "logo", "back" }` (shape in `packages/private-games/iconic/src/logic/manifest.ts`). Every field is optional: without the manifest, icons are numbered tiles ("Icon 17") and markers their set symbols. Once it is uploaded, set the title with the `iconic` id. The three built-in "Iconic" word packs (Easy, Hard, Challenging) are seeded once and tagged only for `iconic`; admins can add more lists tagged for it and the host picks lists per level.
