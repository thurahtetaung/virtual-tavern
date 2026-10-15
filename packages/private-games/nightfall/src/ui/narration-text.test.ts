import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { type CuePart, introLines, partLines, stepParts } from '../logic/narration.ts';
import { FRAME_LINES, REPEAT, STEPS } from '../logic/plan.ts';
import { ARTIFACTS, NOSTRA_TEAMS, ROLE_IDS, type RoleId } from '../logic/roles.ts';
import {
  DEFAULT_WEIGHTS,
  TABLE_OF,
  type WeightTable,
  blobOptions,
  pickFor,
  pickRipple,
} from '../logic/tables.ts';
import type { Announcement } from '../logic/types.ts';
import { type Manifest, deckFor } from './assets.ts';
import { partText } from './text.ts';

// Every narration key the game can say has words on screen: the lines of every step for every
// selection of cards, every outcome of every random instruction and every announcement. The
// fixture is shaped like the private manifest, with names of our own.

const manifest: Manifest = {
  roles: Object.fromEntries(ROLE_IDS.map((r, i) => [r, { name: `Card ${i + 1}` }])),
};
const deck = deckFor(manifest, (id) => ARTIFACTS[id].summary);
const at = { name: (n: number) => `Guest ${n}` };

const only = (t: WeightTable, key: string) => ({
  [t]: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS[t]).map((k) => [k, k === key ? 1 : 0])),
});

/** Selections that bring out each step's variants (Dream Wolf, Renfield, Marks, the seers…). */
const SELECTIONS: RoleId[][] = [
  [...ROLE_IDS],
  ...ROLE_IDS.map((r) => ROLE_IDS.filter((x) => x !== r)),
  ['beholder', 'seer'],
  ['beholder', 'apprentice-seer'],
  ['werewolf', 'vampire'],
  ['werewolf', 'alien'],
];

function everyPart(): CuePart[] {
  const parts: CuePart[] = [];
  const line = (key: string) => parts.push({ kind: 'line', key });
  Object.values(FRAME_LINES).forEach(line);
  for (const roles of SELECTIONS) {
    introLines(roles).forEach(line);
    for (const step of STEPS)
      for (const loneWolf of [true, false]) {
        const { open, close } = stepParts(step.id, { roles, loneWolf });
        parts.push(...open, ...close);
        const again = stepParts(`${REPEAT}${step.id}`, { roles, loneWolf });
        parts.push(...again.open, ...again.close);
      }
  }
  for (const [role, t] of Object.entries(TABLE_OF) as [RoleId, WeightTable][])
    for (const entry of Object.keys(DEFAULT_WEIGHTS[t]))
      for (let seed = 1; seed <= 40; seed++) {
        const pick = pickFor(role, {
          rng: createRng(seed),
          n: 3 + (seed % 10),
          weights: only(t, entry),
          roles: ROLE_IDS,
          oracleExchange: seed % 7 === 0,
        });
        if (pick) parts.push({ kind: 'pick', pick }, { kind: 'pick', pick, doppel: true });
      }
  const announce = (announcement: Announcement) =>
    parts.push({ kind: 'announcement', announcement });
  for (const key of Object.keys(DEFAULT_WEIGHTS.ripple))
    for (let seed = 1; seed <= 40; seed++) {
      const n = 3 + (seed % 10);
      announce({
        kind: 'ripple',
        ripple: pickRipple({
          rng: createRng(seed),
          n,
          present: Array.from({ length: n }, (_, i) => i + 1),
          weights: only('ripple', key),
          roles: ROLE_IDS,
          guaranteed: false,
        }),
      });
    }
  for (const parity of ['even', 'odd'] as const) announce({ kind: 'oracle-parity', parity });
  for (let number = 1; number <= 12; number++)
    for (const swapped of [true, false]) announce({ kind: 'oracle-view', number, swapped });
  for (const right of [true, false]) announce({ kind: 'oracle-number', right });
  for (const team of NOSTRA_TEAMS)
    for (const doppel of [true, false]) announce({ kind: 'nostradamus', team, doppel });
  for (let players = 3; players <= 12; players++)
    for (const shape of blobOptions(players)) announce({ kind: 'blob', shape });
  return parts;
}

describe('the narration as text', () => {
  const parts = everyPart();
  const keys = new Set(parts.flatMap(partLines));

  it('covers every key the narrator can say', () => {
    expect(keys.size).toBeGreaterThanOrEqual(340);
    // Keys a part says nothing for are never emitted (a "none" ripple is silent).
    for (const part of parts) if (!partLines(part).length) expect(part.kind).toBe('announcement');
  });

  it('has words for every key, awake or asleep', () => {
    const silent = new Set<string>();
    for (const part of parts) {
      if (!partLines(part).length) continue;
      for (const awake of [true, false]) {
        const text = partText(part, deck, { awake, at, roles: ROLE_IDS });
        if (!text.trim())
          for (const key of partLines(part)) silent.add(`${key} (${awake ? 'awake' : 'asleep'})`);
      }
    }
    expect([...silent].sort()).toEqual([]);
  });

  it('never says a player’s own instruction twice to the one it wakes', () => {
    const pick = parts.find((p) => p.kind === 'pick')!;
    expect(partText(pick, deck, { awake: true, at, told: true })).toBe('');
    expect(partText(pick, deck, { awake: false, at })).not.toBe('');
  });

  it('words the narrator’s lines with the manifest’s names', () => {
    const seer = ROLE_IDS.indexOf('seer') + 1;
    const wake: CuePart = { kind: 'line', key: 'seer:wake' };
    expect(partText(wake, deck, { awake: false, at })).toBe(`The Card ${seer} is awake.`);
    expect(partText(wake, deck, { awake: true, at })).toMatch(new RegExp(`^CARD ${seer}, wake up`));
  });
});
