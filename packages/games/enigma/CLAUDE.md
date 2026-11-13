# Enigma

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`; this file lists only what this game adds. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Enigma** (`packages/games/enigma`): votes only resolve when every eligible teammate has picked the same code and pressed Lock in. Team chat and shared notes live in game state and are filtered per team by `view()`.

- **UI:** Team-note removal targets are at least 44 px; end explanations use secondary body text beneath the result headline; when the score or the showdown decided it, the finale gives one verdict line and the full explanation moves to the Score tab. A code still being written shows the shared loading slate (dots beside the line), and the picker's digits use the numeral size. The team notes scroll only their own list to the newest note (never the fitted sheets area). The end's emblem says how the game was won (🕵️ interceptions, 💥 the other side's miscommunications, 🔐 showdown, 🏆 score, 🤝 draw); phones open the end on the last round's codes, or on the score when a showdown decided it. Keywords and clues are set in the display face; result stamps sit on their own line on phones.
