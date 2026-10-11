import { describe, expect, it } from 'vitest';
import { royalPost } from '../logic/game.ts';
import { HOST, harness, startedGame } from '../logic/test-utils.ts';
import { statusFor } from './status.ts';

describe('statusFor', () => {
  it('never tells the host everyone is seated while friends are left watching', () => {
    const h = harness(['host', 'a', 'b', 'c', 'd']);
    expect(statusFor(royalPost.view(h.state, HOST), true).text).toBe(
      'Ready to start. D is watching. Press Start when your friends are ready!',
    );
    expect(statusFor(royalPost.view(h.state, 'd'), false).text).toContain('The table is full');
    h.act({ type: 'update-settings', edition: '2019' });
    expect(statusFor(royalPost.view(h.state, HOST), true).text).toBe(
      'Everyone is seated. Press Start when your friends are ready!',
    );
  });

  it('names the host in guests’ waiting lines', () => {
    const h = harness();
    expect(statusFor(royalPost.view(h.state, 'ana'), false, 'Hana').text).toBe(
      'All set. Waiting for Hana to start…',
    );
  });

  it('tells a late joiner they are dealt in at the next game', () => {
    const h = startedGame();
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    expect(statusFor(royalPost.view(h.state, 'dee'), false).text).toContain(
      'You’re dealt in at the next game.',
    );
  });
});
