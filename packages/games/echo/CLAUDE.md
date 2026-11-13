# Echo

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`; this file lists only what this game adds. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Echo** (`packages/games/echo`): clue and guess matching uses `normaliseWord`/`wordKey` from `packages/game-sdk/src/words.ts` (case, accents, punctuation, plurals and simple stems). `view()` hides the secret word from the guesser until the reveal and sends them only the surviving clues, without authors or the cancelled ones (just `cancelledCount`). The UI pre-checks clues with the engine's `clueProblem` so refusals show inline.
