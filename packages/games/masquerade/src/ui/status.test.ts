import { describe, expect, it } from 'vitest';
import { masquerade } from '../logic/index.ts';
import { FOUR, HOST, allReady, rig, startedGame, votes } from '../logic/test-utils.ts';
import { nudgeFor, statusFor } from './status.ts';

const table = () => rig(startedGame(FOUR), { spies: ['cy'], location: 'gym', starter: 'ana' });

describe('nudges', () => {
  it('warns at 2 minutes, in the last minute and at 30 seconds, then counts votes', () => {
    const h = table();
    const v = masquerade.view(h.state, HOST);
    expect(nudgeFor(v, 200)).toBeNull();
    expect(nudgeFor(v, 120)).toBe('⏳ 2 minutes left');
    expect(nudgeFor(v, 59)).toBe('🤔 Last minute: think about who you’ll vote for');
    expect(nudgeFor(v, 30)).toBe('⏰ 30 seconds left!');
    h.act({ type: 'ready-to-vote', ready: true }, 'ben');
    expect(nudgeFor(masquerade.view(h.state, HOST), 200)).toBe('✋ 1 of 4 ready to vote');
    allReady(h);
    votes(h, { host: 'cy', ana: 'cy' });
    expect(nudgeFor(masquerade.view(h.state, HOST), 40)).toBe('🗳️ 2 of 4 voted');
  });
});

describe('status', () => {
  it('asks for a vote, then (for a caught spy) a guess', () => {
    const h = table();
    expect(statusFor(masquerade.view(h.state, 'cy'), false)).toEqual({
      text: 'You’re the spy! Blend in and work out the location. ANA asks first.',
      yourMove: false,
    });
    allReady(h);
    expect(statusFor(masquerade.view(h.state, 'ben'), false).yourMove).toBe(true);
    votes(h, { host: 'cy', ana: 'cy', ben: 'cy' });
    expect(statusFor(masquerade.view(h.state, 'ben'), false).yourMove).toBe(false);
    votes(h, { cy: 'ben' });
    expect(statusFor(masquerade.view(h.state, 'cy'), false).yourMove).toBe(true);
    expect(statusFor(masquerade.view(h.state, 'ben'), false)).toEqual({
      text: 'CY was caught as the spy and is guessing the location…',
      yourMove: false,
    });
  });
});

describe('status with the room', () => {
  const people = (offline: string[] = []) => ({
    hostId: HOST,
    players: FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: !offline.includes(id) })),
  });

  it('names the host, and a caught spy who is offline', () => {
    const h = table();
    allReady(h);
    votes(h, { host: 'cy', ana: 'cy', ben: 'cy', cy: 'ben' });
    expect(statusFor(masquerade.view(h.state, 'ben'), false, people(['cy'])).text).toBe(
      'CY (offline) was caught as the spy and is guessing the location…',
    );
    h.act({ type: 'spy-guess', location: 'gym' }, 'cy');
    expect(statusFor(masquerade.view(h.state, 'ben'), false, people()).text).toBe(
      'Round over! Waiting for HOST (host) to deal the next round…',
    );
  });

  it('names who watchers are still waiting on to vote', () => {
    const h = table();
    allReady(h);
    votes(h, { host: 'cy', ana: 'cy' });
    const watcherView = {
      ...masquerade.view(h.state, 'ben'),
      round: { ...masquerade.view(h.state, 'ben').round!, role: 'watching' as const },
    };
    expect(statusFor(watcherView, false, people(['cy'])).text).toBe(
      'The table is voting for the spy… Waiting for: CY (offline) and you.',
    );
  });
});
