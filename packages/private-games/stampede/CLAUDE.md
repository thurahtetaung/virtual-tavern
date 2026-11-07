# Stampede

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Stampede** (`packages/private-games/stampede`, id `stampede`) is an answer-matching party game for 3 to 20 (room 30): everyone secretly writes what most people will say; the biggest group (2+) wins a cow each, and the only player alone with their answer takes the Pink Cow, which blocks winning. The cows are emoji; the optional manifest only renames them.
  - **Questions are open-question decks** (`usesQuestionDecks`, `questionKind: 'open'`), listed in the lobby from `ctx.content.questionDecks()` (kept in state, so deck names only reach an unlocked room), all but adult-only on by default.
  - **Matching is fully automatic, with no fixes (the owner's rule)** (`match.ts`, `sameAnswer`/`autoGroups`, tested hard in `match.test.ts`): `wordKey` words equal in order or sorted, or plain spellings one edit apart from 5 letters (two from 10); never synonyms or abbreviations. Groups are the transitive closure (union-find), so the result doesn't depend on who typed first.
  - **Rulings:** a tie for biggest scores nobody but a lone answer still takes the Pink Cow; blanks and late answers match nothing and are never alone; only players without the Pink Cow count for the win; a tie at the target raises it (house rule `sharedWin`: they share); house rule `holderPicks` lets the holder pass it on.
  - **`view()`:** only "answered" ticks until the writing ends; the seed and the question history never leave the server.

- **UI:** The main answering prompt uses display typography and wraps long words above the fixed answer form.

## Assets

**Stampede** (optional, `node scripts/r2-upload.mjs stampede <folder>`): only a `manifest.json` of the form `{ "title": "…", "names": { "pink", "cow", "cows" }, "credit": { "title", "paragraphs": […] } }` (shape in `packages/private-games/stampede/src/logic/manifest.ts`). The game needs no art (its cows are emoji) and every field is optional; without it the cows are called the Pink Cow, cow and cows. Its questions are open-question decks (see **Import question decks**). Set the title with the `stampede` id.
