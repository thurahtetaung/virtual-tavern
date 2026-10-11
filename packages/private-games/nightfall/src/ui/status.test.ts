import { describe, expect, it } from 'vitest';
import { roleLabel } from '../logic/roles.ts';
import { table } from '../logic/test-utils.ts';
import type { NightfallView } from '../logic/types.ts';
import { nudgeFor, statusFor, votePower } from './status.ts';
import { teamOutcome } from './text.ts';

const players = [
  { id: 'A', name: 'Ana', connected: true },
  { id: 'B', name: 'Ben', connected: false },
  { id: 'C', name: 'Cy', connected: true },
];
const base = {
  settings: { roles: [] },
  seats: players.map((p) => ({ id: p.id, name: p.name, playing: true })),
  me: { id: 'A', name: 'Ana', playing: true },
  myRole: 'villager',
  notes: [],
  waitingOn: [],
} as unknown as NightfallView;
const room = { isHost: false, hostId: 'C', players, you: 'A' };
/** A room around the test table's players A, B and C, with the given ones offline. */
const roomOf = (isHost: boolean, offline: string[] = []) => ({
  isHost,
  hostId: 'A',
  you: 'A',
  players: ['A', 'B', 'C'].map((id) => ({ id, name: id, connected: !offline.includes(id) })),
});

describe('statusFor', () => {
  it('names who the vote waits on, offline marked', () => {
    const view = {
      ...base,
      phase: 'vote',
      table: [],
      vote: { myVote: 'C', votedCount: 1, deadline: null },
      waitingOn: ['B', 'C'],
    } as unknown as NightfallView;
    expect(statusFor(view, room).text).toBe(
      'You voted for Cy. Tap someone else to change. Waiting for: Ben (offline) and Cy.',
    );
  });

  it('names who is not ready yet', () => {
    const view = {
      ...base,
      phase: 'ready',
      table: [],
      meReady: true,
      waitingOn: ['B'],
    } as unknown as NightfallView;
    expect(statusFor(view, room).text).toBe(
      'You’re ready. The night starts when everyone is. Waiting for: Ben (offline).',
    );
  });
});

const W = 'werewolf';
const V = 'villager';

describe('the vote, for a Bodyguard', () => {
  it('tells a dealt Bodyguard their pick protects, unless the card moved', () => {
    const h = table({ players: ['bodyguard', W, V] });
    h.dawn();
    h.tick();
    const v = h.view('A');
    expect(votePower(v)).toBe('protect-if-kept');
    expect(statusFor(v, roomOf(false)).text).toMatch(/^Your vote PROTECTS/);
    expect(statusFor(h.view('B'), roomOf(false)).text).toMatch(
      /^Vote! Tap the player you want to die/,
    );
  });

  it('follows an artifact that made you the Bodyguard, or made you something else', () => {
    const base = table({ players: [W, V, V] }).view('B');
    const withArtifact = (artifact: 'sword-of-the-bodyguard' | 'claw-of-the-werewolf') =>
      ({
        ...base,
        myRole: artifact === 'claw-of-the-werewolf' ? 'bodyguard' : 'villager',
        notes: [{ id: 1, step: -1, kind: 'artifact', artifact }],
      }) as NightfallView;
    expect(votePower(withArtifact('sword-of-the-bodyguard'))).toBe('protect');
    expect(votePower(withArtifact('claw-of-the-werewolf'))).toBe('vote');
  });
});

describe('waiting', () => {
  it('names who the day is waiting for, and marks them offline', () => {
    const h = table({ players: [W, V, V] });
    h.dawn();
    h.act({ type: 'ready-to-vote', ready: true }, 'A');
    const v = h.view('A');
    expect(v.waitingOn).toEqual(['B', 'C']);
    expect(statusFor(v, roomOf(false, ['C'])).text).toContain('Waiting for: B and C (offline)');
  });

  it('tells a watcher at night they are watching, not to close their eyes', () => {
    const h = table({ players: [W, V, V] });
    expect(statusFor(h.view(null), roomOf(false)).text).toMatch(/^You’re watching/);
    expect(statusFor(h.view('B'), roomOf(false)).text).toMatch(/eyes closed/i);
  });

  it('tells guests the host is picking the cards', () => {
    const h = table({ players: [W, V, V] });
    const lobby = {
      ...h.view('B'),
      phase: 'lobby',
      settings: { ...h.view('B').settings, roles: [W] },
    } as NightfallView;
    expect(statusFor(lobby, roomOf(false)).text).toMatch(/^The host is picking the cards/);
    expect(statusFor(lobby, roomOf(true)).text).toMatch(/^Almost ready/);
  });
});

const dayView = (daySeconds: number) =>
  ({
    phase: 'day',
    settings: { daySeconds },
    table: [{ left: false }, { left: false }, { left: false }],
    day: { readyCount: 0 },
  }) as unknown as NightfallView;

describe('nudgeFor', () => {
  it('says "2 minutes left" briefly as a longer day passes 2:00', () => {
    const v = dayView(300);
    expect(nudgeFor(v, 150)).toBeNull();
    expect(nudgeFor(v, 120)).toBe('⏳ 2 minutes left');
    expect(nudgeFor(v, 106)).toBe('⏳ 2 minutes left');
    expect(nudgeFor(v, 90)).toBeNull();
    expect(nudgeFor(v, 61)).toBeNull();
    expect(nudgeFor(v, 60)).toMatch(/Last minute/);
  });

  it('never says "2 minutes left" when the whole day is two minutes', () => {
    const v = dayView(120);
    expect(nudgeFor(v, 120)).toBeNull();
    expect(nudgeFor(v, 110)).toBeNull();
  });
});

describe('labels', () => {
  it('agrees the verb with the team', () => {
    expect(teamOutcome('village', true)).toBe('Village wins');
    expect(teamOutcome('werewolf', true)).toBe('Werewolves win');
    expect(teamOutcome('tanner', false)).toBe('Tanner loses');
    expect(teamOutcome('vampire', false)).toBe('Vampires lose');
  });

  it('title-cases role ids like the cards', () => {
    expect(roleLabel('alpha-wolf')).toBe('Alpha Wolf');
    expect(roleLabel('doppelganger')).toBe('Doppelgänger');
    expect(roleLabel('claw-of-the-werewolf')).toBe('Claw of the Werewolf');
    expect(roleLabel('the-master')).toBe('The Master');
  });
});
