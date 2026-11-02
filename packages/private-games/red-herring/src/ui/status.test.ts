import { describe, expect, it } from 'vitest';
import { redHerring } from '../logic/game.ts';
import { SIX, game, playAll, playFirst, round, setWord, startedGame } from '../logic/test-utils.ts';
import { statusFor } from './status.ts';

const name = (id: string | null | undefined) => (id ? id.toUpperCase() : 'Someone');
const line = (h: ReturnType<typeof startedGame>, id: string) =>
  statusFor(redHerring.view(h.state, id), id, name);

describe('the status line', () => {
  it('reads the same for the Conspirator and a Detective at every step', () => {
    const h = startedGame(SIX, 5);
    setWord(h, 'Fog');
    const r = round(h);
    const c = r.conspirator!;
    const d = r.order.slice(1).find((id) => id !== c)!;
    const same = () => {
      if (round(h).turn === c || round(h).turn === d) return;
      // Only "You're next" depends on the seat, never on the role.
      const plain = (id: string) => line(h, id).text.replace(' You’re next.', '');
      expect(plain(c)).toBe(plain(d));
    };
    same();
    while (round(h).stage === 'play') {
      playFirst(h);
      same();
    }
    expect(game(h).round.stage).toBe('explain');
  });

  it('tells the word-picker and the player on turn what to do', () => {
    const h = startedGame(SIX, 5);
    const picker = round(h).picker;
    expect(line(h, picker)).toMatchObject({ yourMove: true });
    expect(line(h, picker).text).toMatch(/first play a card/);
    setWord(h, 'Fog');
    const next = round(h).turn!;
    expect(line(h, next)).toMatchObject({ yourMove: true, text: /play your first card/ });
    playAll(h);
    expect(line(h, picker).text).toMatch(/Your turn to explain/);
  });
});
