import { describe, expect, it } from 'vitest';
import { reverie } from '../logic/game.ts';
import {
  FOUR,
  HOST,
  hand,
  harness,
  othersOf,
  startedGame,
  storyteller,
} from '../logic/test-utils.ts';
import { statusFor } from './status.ts';

const players = (offline: string[] = []) =>
  FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: !offline.includes(id) }));
const room = (you: string, offline: string[] = []) => ({
  you,
  hostId: HOST,
  players: players(offline),
});

describe('statusFor', () => {
  it('names the host in the lobby', () => {
    const h = harness();
    for (const id of FOUR) h.act({ type: 'sit', playing: true }, id);
    expect(statusFor(reverie.view(h.state, 'ana'), false, null, room('ana')).text).toBe(
      'All set. Waiting for HOST (host) to start…',
    );
  });

  it('names who still has to give a card or vote, marking anyone offline', () => {
    const h = startedGame();
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'moon' }, st);
    const [first, ...rest] = othersOf(h);
    h.act({ type: 'give', cards: hand(h, first!).slice(0, h.state.turn!.give) }, first);
    const offline = rest[0]!;
    const text = statusFor(
      reverie.view(h.state, first!),
      false,
      null,
      room(first!, [offline]),
    ).text;
    expect(text).toContain(`${offline.toUpperCase()} (offline)`);
    for (const id of rest) expect(text).toContain(id.toUpperCase());
    expect(text).not.toContain(first!.toUpperCase());
    expect(text).not.toContain(st.toUpperCase());
  });
});
