import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { setBotMistakes } from './bot.ts';
import { defuse } from './game.ts';
import { ANA, BEN, must, send, table, wait } from './test-utils.ts';

describe('smoke', () => {
  it('a bot defuser plays seeded bombs to the end', () => {
    setBotMistakes(0);
    const outcomes: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const t = table([ANA, BEN], seed, { modules: 11, needy: true, time: 600 });
      must(t, ANA, { type: 'set-defuser', player: BEN });
      must(t, ANA, { type: 'start' });
      wait(t, 9000);
      for (let i = 0; i < 4000 && t.state.stage === 'bomb'; i++) {
        const v = defuse.view(t.state, BEN);
        const move = defuse.bot!(v, { me: BEN, now: t.now, rng: createRng(seed * 31 + i), words: () => [] });
        if (move && move.type !== 'ponder') send(t, BEN, move);
        wait(t, 700);
      }
      outcomes.push(t.state.bomb!.end?.how ?? 'none');
    }
    console.log(outcomes.join(' '));
    expect(outcomes.filter((o) => o !== 'defused')).toEqual([]);
    setBotMistakes(1 / 8);
  });
});
