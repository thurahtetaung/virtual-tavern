# Masquerade's back-room edition

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Masquerade's back-room edition** (`packages/private-games/masquerade-originals`, id `masquerade-originals`) reuses `defineMasquerade` with an ids-only pack: Edition 1 `e1-01`…`e1-30`, Edition 2 `e2-01`…`e2-20` (the host picks one or both). Names, art, coaching and question ideas come from the private manifest (`{ back?, editions?: { e1?: { name }, e2?: { name } }, locations: { "e1-01": { name?, art?, emoji?, tip?, questions?: string[] } } }`; location art is landscape 5:3, the back about 20:13, both object-cover); without it, locations show as "Location 1"…"Location 50".

- **UI:** The shared board supplies a fluid desktop location grid and independently scrollable location panel. Its pictures carry each place's name, so tiles show no caption (screen readers still get it).

## Assets

For Masquerade's back-room edition (`node scripts/r2-upload.mjs masquerade-originals <folder>`, dry-run first) the folder holds the location pictures and a `manifest.json` of the form `{ "back": "<path>", "editions": { "e1": { "name": "…" }, "e2": { … } }, "locations": { "e1-01": { "name": "…", "art": "<path>", "emoji": "…", "tip": "…", "questions": ["…"] }, … } }` (ids `e1-01`…`e1-30` and `e2-01`…`e2-20`; every field optional; location art is landscape, 5:3 such as 600×360, and the back is shown on the spy's card); a location left out shows as "Location n".
