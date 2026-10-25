import { fitSummary, summaryFits } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import { stampede } from '../logic/game.ts';
import { PLACEHOLDER_NAMES } from '../logic/names.ts';
import { HOST, answerAll, playRound, started } from '../logic/test-utils.ts';
import { settingsSummary } from './Lobby.tsx';
import { statusFor } from './status.ts';

const room = (you: string, host = HOST) => ({
  you,
  hostId: host,
  isHost: you === host,
  players: ['p1', 'p2', 'p3', 'p4'].map((id) => ({ id, name: id.toUpperCase(), connected: true })),
});

describe('Stampede UI text', () => {
  it('fits a busy guests’ summary in two lines, counting what doesn’t fit', () => {
    const h = started(4, {
      settings: {
        holderPicks: true,
        sharedWin: true,
        skip: false,
        answerSeconds: 90,
        timerMode: 'strict',
      },
    });
    const parts = settingsSummary(stampede.view(h.state, 'p2'), PLACEHOLDER_NAMES);
    expect(parts[0]).toBe('first to 8 cows');
    for (const width of [360, 390]) {
      const shown = fitSummary(parts, (t) => summaryFits(t, 'Settings', width));
      expect(shown).toBeGreaterThanOrEqual(2);
    }
  });

  it('tells each player what to do at every step', () => {
    const h = started(4);
    const status = (id: string) =>
      statusFor(stampede.view(h.state, id), room(id), PLACEHOLDER_NAMES, 'Stampede');
    expect(status('p2').yourMove).toBe(true);
    expect(status('p2').text).toMatch(/most people/);
    answerAll(h, ['a', 'a', 'b']);
    expect(status('p1').text).toMatch(/^Answer in! Waiting for: P4/);
    h.act('p4', { type: 'answer', text: 'c' });
    expect(status('p2').text).toMatch(/You’re in the herd/);
    expect(status('p3').text).toMatch(/Waiting for P1 \(host\) to ask the next question/);
  });

  it('names the winner once the game ends', () => {
    const h = started(3, { settings: { target: 5 } });
    for (let i = 0; i < 4; i++) {
      playRound(h, ['x', 'x', 'y']);
      h.act(HOST, { type: 'next-round' });
    }
    playRound(h, ['x', 'y', 'x']);
    const at = (id: string) =>
      statusFor(stampede.view(h.state, id), room(id), PLACEHOLDER_NAMES, 'Stampede').text;
    expect(at('p1')).toBe('🏆 You win! Your herd is complete.');
    expect(at('p2')).toBe('🏆 P1 wins!');
  });
});
