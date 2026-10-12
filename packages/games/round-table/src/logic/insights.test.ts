import { describe, expect, it } from 'vitest';
import { HOST, questRound, recording, rigged, voteAll, propose, playAll } from './test-utils.ts';
import type { RoleId } from './types.ts';

const BASE5: RoleId[] = ['merlin', 'servant', 'servant', 'assassin', 'minion'];

describe('insights', () => {
  it('reports nothing while votes and cards are secret', () => {
    const h = rigged(BASE5);
    const log = recording(h);
    h.act({ type: 'pick', player: 'ana' });
    propose(h, ['ana', 'dee']);
    h.act({ type: 'vote', approve: true }, 'ana');
    expect(log.events).toEqual([]);
    voteAll(h, ['ben']);
    expect(log.events.map((e) => e.type)).toEqual(['proposal']);
    h.act({ type: 'play', card: 'fail' }, 'dee');
    expect(log.events).toHaveLength(1);
  });

  it('reports a revealed vote, a quest as counts, and never a card’s owner', () => {
    const h = rigged(BASE5);
    const log = recording(h);
    propose(h, ['ana', 'dee']);
    voteAll(h, ['ben', 'cy']);
    playAll(h, ['dee']);
    expect(log.events[0]).toEqual({
      type: 'proposal',
      playerId: HOST,
      props: {
        round: 1,
        attempt: 1,
        slot: 0,
        size: 2,
        team: ['ana', 'dee'],
        approved: true,
        approves: 3,
        rejects: 2,
        approvers: [HOST, 'ana', 'dee'],
        rejecters: ['ben', 'cy'],
        autoVoters: [],
        auto: false,
      },
    });
    expect(log.events[1]).toEqual({
      type: 'quest',
      props: { round: 1, slot: 0, size: 2, team: ['ana', 'dee'], fails: 1, success: false },
    });
    expect(JSON.stringify(log.events)).not.toMatch(/"dee":"fail"|"card"/);
  });

  it('reports the Lady without her result until the end, then the whole game', () => {
    const roles: RoleId[] = [
      'merlin',
      'percival',
      'servant',
      'servant',
      'servant',
      'assassin',
      'morgana',
      'oberon',
    ];
    const h = rigged(roles, { lady: true });
    const log = recording(h);
    questRound(h, ['ana', 'ben', 'cy']);
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    h.act({ type: 'lady', target: 'fin' }, 'gus');
    expect(log.events.at(-1)).toEqual({
      type: 'lady',
      playerId: 'gus',
      props: { target: 'fin', round: 2 },
    });
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    h.act({ type: 'assassinate', target: 'ana' }, 'eve');
    const types = log.events.map((e) => e.type);
    expect(types.slice(-10)).toEqual([
      'assassination',
      ...Array<string>(8).fill('player'),
      'outcome',
    ]);
    expect(log.events.find((e) => e.type === 'assassination')).toEqual({
      type: 'assassination',
      playerId: 'eve',
      props: { target: 'ana', hit: false, auto: false },
    });
    expect(log.events.find((e) => e.playerId === 'fin' && e.type === 'player')).toEqual({
      type: 'player',
      playerId: 'fin',
      props: { role: 'morgana', side: 'evil', won: false },
    });
    expect(log.events.at(-1)).toMatchObject({
      type: 'outcome',
      winners: [HOST, 'ana', 'ben', 'cy', 'dee'],
      props: {
        winner: 'good',
        reason: 'assassin-missed',
        players: 8,
        merlin: HOST,
        successes: 3,
        failures: 0,
        proposals: 3,
        rejected: 0,
        streak: 0,
        ladyHolders: ['gus'],
        ladyTargets: ['fin'],
        ladyEvil: [1],
      },
    });
  });
});
