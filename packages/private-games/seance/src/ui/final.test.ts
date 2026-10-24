import { describe, expect, it } from 'vitest';
import { seance } from '../logic/game.ts';
import { HOST, startedGame, toFinal } from '../logic/test-utils.ts';
import { castable, toggleChoice } from './Final.tsx';

describe('the final vote: choose, then cast', () => {
  it('a tap chooses a group and a second tap lets it go', () => {
    expect(toggleChoice(null, 1)).toBe(1);
    expect(toggleChoice(1, 2)).toBe(2);
    expect(toggleChoice(2, 2)).toBeNull();
  });

  it('casts only the chosen, real group, and only on the viewer’s turn', () => {
    const h = startedGame(4);
    toFinal(h);
    h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST);
    const g = seance.view(h.state, 'ana').game!;
    expect(g.final!.groups).toHaveLength(3);
    expect(castable(g, true, null)).toBeNull();
    expect(castable(g, true, 2)).toBe(2);
    expect(castable(g, true, 3)).toBeNull();
    expect(castable(g, false, 2)).toBeNull();
  });
});
