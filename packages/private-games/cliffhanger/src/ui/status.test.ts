import { describe, expect, it } from 'vitest';
import { cliffhanger } from '../logic/definition.ts';
import { HOST, pair, started, winFaceOff } from '../logic/test-utils.ts';
import { statusFor } from './status.ts';

const room = (you: string) => ({ you, hostId: HOST, isHost: you === HOST, players: [] });

describe('the status line', () => {
  it('keeps the face-off loser on their move while the other team’s countdown and turn run', () => {
    const h = started(4);
    const [a, b] = pair(h);
    winFaceOff(h, a);
    h.act(a, { type: 'lock' });
    expect(h.state.round!.stage).toBe('countdown');
    const during = cliffhanger.view(h.state, b);
    expect(during.round!.myHand).toBeTruthy();
    expect(statusFor(during, room(b))).toEqual({
      text: 'Place your 3 films while they describe, then lock in.',
      yourMove: true,
    });
    h.tick();
    expect(h.state.round!.stage).toBe('turn');
    expect(statusFor(cliffhanger.view(h.state, b), room(b)).yourMove).toBe(true);
  });
});
