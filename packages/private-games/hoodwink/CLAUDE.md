# Hoodwink

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Hoodwink** (`packages/private-games/hoodwink`) is a bluffing trivia game: everyone writes a fake answer to a strange true question, then votes for the truth. Its questions come only from the private question decks (`usesQuestionDecks`), never from the repository. The lobby lists decks from `ctx.content.questionDecks()`, kept in game state and refreshed on every lobby action, so deck names only reach players in an unlocked room. A lie matching the answer or an alternate under `wordKey` is refused, identical lies merge, and `view()` hides the answer and authors until the reveal. A question's `decoys` power "Lie for me" (and strict-timeout fill-ins), worth half points, and pad a small board with house fakes that score for nobody; offered fakes (`fakeChoices`, only to the presser via `myFakes`) never reach anyone else's offer or the board. The last round counts double. The reveal turns the picked answers over one at a time (least picked first, the truth last; `revealOrder`/`revealProgress` timed from `revealAt`), with the scores held back until it ends; `skip-reveal` and reduced motion show the whole board at once.

- **UI:** answers are game-show tiles in the display face (64 px tall on phones, 112 px wide); every stage sits in the middle of the free height (phones and wide screens) under a pool of lamp light; the reveal's answer card is set in the display face, 48 px on wide screens; at the end the standings replace the rail's scores.
