# Royal Post

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Royal Post** (`packages/private-games/royal-post`) plays two editions (Classic: 16 cards, 2 to 4 players; 2019: 21 cards, 2 to 6, with the Spy and Chancellor), chosen by the host. Code uses only the plain role ids (`spy`, `guard`, `priest`, `baron`, `handmaid`, `prince`, `chancellor`, `king`, `countess`, `princess`); names and art per edition come from the manifest (`{ editions: { classic: { back, cards: { guard: { name, art } … } }, "2019": { … } } }`). `view()` sends only your own hand; Priest, Baron and King results go to a per-player private notes log.

## Assets

For Royal Post (`node scripts/r2-upload.mjs royal-post <folder>`, dry-run first) the folder holds the card images and a `manifest.json` of the form `{ "editions": { "classic": { "back": "<path>", "cards": { "guard": { "name": "…", "art": "<path>" }, … } }, "2019": { … } } }`, where paths are relative to the game's folder; any card left out shows a styled placeholder.
