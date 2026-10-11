import { describe, expect, it } from 'vitest';
import { royalPost } from '../logic/game.ts';
import { HOST, harness, startedGame } from '../logic/test-utils.ts';
import type { RoyalPostState, RoyalPostView } from '../logic/types.ts';
import { statusFor } from './status.ts';

const players = [
  { id: 'h', name: 'Hal', connected: true },
  { id: 'a', name: 'Ana', connected: false },
];
const seats = [
  { id: 'h', name: 'Hal', playing: true, tokens: 0 },
  { id: 'a', name: 'Ana', playing: true, tokens: 0 },
];
const lobby = {
  phase: 'lobby',
  settings: { edition: 'classic', turnSeconds: null, timerMode: 'soft' },
  seats,
  me: seats[1],
  round: null,
  winners: [],
} as unknown as RoyalPostView;

describe('statusFor', () => {
  it('names the host in the lobby', () => {
    expect(statusFor(lobby, { isHost: false, hostId: 'h', players }).text).toBe(
      'All set. Waiting for Hal (host) to start…',
    );
  });

  it('marks an offline player whose turn it is', () => {
    const view = {
      ...lobby,
      phase: 'playing',
      me: seats[0],
      round: { stage: 'play', current: 'a', players: [{ id: 'h' }, { id: 'a' }] },
    } as unknown as RoyalPostView;
    expect(statusFor(view, { isHost: true, hostId: 'h', players }).text).toBe(
      'Ana (offline) is playing…',
    );
  });
});

describe('statusFor at the table', () => {
  const roomOf = (view: RoyalPostView, isHost: boolean) => ({
    isHost,
    hostId: HOST,
    players: view.seats.map((s) => ({ id: s.id, name: s.name, connected: true })),
  });
  const status = (state: RoyalPostState, id: string, isHost = false) => {
    const view = royalPost.view(state, id);
    return statusFor(view, roomOf(view, isHost));
  };

  it('never tells the host everyone is seated while friends are left watching', () => {
    const h = harness(['host', 'a', 'b', 'c', 'd']);
    expect(status(h.state, HOST, true).text).toBe(
      'Ready to start. D is watching. Press Start when your friends are ready!',
    );
    expect(status(h.state, 'd').text).toContain('The table is full');
    h.act({ type: 'update-settings', edition: '2019' });
    expect(status(h.state, HOST, true).text).toBe(
      'Everyone is seated. Press Start when your friends are ready!',
    );
  });

  it('leaves a late joiner’s next-game note to the watching banner, saying it once', () => {
    const h = startedGame();
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    expect(status(h.state, 'dee').text).toMatch(/^Watching: .+ is playing\.$/);
  });
});
