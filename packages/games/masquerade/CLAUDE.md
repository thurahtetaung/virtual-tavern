# Masquerade

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`; this file lists only what this game adds. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Masquerade** (`packages/games/masquerade`): players talk out loud and the app never tracks the asking. It deals (locals get only the location, the spy nothing; two spies at 7+ is a host option), names who starts, runs the round clock, then one secret vote (45 s, non-voters abstain). `namedBy` names a player only if at most as many players as there are spies have as many votes, so ties name nobody. Only a caught spy guesses the location (30 s). The logic is `defineMasquerade(config)`, so the pack is a parameter; the public pack (`src/content/`) is self-written: never copy the commercial game's locations, and never name that game. `view()` sends the location only to locals, hides the spies until the reveal (caught spies show in the guess stage) and sends only `votedCount`/`myVote` until the vote resolves. Board marks live in localStorage per table and deal.

- **UI:** Desktop location tiles use a fluid grid at least 9.5 rem wide (five across beside the play column); on desktop each column (play, and the board with the question ideas below it) fits the screen and scrolls on its own, so the page itself never scrolls while playing. Location tiles with a picture keep their name for screen readers only (the pictures carry it). The talk status gives the full brief in round 1 only. At the end the location's picture shows once, in the finale; the lobby lines up six places three across on wide screens.
