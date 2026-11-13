# Starlight

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`, including the shared patterns every back-room game follows; this file lists only what this game adds or does differently. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Starlight** (`packages/private-games/starlight`, id `starlight`) is a picture word-association game for 3 to 6 over 4 rounds: a word and a 3 × 5 grid of picture cards; everyone secretly marks 1 to 10 cards, then Scouts take turns showing one of their marks. It has no other name anywhere, back room included: no DB title and no manifest title.
  - **Cards are Reverie's:** `CARD_SETS`, `Card`, the card URLs and the set picker are shared from `@vt/private-reverie/cards` and `/card`. Its own 84 cards are the shared set `stellar` (878–961, files in `reverie/cards/`, named in Reverie's manifest). Its own manifest holds only the table tokens.
  - **Words are word lists** tagged for `starlight` (`usesWordLists`, kept in game state, so list names only reach an unlocked room); the printed words live only in the database. An entry written `Top / Bottom` gives each side as a word of its own (`wordsFrom`, `lobby.ts`), so players never see a pair. A list tagged only for back-room games never reaches a browser without the back room (tested in `routes/lists.test.ts`).
  - **Rules (the owner's rulings):** the player alone with the most marks is in the Dark (a tie: nobody). A shown card with 2+ other markers is a Spark, exactly 1 a Super-Spark, none and the Scout falls. A Scout with marks left must show one even if it can only fall. `reveal.ts` is the Reveal and scoring.
  - **`view()`:** your own marks only; others' as locked flags, then counts, and who marked a card only once it is shown; unshown marks are never revealed.
  - **Phones:** Table and Stars on the shared `TabBar`; Lock / Unlock and the slate's refusal sit in the fixed `StickyBar`. First-time tips are a closed fold on phones.

- **UI:** The desktop card grid is bounded by viewport height so Lock stays visible, and bounded further on a done round so the results and Next round fit below it. Marked cards share one position-and-mark corner badge; retain the explicit Zoom action for keyboard and touch access.

## Assets

Starlight shows the same cards from Reverie's folder and needs no upload of its own; its printed words go in as a word list in `/tavern-keeper` tagged only for Starlight, one card per entry, `Top / Bottom` for a card with a second word printed upside down (each side is played as a word of its own). The guide's first two steps show Reverie's `cards/003.jpg` and `cards/004.jpg` at those fixed paths (the emoji while they can't load), and the lobby's pitch shows `components.firstScout`.
