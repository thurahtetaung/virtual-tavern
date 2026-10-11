import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildNightPlan, STEPS, stepDef, stepFactor } from './plan.ts';
import { ROLES, ROLE_IDS, type RoleId } from './roles.ts';
import { type Harness, table, votes, winners } from './test-utils.ts';
import type { NightfallView } from './types.ts';

const W = 'werewolf';
const V = 'villager';

describe('wake order', () => {
  it('matches the narrator’s order for every first-wave step', () => {
    expect(STEPS.map((s) => s.code)).toEqual([
      '-7',
      '0B',
      '2',
      '2B',
      '2C',
      '3',
      '3B',
      '-3-Ba',
      '4',
      '4B',
      '5',
      '5B',
      '5C',
      '6',
      '6B',
      '7',
      '7B',
      '7C',
      '7Ca',
      '8',
      '9',
      '9a',
      '9C',
      '9Ca',
      '9Z',
      '9Za',
      '10',
      '10a',
      '11',
      '11a',
    ]);
  });

  it('calls only selected roles, and re-wakes the Doppelgänger only when she is in', () => {
    expect(buildNightPlan([W, W, 'seer', 'robber', 'troublemaker', V])).toEqual([
      'werewolves',
      'seer',
      'robber',
      'troublemaker',
    ]);
    expect(buildNightPlan(['doppelganger', W, 'insomniac', 'dream-wolf'])).toEqual([
      'doppelganger',
      'werewolves',
      'insomniac',
      'doppelganger-insomniac',
    ]);
    // The Apprentice Tanner wakes only with a Tanner selected; the Beholder only with a seer.
    expect(buildNightPlan(['apprentice-tanner', 'beholder', V])).toEqual([]);
    expect(buildNightPlan(['apprentice-tanner', 'tanner', 'beholder', 'apprentice-seer'])).toEqual([
      'apprentice-tanner',
      'apprentice-seer',
      'beholder',
    ]);
    // Roles without a night action never get a step.
    for (const r of [
      'villager',
      'tanner',
      'hunter',
      'bodyguard',
      'prince',
      'cursed',
      'dream-wolf',
    ] as RoleId[])
      expect(buildNightPlan([r])).toEqual([]);
  });

  it('gives complex roles double time', () => {
    expect(stepFactor('doppelganger')).toBe(2);
    expect(stepFactor('paranormal-investigator')).toBe(2);
    expect(stepFactor('village-idiot')).toBe(2);
    expect(stepFactor('seer')).toBe(1);
    expect(stepFactor('doppelganger-insomniac')).toBe(1);
  });
});

describe('role steps', () => {
  it('the Seer looks at one player or two centre cards, never both', () => {
    const h = table({ players: ['seer', W, V], center: ['robber', 'drunk', V] });
    h.toStep('seer');
    expect(h.nightReject('A', { players: ['B'], center: [0] })).toBe('bad-pick');
    expect(h.nightReject('A', { center: [0] })).toBe('bad-count');
    expect(h.nightReject('A', { players: ['A'] })).toBe('bad-target');
    h.night('A', { center: [0, 1] });
    expect(h.state.round!.notes.A!.map((n) => n.kind === 'saw' && n.role)).toEqual([
      'robber',
      'drunk',
    ]);
    expect(h.nightReject('A', { players: ['B'] })).toBe('done');
  });

  it('the Mystic Wolf wakes with the werewolves, then looks at a player', () => {
    const h = table({ players: ['mystic-wolf', W, V, 'seer'] });
    h.toStep('werewolves');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'group', players: ['A', 'B'] });
    h.toStep('mystic-wolf');
    h.night('A', { players: ['D'] });
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'saw', role: 'seer' });
  });

  it('the Minion and Squire see every werewolf thumb, the Dream Wolf included', () => {
    const h = table({ players: ['minion', W, 'dream-wolf', 'squire', V] });
    h.toStep('minion');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ players: ['B', 'C'] });
    h.toStep('squire');
    h.night('D', { players: ['B', 'C'] });
    expect(h.state.round!.notes.D!.filter((n) => n.kind === 'saw').length).toBe(2);
  });

  it('the Masons see each other', () => {
    const h = table({ players: ['mason', 'mason', W] });
    h.toStep('mason');
    expect(h.state.round!.notes.B!.at(-1)).toMatchObject({ kind: 'group', players: ['A', 'B'] });
  });

  it('the Thing’s tap reaches its neighbour at daybreak, not before', () => {
    const h = table({ players: ['thing', V, W, V] });
    h.toStep('thing');
    h.night('A', { side: 'left' });
    expect(h.view('B').notes).toEqual([]);
    h.dawn();
    expect(h.view('B').notes).toMatchObject([{ kind: 'was-tapped', side: 'right' }]);
  });

  it('the Apprentice Seer looks at one centre card', () => {
    const h = table({ players: ['apprentice-seer', W, V], center: [V, 'tanner', V] });
    h.toStep('apprentice-seer');
    h.night('A', { center: [1] });
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ role: 'tanner' });
  });

  it('the P.I. may look twice when the first card is village', () => {
    const h = table({ players: ['paranormal-investigator', V, 'seer', W] });
    h.toStep('paranormal-investigator');
    h.night('A', { players: ['B'] });
    expect(h.nightReject('A', { players: ['B'] })).toBe('bad-target');
    h.night('A', { players: ['C'] });
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    expect(h.state.round!.cards.A!.became).toBeNull();
  });

  it('a Witch who looks must swap, and time running out swaps at random', () => {
    const h = table({ players: ['witch', V, W], center: ['tanner', V, V] });
    h.toStep('witch');
    h.night('A', { center: [0] });
    expect(h.view('A').night!.acting!.prompt).toMatchObject({ stage: 'swap', mandatory: true });
    expect(h.nightReject('A', { pass: true })).toBe('mandatory');
    h.tick();
    const roles = ['A', 'B', 'C'].map((x) => h.role(x));
    expect(roles).toContain('tanner');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'witched', auto: true });
  });

  it('a Drunk who doesn’t choose takes a random centre card', () => {
    const h = table({
      players: ['drunk', W, V],
      center: ['seer', 'seer', 'seer'].map(
        (_, i) => (['tanner', 'mason', 'minion'] as RoleId[])[i]!,
      ),
    });
    h.toStep('drunk');
    h.tick();
    expect(['tanner', 'mason', 'minion']).toContain(h.role('A'));
  });

  it('optional actions are skipped when time runs out', () => {
    const h = table({ players: ['robber', W, V] });
    h.toStep('robber');
    h.tick();
    expect(h.role('A')).toBe('robber');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'passed', auto: true });
  });

  it('the Insomniac sees her card unless it is shielded', () => {
    const h = table({ players: ['insomniac', 'robber', W] });
    h.toStep('robber');
    h.night('B', { players: ['A'] });
    h.toStep('insomniac');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'saw-own', role: 'robber' });
  });

  it('the Revealer shows a village card to everyone at daybreak', () => {
    const h = table({ players: ['revealer', 'seer', W] });
    h.toStep('revealer');
    h.night('A', { players: ['B'] });
    h.dawn();
    expect(h.view('C').day!.faceUp).toEqual([{ player: 'B', role: 'seer' }]);
  });

  it('the Curator’s artifact is seen only by whoever holds it at daybreak', () => {
    const h = table({ players: ['curator', V, W], settings: { artifacts: ['mask-of-muting'] } });
    h.toStep('curator');
    h.night('A', { players: ['B'] });
    h.dawn();
    expect(h.view('B').notes.at(-1)).toMatchObject({
      kind: 'artifact',
      artifact: 'mask-of-muting',
    });
    const { settings: _s, ...others } = h.view('C');
    expect(JSON.stringify(others)).not.toContain('"mask-of-muting"');
    expect(h.view('C').day!.artifacts).toEqual(['B']);
  });

  it('the Sentinel can’t shield herself, and the shield shows at daybreak', () => {
    const h = table({ players: ['sentinel', V, W] });
    h.toStep('sentinel');
    expect(h.nightReject('A', { players: ['A'] })).toBe('bad-target');
    h.night('A', { players: ['C'] });
    h.dawn();
    expect(h.view('B').day!.shields).toEqual(['C']);
  });

  it('actions are tied to their step: a late tap is refused', () => {
    const h = table({ players: ['seer', 'robber', W] });
    h.toStep('seer');
    const step = h.state.round!.night!.index;
    h.tick();
    expect(h.reject({ type: 'night', step, players: ['C'] }, 'A')).toBe('stale');
    expect(h.reject({ type: 'night', step: step + 1, players: ['C'] }, 'A')).toBe('not-your-step');
  });
});

describe('the Doppelgänger copies every first-wave role', () => {
  const immediate = ROLE_IDS.filter((r) => ROLES[r].doppel === 'immediate');
  const later = ROLE_IDS.filter((r) => ROLES[r].doppel === 'later');
  const passive = ROLE_IDS.filter((r) => ROLES[r].doppel === 'none' && r !== 'doppelganger');

  /** A table where the Doppelgänger (A) copies `role` from B; enough roles for every step. */
  const copying = (role: RoleId) => {
    const extra: RoleId[] =
      role === 'apprentice-tanner' ? ['tanner'] : role === 'beholder' ? ['seer'] : [];
    const h = table({
      players: ['doppelganger', role, W, V, ...extra],
      center: [V, V, 'mason'],
      ...(role === 'alpha-wolf' ? { wolf: W } : {}),
    });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    return h;
  };

  it.each(immediate)('%s: acts straight away in her own step', (role) => {
    const h = copying(role);
    expect(h.state.round!.cards.A!.copied).toBe(role);
    const acting = h.view('A').night!.acting!;
    expect(acting.as).toBe(role);
    expect(acting.prompt?.as).toBe(role);
    // …and never wakes for it again.
    if (buildNightPlan(h.state.settings.roles).includes(role)) {
      h.toStep(role === 'werewolf' ? 'werewolves' : role);
      expect(h.state.round!.night!.actors).not.toContain('A');
    }
  });

  it.each(later)('%s: wakes again right after the original', (role) => {
    const h = copying(role);
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    h.toStep(role);
    expect(h.state.round!.night!.actors).toEqual(['B']);
    h.toStep(`doppelganger-${role}`);
    expect(h.state.round!.night!.actors).toEqual(['A']);
  });

  it.each(['werewolf', 'mason'] as RoleId[])('%s: wakes with the group', (role) => {
    const h = copying(role);
    h.toStep(role === 'werewolf' ? 'werewolves' : role);
    expect(h.state.round!.night!.actors).toContain('A');
    expect(h.state.round!.night!.actors).toContain('B');
  });

  it('minion: sees the werewolves at the end of her step', () => {
    const h = copying('minion');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'thumbs', players: ['C'] });
  });

  it.each(passive)('%s: has nothing to do at night, and wins as the copy', (role) => {
    const h = copying(role);
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    h.dawn();
    if (role === 'dream-wolf') return;
    h.vote(votes('B,C,D>A; A>B'));
    expect(h.state.round!.result!.identities.A!.role).toBe(role);
  });

  it('a Dream Wolf copy shows a thumb to the werewolves', () => {
    const h = copying('dream-wolf');
    h.toStep('werewolves');
    expect(h.state.round!.notes.C!.at(-1)).toMatchObject({ thumbs: ['A', 'B'] });
  });

  it('a Doppelgänger card that never woke is a plain Villager', () => {
    const h = table({ players: ['drunk', W, V], center: ['doppelganger', V, V] });
    h.toStep('drunk');
    h.night('A', { center: [0] });
    h.vote(votes('A,C>B; B>A'));
    expect(h.state.round!.result!.identities.A!.role).toBe('villager');
    expect(winners(h)).toBe('AC');
  });

  it('a copy made at random still acts on a mandatory role', () => {
    const h = table({ players: ['doppelganger', 'drunk', W, V] });
    h.toStep('doppelganger');
    h.tick();
    expect(h.state.round!.players.A!.night).not.toBe('doppelganger');
    expect(h.state.round!.notes.A![0]).toMatchObject({ kind: 'copied', auto: true });
  });
});

// ---- The security boundary ----

const EVERY_ROLE = ROLE_IDS.map((r) => `"${r}"`);

/** A view's JSON without the parts that may legitimately name roles. */
function publicPart(v: NightfallView) {
  const { settings: _s, notes: _n, myRole: _m, ...rest } = v;
  if (rest.night) rest.night = { ...rest.night, acting: null };
  return JSON.stringify(rest);
}

/** A full table, with random choices in every step, recording every view along the way. */
function playRandomNight(seed: number) {
  const h = table({
    players: [
      'doppelganger',
      W,
      'seer',
      'robber',
      'troublemaker',
      'insomniac',
      'sentinel',
      'witch',
      'curator',
      'thing',
    ],
    center: ['drunk', 'mystic-wolf', 'minion'],
    seed,
  });
  const rng = createRng(seed);
  const views: { step: number; acting: Set<string>; views: Record<string, NightfallView> }[] = [];
  const snap = () => {
    const night = h.state.round!.night!;
    views.push({
      step: night.index,
      acting: new Set(night.actors),
      views: Object.fromEntries(
        [...h.ids, 'watcher'].map((id) => [id, h.view(id === 'watcher' ? null : id)]),
      ),
    });
  };
  while (h.state.stage === 'night') {
    snap();
    for (const p of h.state.round!.night!.actors) {
      for (let i = 0; i < 3; i++) {
        const pr = h.view(p).night?.acting?.prompt;
        if (!pr) break;
        const pick = pr.sides
          ? { side: rng.int(2) ? ('left' as const) : ('right' as const) }
          : pr.players && (!pr.center || rng.int(2))
            ? { players: rng.shuffle(pr.players.ids).slice(0, pr.players.min) }
            : pr.center
              ? { center: rng.shuffle(pr.center.slots).slice(0, pr.center.min) }
              : { pass: true as const };
        h.night(p, pick);
        snap();
      }
    }
    h.tick();
  }
  return { h, views };
}

describe('what each player is sent at night', () => {
  it.each([1, 2, 3])('names no card but your own at any step (seed %i)', (seed) => {
    const { h, views } = playRandomNight(seed);
    for (const { views: byViewer } of views) {
      for (const [id, v] of Object.entries(byViewer)) {
        const json = publicPart(v);
        for (const role of EVERY_ROLE) expect(json, `${id} sees ${role}`).not.toContain(role);
        for (const key of ['"cards"', '"center"', '"timeline"', '"seed"', '"work"', '"dealt"'])
          expect(json).not.toContain(key);
        // Notes are the viewer's own.
        const own = new Set((h.state.round!.notes[id] ?? []).map((n) => n.id));
        for (const n of v.notes) expect(own.has(n.id)).toBe(true);
      }
    }
  });

  it.each([1, 2, 3])(
    'is identical for everyone not acting, but for the step clock (seed %i)',
    (seed) => {
      const { h, views } = playRandomNight(seed);
      const strip = (v: NightfallView) =>
        JSON.stringify({ ...v, night: { ...v.night!, index: 0, deadline: 0 } });
      for (const id of [...h.ids, 'watcher']) {
        let last: string | null = null;
        for (const { acting, views: byViewer } of views) {
          if (acting.has(id)) {
            last = null;
            continue;
          }
          const now = strip(byViewer[id]!);
          expect(byViewer[id]!.night!.acting).toBeNull();
          if (last !== null) expect(now).toBe(last);
          last = now;
        }
      }
    },
  );

  it('runs every step for its full length, whether or not anyone holds the card', () => {
    const durations = (players: RoleId[], center: RoleId[]) => {
      const h = table({ players, center, settings: { stepSeconds: 10 } });
      const out: [string, number][] = [];
      while (h.state.stage === 'night') {
        const start = h.now;
        // Act fast where possible: the step still lasts its full time.
        for (const p of h.state.round!.night!.actors) {
          const pr = h.view(p).night!.acting?.prompt;
          if (pr && !pr.mandatory) h.night(p, { pass: true });
        }
        h.tick();
        out.push([String(h.state.round!.night?.index ?? 'day'), h.now - start]);
      }
      return out;
    };
    const held = durations(['seer', 'robber', 'doppelganger', W], ['insomniac', V, 'troublemaker']);
    const centred = durations(
      ['insomniac', V, 'troublemaker', W],
      ['seer', 'robber', 'doppelganger'],
    );
    expect(centred).toEqual(held);
    const plan = buildNightPlan([
      'seer',
      'robber',
      'doppelganger',
      W,
      'insomniac',
      V,
      'troublemaker',
    ]);
    expect(held.slice(1).map(([, ms]) => ms)).toEqual(plan.map((id) => stepFactor(id) * 10_000));
    expect(stepDef(plan[0]!).role).toBe('doppelganger');
  });

  it('keeps the night’s timeline for the reveal only', () => {
    const { h } = playRandomNight(4);
    h.vote(Object.fromEntries(h.ids.map((id, i) => [id, h.ids[(i + 1) % h.ids.length]!])));
    const reveal = h.view('B').reveal!;
    expect(reveal.timeline.length).toBeGreaterThanOrEqual(reveal.plan.length);
    for (let i = 0; i < reveal.plan.length; i++)
      expect(reveal.timeline.some((t) => t.step === i)).toBe(true);
  });
});

describe('a whole game', () => {
  it('runs lobby → ready → night → day → vote → reveal → again', () => {
    const h: Harness = table({ players: [W, 'seer', V], center: ['robber', V, 'drunk'] });
    expect(h.state.stage).toBe('night');
    h.dawn();
    expect(h.state.stage).toBe('day');
    h.tick();
    expect(h.state.stage).toBe('vote');
    expect(h.reject({ type: 'vote', target: 'A' }, 'A')).toBe('self-vote');
    h.act({ type: 'vote', target: 'B' }, 'A');
    expect(h.view('B').vote).toMatchObject({ votedCount: 1, myVote: null });
    h.tick();
    expect(h.state.stage).toBe('reveal');
    h.act({ type: 'play-again' });
    expect(h.state.stage).toBe('ready');
    for (const p of h.ids) h.act({ type: 'ready' }, p);
    expect(h.state.stage).toBe('night');
    expect(h.state.round!.number).toBe(2);
  });
});
