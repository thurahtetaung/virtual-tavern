# Hydra's themed edition

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Hydra's themed edition** (`packages/private-games/hogwarts`, id `hogwarts`, also CC BY-NC-SA 4.0) is `defineHydra()` under its own id (its own lobby entry, stats and recaps, sharing Hydra's awards), with `HydraGame` given `edition="hogwarts"`. `hogwarts` is the only word of its theme allowed in tracked files: every name, line of copy, portrait, board geometry, team colour (overriding Tailwind's sky and red scales on the game's root), display font (with a per-player "Plain headings" switch) and the credit come from its private manifest. Tests and e2e use made-up manifests with neutral words.

## Assets

**Hydra's themed edition** (`node scripts/r2-upload.mjs hogwarts <folder>`, dry-run first; the folder is what `private-assets/tools/hydra-wizard-cut.py` writes): the same files and manifest shape as Hydra's, plus `roles` pools of any length (each player gets a portrait from their team's pool, never the same one twice in a game while the pool allows), `art.geometry` (`{ "red" | "blue": { "x0", "pitch", "top", "bottom", "ratio" } }`, fractions of the board image, with `"lamps": { "xs": […], "y", "size" }` on the blue board: where the policy slots and tracker lamps sit), `colors` (`{ "blue", "red" }`: each team's accent colour), `fonts` (`{ "heading": "fonts/<file>.woff2", "headingFamily": "…" }`, a display font for the title, the win banner and the big moments only; players can switch it off with "Plain headings"), `copy` (`{ "<key>": "…" }`: any line of table talk reworded, keys and defaults in `packages/private-games/hydra/src/logic/copy.ts`) and `credit.art` (`{ "name", "link" }`, the edition's artist, shown with the game's credit). Every name, line, picture and font comes from this manifest; the repository holds none of them. Once it is uploaded, set its title with the `hogwarts` id.
