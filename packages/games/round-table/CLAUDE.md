# Round Table

Notes for working on this game. The repo-wide rules are in the root `CLAUDE.md`; this file lists only what this game adds. Update this file in the same change as any rule, id or asset change.

## Rules and boundaries

- **Round Table** (`packages/games/round-table`): the hidden-loyalty quest game, released in waves (wave 1: base roles, Percival, Morgana, Mordred, Oberon, the Lady of the Lake, Targeting; later waves add role records and stage hooks). Never write the commercial game's name or any reference site. `roles.ts` is the data registry (loyalty, `sees` knowledge rules, legal quest cards), `setup.ts` the tables, presets, `validateSetup`, the deal and the Assassin designation. `phase` is `lobby`/`playing`/`over` for the stats recorder and `stage` the real step (`reveal`, `propose`, `discuss`: the announced team until the leader calls the vote, `vote`, `quest`, `lady`, `assassinate`). `view()` sends your own role and only what `sees` grants, votes only once all are in, quest cards only as counts (owners are never kept), who the timer voted or played for only as counts until `over`, Lady results only to the checker, and everything at `over`. The Oberon option is the FAQ reading: Merlin doesn't see him and loyalty checks show him Good. Strict timers, the host's Skip and players who leave all use one fallback (Approve, Success, random picks). Its art is our own inline SVG (blue Good, red Evil).

- **UI:** wide screens keep the history in the 320 px rail and give the table the rest: the seats are 128 px cards (name at title size in the display face, badges at body size), as many columns as fit at 11 rem (five or six on a laptop), and the quest track shows its team sizes in the display face.
