import { describe, expect, it } from 'vitest';
import { reverie } from '../logic/game.ts';
import {
  FOUR,
  HOST,
  NOW,
  hand,
  harness,
  othersOf,
  playTurn,
  startedGame,
  storyIndex,
  storyteller,
  tellAndGive,
} from '../logic/test-utils.ts';
import { missedVoteNote, statusFor } from './status.ts';

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

const statusOf = (h: ReturnType<typeof startedGame>, id: string) =>
  statusFor(reverie.view(h.state, id), id === HOST, null);

describe('statusFor during play', () => {
  it('tells a voter they can still change their vote', () => {
    const h = startedGame();
    tellAndGive(h);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    expect(statusOf(h, 'ana').text).toMatch(/You voted for #\d\..*change your vote/);
  });

  it('tells a late joiner they are watching, not that they voted', () => {
    const h = startedGame();
    h.state = reverie.playerJoined(h.state, { id: 'eve', name: 'Eve' });
    tellAndGive(h);
    const s = statusOf(h, 'eve');
    expect(s.text).toMatch(/^You’re watching this turn\..*take a seat at the reveal/);
    expect(s.text).not.toMatch(/Voted/);
  });

  it('offers a watcher a seat at the reveal', () => {
    const h = startedGame();
    h.state = reverie.playerJoined(h.state, { id: 'eve', name: 'Eve' });
    playTurn(h, ['ana']);
    expect(statusOf(h, 'eve').text).toMatch(/Take a seat/);
  });

  it('announces what a strict timer did', () => {
    const h = startedGame(undefined, { clueSeconds: 30, guessSeconds: 30, timerMode: 'strict' });
    h.state = reverie.onDeadline!(h.state, NOW + 30_000);
    expect(statusOf(h, HOST).text).toMatch(/^⏱ You ran out of time/);
    expect(statusOf(h, 'ben').text).toMatch(/^⏱ HOST ran out of time/);
    const st = h.state.turn!.storyteller;
    h.act({ type: 'tell', card: h.state.seats[st]!.hand[0]!, clue: 'x' }, st);
    h.state = reverie.onDeadline!(h.state, h.state.turn!.deadline!);
    expect(statusOf(h, 'ben').text).toMatch(/cards were played for you, HOST and CY\./);
    h.state = reverie.onDeadline!(h.state, h.state.turn!.deadline!);
    expect(missedVoteNote(reverie.view(h.state, 'cy'))).toBe(
      '⏱ Time ran out before HOST, BEN and you voted.',
    );
  });
});
