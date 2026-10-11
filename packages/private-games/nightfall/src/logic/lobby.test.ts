import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { nightfall } from './game.ts';
import { SCENARIOS, recommended } from './presets.ts';
import { table } from './test-utils.ts';
import type { NightfallState } from './types.ts';

const content: ContentProvider = { wordLists: () => [], words: () => [] };
const rng = createRng(1);
const ctx = (by: string, now = 0) => ({ by, isHost: by === 'p0', now, rng, content });
const sorted = (r: readonly string[]) => [...r].sort();

/** The state, or the test fails with the game's refusal. */
function ok(r: NightfallState | GameError): NightfallState {
  if (r instanceof GameError) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function lobby(n: number): NightfallState {
  let s = nightfall.create({ now: 0, rng, content }, []);
  for (let i = 0; i < n; i++) s = nightfall.playerJoined(s, { id: `p${i}`, name: `P${i}` });
  return s;
}

describe('the cards follow the table', () => {
  it('re-fits the recommended cards as players join and leave', () => {
    expect(sorted(lobby(5).settings.roles)).toEqual(sorted(recommended(5)));
    expect(sorted(lobby(7).settings.roles)).toEqual(sorted(recommended(7)));
    const fewer = nightfall.playerLeft(lobby(7), 'p6', 0);
    expect(sorted(fewer.settings.roles)).toEqual(sorted(recommended(6)));
  });

  it('leaves the host’s own cards alone', () => {
    const s = lobby(5);
    const picked = SCENARIOS.find((p) => p.id === 'chaos')!.roles;
    const custom = ok(nightfall.reduce(s, { type: 'update-settings', roles: picked }, ctx('p0')));
    const more = nightfall.playerJoined(custom, { id: 'p9', name: 'Late' });
    expect(more.settings.roles).toEqual(picked);
  });

  it('follows a player who stands up to watch', () => {
    const s = ok(nightfall.reduce(lobby(6), { type: 'sit', playing: false }, ctx('p5')));
    expect(sorted(s.settings.roles)).toEqual(sorted(recommended(5)));
  });

  it('every ready-made setup has a description and a level', () => {
    for (const p of SCENARIOS) {
      expect(p.description.length, p.id).toBeGreaterThan(10);
      expect(['beginner', 'advanced', 'chaos']).toContain(p.level);
    }
  });
});

describe('the host opens the vote early', () => {
  it('only in the day, and only the host', () => {
    const h = table({ players: ['werewolf', 'villager', 'villager'] });
    expect(h.reject({ type: 'start-vote' })).toBe('wrong-phase');
    h.dawn();
    expect(h.reject({ type: 'start-vote' }, 'B')).toBe('not-host');
    h.act({ type: 'start-vote' });
    expect(h.state.stage).toBe('vote');
    // Nobody has voted yet, so the vote waits on everyone.
    expect(h.view('B').waitingOn).toEqual(['A', 'B', 'C']);
  });

  it('names who the night is waiting for before it starts', () => {
    const s = lobby(3);
    const dealt = ok(nightfall.reduce(s, { type: 'start' }, ctx('p0')));
    const one = ok(nightfall.reduce(dealt, { type: 'ready' }, ctx('p1')));
    expect(nightfall.view(one, 'p1').waitingOn).toEqual(['p0', 'p2']);
  });
});
