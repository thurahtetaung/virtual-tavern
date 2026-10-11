import { describe, expect, it } from 'vitest';
import type { NightfallView } from '../logic/types.ts';
import { statusFor } from './status.ts';

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
  waitingOn: [],
} as unknown as NightfallView;
const room = { isHost: false, hostId: 'C', players, you: 'A' };

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
