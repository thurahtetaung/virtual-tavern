import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { publicPlan, stepDef } from '../logic/plan.ts';
import { ROLE_IDS, type RoleId } from '../logic/roles.ts';
import {
  DEFAULT_WEIGHTS,
  type WeightTable,
  pickFor,
  pickRipple,
  TABLE_OF,
} from '../logic/tables.ts';
import { table } from '../logic/test-utils.ts';
import { type Cue, announcementLines, cuesFor, pickLines } from './audio.ts';

// The Alien set out loud: every random instruction and every ripple has narration keys the
// manifest has clips for, every device cues them at the same moment, and the steps a ripple adds
// to the night are cued too. The fixture is shaped like the private manifest's `narration` map,
// with clip names of our own.

const KEYS = `
  alien:action:alien-helper alien:action:all-view alien:action:left alien:action:new-alien
  alien:action:right alien:action:show alien:action:stare alien:action:timer alien:action:view
  alien:close alien:wake
  blob:end:many blob:members:2-each-side blob:members:4-right
  body-snatcher:action:center body-snatcher:action:pretend body-snatcher:action:steal
  body-snatcher:close body-snatcher:end body-snatcher:wake
  cow:close cow:wake
  doppelganger:body-snatcher:close doppelganger:body-snatcher:wake doppelganger:close
  doppelganger:cow:close doppelganger:cow:wake doppelganger:empath:close doppelganger:empath:wake
  doppelganger:exposer:close doppelganger:exposer:wake doppelganger:mortician:close
  doppelganger:mortician:wake doppelganger:nostradamus:announce doppelganger:nostradamus:close
  doppelganger:nostradamus:wake doppelganger:psychic:close doppelganger:psychic:wake
  doppelganger:rascal:close doppelganger:rascal:wake doppelganger:wake
  empath:close empath:prompt:awesome empath:prompt:dontthink empath:prompt:everyoneelse
  empath:prompt:friendliest empath:prompt:funniest empath:prompt:goodlooking empath:prompt:like
  empath:prompt:nicest empath:prompt:sharp empath:prompt:smartest empath:prompt:smells
  empath:prompt:suspicious empath:prompt:think empath:prompt:winner empath:wake
  exposer:action:flip-1 exposer:action:flip-2 exposer:action:flip-3 exposer:close exposer:wake
  fragment:and fragment:any-even-player fragment:any-odd-player fragment:any-player
  fragment:both-neighbors fragment:center fragment:either-neighbor fragment:even-players
  fragment:everyone fragment:left-neighbor fragment:odd-players fragment:or
  fragment:right-neighbor fragment:two-higher fragment:two-left fragment:two-lower
  fragment:two-right fragment:yourself
  groob-zerb:close groob-zerb:wake
  mortician:action:both-cards mortician:action:one-card mortician:action:pretend mortician:close
  mortician:wake
  name:alien name:apprentice-seer name:cupid name:curator name:diseased name:exposer name:gremlin
  name:instigator name:marksman name:pickpocket name:psychic name:rascal name:renfield
  name:revealer name:seer name:the-count name:troublemaker name:village-idiot name:witch
  nostradamus:announce nostradamus:close nostradamus:team:alien nostradamus:team:blob
  nostradamus:team:mortician nostradamus:team:oracle nostradamus:team:synthetic
  nostradamus:team:village nostradamus:wake
  oracle:answer:number:wrong oracle:close oracle:question:alien-exchange
  oracle:question:alien-team oracle:question:center-exchange oracle:question:even-odd
  oracle:question:number oracle:question:ripple oracle:question:vampire-team
  oracle:question:view-center oracle:question:view-player oracle:question:werewolf-team
  oracle:wake
  player:1 player:10 player:11 player:12 player:2 player:3 player:4 player:5 player:6 player:7
  player:8 player:9
  psychic:action:view-1 psychic:action:view-2 psychic:close psychic:wake
  rascal:action:drunk rascal:action:drunk:end rascal:action:idiot rascal:action:robber
  rascal:action:robber:end rascal:action:troublemaker rascal:action:witch rascal:action:witch:end
  rascal:close rascal:wake
  ripple:event:drunk ripple:event:drunk:end ripple:event:face-away ripple:event:i-am-alien
  ripple:event:insomniac ripple:event:no-speak ripple:event:one-minute ripple:event:repeat-night
  ripple:event:repeat-night:observer-end ripple:event:repeat-role ripple:event:reveal
  ripple:event:reveal:end ripple:event:shuffle:1 ripple:event:shuffle:2 ripple:event:shuffle:3
  ripple:event:steal ripple:event:steal:end ripple:event:troublemaker
  ripple:event:troublemaker:end ripple:event:two-hand-vote ripple:event:view-1
  ripple:event:view-2 ripple:event:vote-for-app ripple:event:witch ripple:intro
`
  .trim()
  .split(/\s+/);

const NARRATION: Record<string, string[]> = Object.fromEntries(
  KEYS.map((k, i) => [k, [`audio/clip-${i + 1}.ogg`]]),
);
const missing = (lines: readonly string[]) => lines.filter((l) => !NARRATION[l]?.length);

const only = (t: WeightTable, key: string) => ({
  [t]: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS[t]).map((k) => [k, k === key ? 1 : 0])),
});
const PICK_ROLES = Object.keys(TABLE_OF) as RoleId[];

describe('the Alien set’s narration', () => {
  it('has clips for every outcome of every random instruction', () => {
    for (const role of PICK_ROLES) {
      const t = TABLE_OF[role]!;
      for (const entry of Object.keys(DEFAULT_WEIGHTS[t]))
        for (let seed = 1; seed <= 60; seed++) {
          const pick = pickFor(role, {
            rng: createRng(seed),
            n: 12,
            weights: only(t, entry),
            roles: ROLE_IDS,
          })!;
          const lines = pickLines(pick);
          expect(lines.length, `${role} ${entry}`).toBeGreaterThan(0);
          expect(missing(lines), `${role} ${entry}`).toEqual([]);
        }
    }
    // The Oracle's forced swap is worded like the aliens' own left or right.
    const forced = pickFor('alien', {
      rng: createRng(1),
      n: 5,
      weights: undefined,
      roles: ROLE_IDS,
      oracleExchange: true,
    })!;
    expect(pickLines(forced)).toEqual([expect.stringMatching(/^alien:action:(left|right)$/)]);
  });

  it('has clips for every ripple', () => {
    for (const key of Object.keys(DEFAULT_WEIGHTS.ripple))
      for (let seed = 1; seed <= 40; seed++) {
        const ripple = pickRipple({
          rng: createRng(seed),
          n: 10,
          present: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          weights: only('ripple', key),
          roles: ROLE_IDS,
          guaranteed: false,
        });
        const lines = announcementLines({ kind: 'ripple', ripple });
        if (key !== 'none') expect(lines.length, key).toBeGreaterThan(0);
        expect(missing(lines), key).toEqual([]);
      }
  });
});

/** A full Alien table, every step run out, recording each viewer's cues. */
function alienNight(seed: number, ripple: string) {
  const h = table({
    players: [
      'oracle',
      'alien',
      'cow',
      'synthetic-alien',
      'psychic',
      'rascal',
      'empath',
      'nostradamus',
      'mortician',
      'doppelganger',
      'groob',
      'zerb',
    ],
    center: ['exposer', 'body-snatcher', 'blob'],
    seed,
    settings: { weights: { ...only('ripple', ripple), ...only('psychic', 'view-2') } },
  });
  const steps: { index: number; id: string; cues: Cue[] }[] = [];
  for (let i = 0; i < 200 && h.state.stage === 'night'; i++) {
    const night = h.state.round!.night!;
    const viewers = [...h.ids, null];
    const cues = viewers.map((id) => cuesFor(h.view(id)));
    // Every device hears the same narration, whoever acts.
    for (const c of cues) expect(c).toEqual(cues[0]);
    if (night.index >= 0) {
      const pick = h.view('A').night!.pick;
      const open = cues[0]![0]!;
      expect(missing(open.lines), `step ${night.plan[night.index]}`).toEqual([]);
      if (pick && !stepDef(night.plan[night.index]!).repeat)
        expect(open.lines.join(' ')).toContain(pickLines(pick).join(' '));
      steps.push({ index: night.index, id: night.plan[night.index]!, cues: cues[0]! });
    }
    h.tick();
  }
  expect(h.state.stage).toBe('day');
  return { h, steps };
}

describe('an Alien night out loud', () => {
  it.each([
    [1, 'repeat-night'],
    [2, 'repeat-observer'],
    [3, 'repeat-role'],
    [4, 'shuffle'],
    [5, 'view-2'],
  ])('cues every step and its instruction on every device (seed %i, %s)', (seed, ripple) => {
    const { h, steps } = alienNight(seed, ripple);
    const roles = h.state.settings.roles;
    const before = publicPlan(roles);
    const grown = publicPlan(roles, h.view('A').announcements);
    expect(steps.map((s) => s.id)).toEqual(grown);
    for (const { id, cues } of steps) {
      const def = stepDef(id);
      // A repeat says nothing of its own: the ripple just named it.
      if (def.repeat) continue;
      if (id !== 'blob' && id !== 'ripple') expect(cues[0]!.lines.length, id).toBeGreaterThan(0);
      for (const c of cues) expect(missing(c.lines), id).toEqual([]);
    }
    // The steps the ripple added are cued like the rest.
    if (ripple.startsWith('repeat')) {
      expect(grown.length).toBeGreaterThan(before.length);
      const added = steps.slice(before.length);
      expect(added.length).toBe(grown.length - before.length);
      for (const s of added) expect(s.cues.length, s.id).toBeGreaterThan(0);
    }
  });
});
