import { describe, expect, it } from 'vitest';
import { starlight } from '../logic/game.ts';
import { FOUR, fromFirst, markAll, round, startedGame } from '../logic/test-utils.ts';
import { showLine, statusFor } from './status.ts';

const room = (you: string) => ({
  you,
  hostId: 'host',
  isHost: you === 'host',
  players: FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: true })),
});

describe('status line', () => {
  it('tells each player what to do through a round', () => {
    const h = startedGame();
    const [a, b, c, d] = fromFirst(h) as [string, string, string, string];
    const text = (id: string) => statusFor(starlight.view(h.state, id), room(id), null);
    expect(text(a)).toMatchObject({ yourMove: true });
    expect(text(a).text).toContain(round(h).word);
    h.act({ type: 'mark', positions: [1] }, a);
    h.act({ type: 'lock' }, a);
    expect(text(a)).toMatchObject({ yourMove: false });
    expect(text(a).text).toContain('Waiting for: ');
    markAll(h, { [b]: [1], [c]: [2], [d]: [3] });
    expect(text(a)).toMatchObject({ yourMove: true });
    expect(text(a).text).toContain('Scout');
    expect(text(b).text).toContain(`${a.toUpperCase()} is the Scout`);
    h.act({ type: 'show', pos: 1 }, a);
    const v = starlight.view(h.state, c);
    expect(showLine(v, v.round!.shown[0]!, c)).toBe(
      `🌟 Super-Spark! Only ${b.toUpperCase()} marked it too: 3 stars each.`,
    );
  });

  it('names the winners at the end', () => {
    const h = startedGame();
    for (let no = 1; no <= 4; no++) {
      const order = fromFirst(h);
      markAll(h, Object.fromEntries(order.map((id) => [id, [0]])));
      h.act({ type: 'show', pos: 0 }, order[0]);
      h.act({ type: 'next-round' });
    }
    expect(statusFor(starlight.view(h.state, 'ana'), room('ana'), null).text).toMatch(
      /^You share the win with .* with 8 points!$/,
    );
  });
});
