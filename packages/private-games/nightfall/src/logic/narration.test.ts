import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { cuesFor } from '../ui/audio.ts';
import { nightfall } from './game.ts';
import {
  NARRATION_GAP_MS,
  linesInPlay,
  narratedStepMs,
  nightEstimateMs,
  partLines,
  stepParts,
} from './narration.ts';
import { buildNightPlan, stepDurations, stepFactor } from './plan.ts';
import type { RoleId } from './roles.ts';
import { table } from './test-utils.ts';
import { NIGHT_INTRO_MS } from './types.ts';

// Made-up lengths, as if read from a manifest's clips.
const LENGTHS: Record<string, number> = {
  'night:start': 6000,
  'seer:wake': 3000,
  'seer:close': 2000,
  'robber:wake': 4000,
  'robber:close': 1500,
  'werewolf:wake': 5000,
  'werewolf:lone-wolf': 3000,
  'werewolf:close': 2000,
  'psychic:wake': 2000,
  'psychic:action:view-1': 2500,
  'psychic:action:view-2': 2600,
  'fragment:any-even-player': 1000,
  'fragment:any-odd-player': 1100,
  'psychic:close': 1500,
  'seer:wake@expert': 99_000,
  'cupid:wake': 9000,
};
const W: RoleId = 'werewolf';
const V: RoleId = 'villager';

/** Each step's length as the night ran it, after the intro. */
function stepLengths(h: ReturnType<typeof table>) {
  const out: number[] = [];
  h.tick();
  while (h.state.stage === 'night') {
    const start = h.now;
    expect(h.view('A').night!.start).toBe(start);
    h.tick();
    out.push(h.now - start);
  }
  return out;
}

describe('steps stretched to the narration', () => {
  const roles: RoleId[] = ['seer', 'robber', W, V];
  const said = (keys: string[]) => keys.reduce((sum, k) => sum + (LENGTHS[k] ?? 0), 0);

  it('last their time to act plus all they say, and the intro its opening line', () => {
    const h = table({ players: roles, settings: { stepSeconds: 8 }, lengths: LENGTHS });
    expect(h.state.round!.night!.deadline - h.now).toBe(6000 + NARRATION_GAP_MS);
    const plan = h.state.round!.night!.plan;
    expect(plan).toEqual(['werewolves', 'seer', 'robber']);
    expect(stepLengths(h)).toEqual([
      8000 + said(['werewolf:wake', 'werewolf:lone-wolf', 'werewolf:close']) + NARRATION_GAP_MS,
      8000 + said(['seer:wake', 'seer:close']) + NARRATION_GAP_MS,
      8000 + said(['robber:wake', 'robber:close']) + NARRATION_GAP_MS,
    ]);
  });

  it('keep the plain timing with narration off, or without the lengths', () => {
    for (const h of [
      table({ players: roles, settings: { narration: 'off' }, lengths: LENGTHS }),
      table({ players: roles }),
    ]) {
      expect(h.state.round!.night!.deadline - h.now).toBe(NIGHT_INTRO_MS);
      expect(stepLengths(h)).toEqual(stepDurations(h.state.round!.night!.plan, 12));
    }
  });

  it('last as long whether or not anyone holds the card', () => {
    const run = (players: RoleId[], center: RoleId[]) =>
      stepLengths(table({ players, center, settings: { stepSeconds: 5 }, lengths: LENGTHS }));
    expect(run(['seer', 'robber', W, V], [V, V, 'insomniac'])).toEqual(
      run(['insomniac', V, W, V], ['seer', 'robber', V]),
    );
  });

  it('count the random instruction everyone hears, and the step’s cues end with it', () => {
    const h = table({ players: ['psychic', W, V], settings: { stepSeconds: 8 }, lengths: LENGTHS });
    h.toStep('psychic');
    const v = h.view('C');
    const pick = v.night!.pick!;
    expect(pick.kind).toBe('psychic');
    const open = stepParts('psychic', v.settings, { pick }).open.flatMap(partLines);
    expect(open).toContain('psychic:action:view-1');
    expect(v.night!.deadline - v.night!.start!).toBe(
      8000 + said(open) + LENGTHS['psychic:close']! + NARRATION_GAP_MS,
    );
    // Every device cues the step from the start and deadline it is sent.
    const [openCue, close] = cuesFor(v);
    expect(openCue).toMatchObject({ at: v.night!.start, until: v.night!.deadline });
    expect(close).toMatchObject({ until: v.night!.deadline });
  });

  it('are timed from the lengths the server reads at the deal', () => {
    const content: ContentProvider = {
      wordLists: () => [],
      words: () => [],
      narrationLengths: () => LENGTHS,
    };
    const rng = createRng(3);
    const ids = ['A', 'B', 'C'];
    let s = nightfall.create(
      { now: 0, rng, content },
      ids.map((id) => ({ id, name: id })),
    );
    s = { ...s, settings: { ...s.settings, roles: ['seer', W, V, V, V, 'robber'] } };
    const next = nightfall.reduce(
      s,
      { type: 'start' },
      { by: 'A', isHost: true, now: 0, rng, content },
    );
    if (next instanceof GameError) throw new Error(next.message);
    // Only the lines tonight's roles can say are kept.
    expect(next.round!.lengths).toMatchObject({ 'seer:wake': 3000, 'night:start': 6000 });
    expect(next.round!.lengths).not.toHaveProperty('cupid:wake');
    expect(next.round!.lengths).not.toHaveProperty('seer:wake@expert');
    // Never sent.
    for (const id of [...ids, null])
      expect(JSON.stringify(nightfall.view(next, id))).not.toContain('seer:wake');
  });

  it('keep only the lines a night can say (any role’s, and the shared fragments)', () => {
    const kept = linesInPlay(['seer', W, V], LENGTHS);
    expect(Object.keys(kept).sort()).toEqual(
      [
        'fragment:any-even-player',
        'fragment:any-odd-player',
        'night:start',
        'seer:close',
        'seer:wake',
        'werewolf:close',
        'werewolf:lone-wolf',
        'werewolf:wake',
      ].sort(),
    );
  });

  it('give the lobby an estimate of the night', () => {
    const s = { roles, loneWolf: true, stepSeconds: 8 };
    const plain = stepDurations(buildNightPlan(roles), 8).reduce((a, b) => a + b, 0);
    expect(nightEstimateMs(s, null, 4)).toBe(NIGHT_INTRO_MS + plain);
    expect(nightEstimateMs(s, LENGTHS, 4)).toBe(
      6000 +
        NARRATION_GAP_MS +
        buildNightPlan(roles).reduce((sum, id) => sum + narratedStepMs(id, s, LENGTHS), 0),
    );
    // An instruction drawn at random counts as its average.
    const psychic = { ...s, roles: ['psychic', W, V] as RoleId[] };
    const estimate = nightEstimateMs(psychic, LENGTHS, 3);
    const bare = narratedStepMs('psychic', psychic, LENGTHS);
    const plainWolves = narratedStepMs('werewolves', psychic, LENGTHS);
    const psychicStep = estimate - 6000 - NARRATION_GAP_MS - plainWolves;
    expect(psychicStep).toBeGreaterThan(bare + 3000);
    expect(stepFactor('psychic')).toBe(1);
  });
});
