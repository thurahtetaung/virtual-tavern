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
import {
  missedVoteNote,
  pointsBreakdown,
  revealHeadline,
  statusFor,
  targetReached,
} from './status.ts';

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

describe('the reveal', () => {
  it('breaks each line down and names the scoring case', () => {
    const h = startedGame();
    tellAndGive(h);
    const st = storyteller(h);
    const [a, b, c] = othersOf(h) as [string, string, string];
    // a finds it; b and c vote for each other's cards.
    const cardOf = (owner: string) => h.state.turn!.table.findIndex((t) => t.owner === owner);
    h.act({ type: 'vote', index: storyIndex(h) }, a);
    h.act({ type: 'vote', index: cardOf(c) }, b);
    h.act({ type: 'vote', index: cardOf(b) }, c);
    const v = reverie.view(h.state, a);
    expect(revealHeadline(v)).toBe('Some found it: the storyteller and the finders score 3.');
    expect(pointsBreakdown(v, st)).toBe('3 (some found it)');
    expect(pointsBreakdown(v, a)).toBe('3 (found it)');
    expect(pointsBreakdown(v, b)).toBe('1 (vote)');
  });

  it('says a lone finder among missed votes is “some found it”', () => {
    const h = startedGame(FOUR, { guessSeconds: 60, timerMode: 'strict' });
    tellAndGive(h);
    const [a] = othersOf(h) as [string];
    h.act({ type: 'vote', index: storyIndex(h) }, a);
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    const v = reverie.view(h.state, a);
    expect(revealHeadline(v)).toMatch(/^Some found it \(a missed vote counts as not finding it\)/);
    expect(revealHeadline(v)).not.toMatch(/Everyone/);
  });

  it('adds the bonus for an all-or-none turn to the votes', () => {
    const h = startedGame();
    playTurn(h, othersOf(h));
    const v = reverie.view(h.state, null);
    expect(revealHeadline(v)).toMatch(/^Everyone found it/);
    expect(pointsBreakdown(v, storyteller(h))).toBe('0 (everyone or nobody found it)');
    expect(pointsBreakdown(v, othersOf(h)[0]!)).toBe('2 (everyone found it)');
  });

  it('offers See final scores once someone reaches the target', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    playTurn(h, [othersOf(h)[0]!]);
    expect(targetReached(reverie.view(h.state, HOST))).toBe(false);
    h.state = {
      ...h.state,
      seats: { ...h.state.seats, ana: { ...h.state.seats.ana!, score: 15 } },
    };
    const v = reverie.view(h.state, HOST);
    expect(targetReached(v)).toBe(true);
    expect(statusFor(v, true, null).text).toContain('Press See final scores');
  });
});
