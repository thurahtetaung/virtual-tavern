import { describe, expect, it } from 'vitest';
import { insights } from './insights.ts';
import { DEFAULT_WEIGHTS } from './tables.ts';
import { table, votes } from './test-utils.ts';
import type { NightfallState } from './types.ts';

const W = 'werewolf';
const V = 'villager';

/** Plays to the reveal, returning the events of the change that revealed the cards. */
function reveal(run: (h: ReturnType<typeof table>) => void, players: Parameters<typeof table>[0]) {
  const h = table(players);
  run(h);
  expect(h.state.stage).toBe('reveal');
  // Only the phase matters to `insights`: the change into the reveal.
  const before: NightfallState = { ...h.state, phase: 'playing', stage: 'vote' };
  return { h, events: insights(before, h.state, null, null) };
}

const byType = (events: ReturnType<typeof insights>, type: string) =>
  events.filter((e) => e.type === type);

describe('insights', () => {
  it('reports nothing before the reveal', () => {
    const h = table({ players: [W, 'seer', V] });
    const before = h.state;
    h.dawn();
    expect(insights(before, h.state, null, null)).toEqual([]);
  });

  it('reports the outcome, how it ended and the night’s moves', () => {
    const { events } = reveal(
      (h) => {
        h.toStep('robber');
        h.night('B', { players: ['A'] });
        h.toStep('troublemaker');
        h.night('C', { players: ['A', 'D'] });
        h.vote(votes('A,C,D>B; B>A'));
      },
      { players: [W, 'robber', 'troublemaker', V] },
    );
    const outcome = byType(events, 'outcome')[0]!;
    expect(outcome.props).toMatchObject({
      players: 4,
      ending: 'werewolf-caught',
      teamsWon: ['village'],
      moves: 4,
      // The Robber's card moved twice: to A in the robbery, then to D.
      chain: 2,
    });
    expect(outcome.winners!.sort()).toEqual(['A', 'C', 'D']);
    expect(outcome.words).toContainEqual({ kind: 'guess', word: W });
    const robber = byType(events, 'player').find((e) => e.playerId === 'B')!;
    expect(robber.props).toMatchObject({
      dealt: 'robber',
      final: W,
      identityCrisis: true,
      cardsMoved: 2,
    });
    const tm = byType(events, 'player').find((e) => e.playerId === 'C')!;
    expect(tm.props).toMatchObject({ votedWolf: true, cardsMoved: 2 });
  });

  it('credits the Seer only when the card she saw stayed put', () => {
    const { events } = reveal(
      (h) => {
        h.toStep('seer');
        h.night('A', { players: ['B'] });
        h.toStep('robber');
        h.night('C', { players: ['B'] });
        h.vote(votes('A,B>C; C>A'));
      },
      { players: ['seer', W, 'robber'] },
    );
    expect(byType(events, 'look')).toEqual([
      { type: 'look', playerId: 'A', props: { role: 'seer', right: false } },
    ]);
  });

  it('spots the fun facts: lone wolf, Tanner’s dream, Hunter’s revenge, Bodyguard save', () => {
    const lone = reveal((h) => h.vote(votes('A>B; B,C>D; D>B')), {
      players: [W, V, V, 'seer'],
    }).events;
    expect(byType(lone, 'player').find((e) => e.playerId === 'A')!.props).toMatchObject({
      loneWolf: true,
    });
    const tanner = reveal((h) => h.vote(votes('A,C,D>B; B>A')), {
      players: [W, 'tanner', 'seer', V],
    }).events;
    expect(byType(tanner, 'outcome')[0]!.props!.ending).toBe('tanner');
    expect(byType(tanner, 'player').find((e) => e.playerId === 'B')!.props).toMatchObject({
      tannerDream: true,
    });
    const hunter = reveal((h) => h.vote(votes('A,C,D>B; B>A; E>C')), {
      players: [W, 'hunter', 'seer', V, V],
    }).events;
    expect(byType(hunter, 'outcome')[0]!.props!.ending).toBe('hunter');
    expect(byType(hunter, 'player').find((e) => e.playerId === 'B')!.props!.hunterShots).toBe(1);
    const guard = reveal((h) => h.vote(votes('A,C,D,E>B; B,F>C')), {
      players: ['bodyguard', W, V, V, V, V],
    }).events;
    expect(byType(guard, 'player').find((e) => e.playerId === 'A')!.props).toMatchObject({
      bodyguardSave: true,
      voted: false,
    });
  });

  it('counts a blindsided vote: swapped to the other side and voted for a new teammate', () => {
    const { events } = reveal(
      (h) => {
        h.toStep('troublemaker');
        h.night('C', { players: ['A', 'B'] });
        h.vote(votes('A>D; B,C,D>A'));
      },
      { players: [V, W, 'troublemaker', W] },
    );
    // A now holds the werewolf and voted for D, a werewolf.
    expect(byType(events, 'player').find((e) => e.playerId === 'A')!.props).toMatchObject({
      identityCrisis: true,
      blindsided: true,
    });
  });

  it('reports the Vampire set: epic battles, broken hearts, the Mark of the Vampire, Disease', () => {
    // A Gremlin moves the Mark of the Vampire; Cupid links the werewolf and C; the Diseased
    // marks F. Everyone but A votes A (4); A votes B, the vampire, who is second (1).
    const { events } = reveal(
      (h) => {
        h.toStep('vampires');
        h.night('B', { players: ['D'] });
        h.toStep('diseased');
        h.night('E', { side: 'left' });
        h.toStep('cupid');
        h.night('C', { players: ['A', 'C'] });
        h.toStep('gremlin');
        h.night('D', { choice: 'marks' });
        h.night('D', { players: ['D', 'F'] });
        h.vote(votes('B,C,D,E>A; A>B; F>A'));
      },
      { players: [W, 'vampire', 'cupid', 'gremlin', 'diseased', V] },
    );
    const outcome = byType(events, 'outcome')[0]!;
    expect(outcome.props).toMatchObject({
      epic: true,
      loveDeaths: 1,
      vampireMark: 'moved',
      ending: 'heartbreak',
    });
    expect([...(outcome.props!.teams as string[])].sort()).toEqual([
      'vampire',
      'village',
      'werewolf',
    ]);
    const player = (id: string) => byType(events, 'player').find((e) => e.playerId === id)!.props!;
    expect(player('A')).toMatchObject({ heartbreaks: 1, vampire: false, mark: 'love' });
    expect(player('B')).toMatchObject({ vampire: true });
    expect(player('F')).toMatchObject({ vampire: true, mark: 'vampire' });
    expect(player('D')).toMatchObject({ vampire: false, mark: 'disease' });
  });

  it('counts the voters lost to a Disease, and an Assassin whose mark died', () => {
    const { events } = reveal(
      (h) => {
        h.toStep('diseased');
        h.night('A', { side: 'left' });
        h.toStep('assassin');
        h.night('C', { players: ['E'] });
        h.vote(votes('A,C>B; D,B>E; E>A'));
      },
      { players: ['diseased', W, 'assassin', V, V] },
    );
    const player = (id: string) => byType(events, 'player').find((e) => e.playerId === id)!.props!;
    // B holds the Mark of Disease (A and C voted for him); A is the Diseased (E voted for her).
    expect(player('B')).toMatchObject({ plague: 2 });
    expect(player('A')).toMatchObject({ plague: 1 });
    // C's mark (E) died, though voting for B cost C the win.
    expect(player('C')).toMatchObject({ hitman: true, won: false });
    expect(byType(events, 'outcome')[0]!.props).toMatchObject({
      epic: false,
      vampireMark: null,
      disqualified: 3,
    });
  });

  it('reports votes received, how players died and the night actions the timer chose', () => {
    const { events } = reveal(
      (h) => {
        // The Seer sleeps through her step, so the timer looks for her.
        h.toStep('seer');
        h.tick();
        h.vote(votes('A>B; B,C,D>A'));
      },
      { players: [W, V, 'seer', V] },
    );
    const player = (id: string) => byType(events, 'player').find((e) => e.playerId === id)!.props!;
    expect(player('A')).toMatchObject({
      votesReceived: 3,
      deathCause: 'vote',
      deathPlace: null,
      converted: null,
    });
    expect(player('B')).toMatchObject({ votesReceived: 1, deathCause: null, autoActions: 0 });
    expect(player('C').autoActions).toBe(1);
  });

  it('reports the Alien set’s facts', () => {
    const zero = (t: Record<string, number>, key: string) =>
      Object.fromEntries(Object.keys(t).map((k) => [k, k === key ? 1 : 0]));
    const { events } = reveal(
      (h) => {
        h.toStep('blob');
        h.state.round!.blob = { left: 1, right: 0 };
        h.vote(votes('B,C,D,E>A; A>B'));
      },
      {
        players: ['alien', 'cow', 'blob', 'nostradamus', 'seer', V],
        settings: {
          weights: {
            alien: zero(DEFAULT_WEIGHTS.alien, 'stare'),
            ripple: zero(DEFAULT_WEIGHTS.ripple, 'one-minute'),
          },
        },
      },
    );
    expect(byType(events, 'outcome')[0]!.props).toMatchObject({
      ending: 'alien-caught',
      aliens: true,
      ripple: 'one-minute',
      timeLoop: false,
      leaderRule: false,
      oracleRule: null,
    });
    const p = (id: string) => byType(events, 'player').find((e) => e.playerId === id)!.props;
    expect(p('A')).toMatchObject({ alien: true, abducted: false });
    expect(p('B')).toMatchObject({ cow: true, cowTipped: true });
    // The Blob (C) and D, its member, both lived.
    expect(p('C')).toMatchObject({ blobSquad: true });
    expect(p('E')).toMatchObject({ alien: false, undertaker: false, synthetic: false });
  });

  it('calls a Leader vote and a time loop', () => {
    const zero = (t: Record<string, number>, key: string) =>
      Object.fromEntries(Object.keys(t).map((k) => [k, k === key ? 1 : 0]));
    const { events } = reveal((h) => h.vote(votes('A,B>C; C,D,E>A')), {
      players: ['alien', 'alien', 'leader', V, 'seer'],
      settings: {
        weights: {
          alien: zero(DEFAULT_WEIGHTS.alien, 'stare'),
          ripple: zero(DEFAULT_WEIGHTS.ripple, 'repeat-night'),
        },
      },
    });
    expect(byType(events, 'outcome')[0]!.props).toMatchObject({
      ending: 'leader-vote',
      leaderRule: true,
      timeLoop: true,
      ripple: 'repeat-night',
    });
  });
});
