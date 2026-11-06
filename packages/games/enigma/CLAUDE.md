# Enigma

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`; this file lists only what this game adds. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Enigma** (`packages/games/enigma`): votes only resolve when every eligible teammate has picked the same code and pressed Lock in. Team chat and shared notes live in game state and are filtered per team by `view()`.
