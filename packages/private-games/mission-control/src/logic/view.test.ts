import { GameError, type Rng, createRng } from '@vt/game-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { missionControlBot } from './bot.ts';
import type { CardId } from './cards.ts';
import { missionControl } from './definition.ts';
import { controls } from './game.ts';
import {
  HOST,
  NOW,
  att,
  dive,
  draftAll,
  harness,
  packContent,
  rig,
  toDraft,
} from './test-utils.ts';
import { DUMMY, type MissionControlAction, type MissionControlState } from './types.ts';

afterEach(() => rig(null));

/**
 * The same state with everything `viewer` may not see changed: the other seats' unplayed cards
 * (not the dummy's face-up row or a signalled card) dealt among them again, the dummy's face-down
 * row, the dealt hands, others' secret predictions, others' passed and received cards.
 */
function scrambled(
  state: MissionControlState,
  viewer: string | null,
  rng: Rng,
): MissionControlState {
  const s = structuredClone(state);
  const a = s.attempt;
  if (!a || a.stage === 'done') return s;
  const mine = new Set(viewer ? controls(a, viewer) : []);
  const visible = new Set<CardId>([
    ...a.signals.filter((x) => !x.played).map((x) => x.card),
    ...(a.dummy?.up.filter((c): c is CardId => c !== null) ?? []),
  ]);
  // Cards known to the viewer stay put; the rest are redistributed among the other seats.
  const seats = a.crew.filter((x) => !mine.has(x));
  const pool: CardId[] = [];
  const keep: Record<string, CardId[]> = {};
  for (const seat of seats) {
    keep[seat] = a.hands[seat]!.filter((c) => visible.has(c));
    pool.push(...a.hands[seat]!.filter((c) => !visible.has(c)));
  }
  const shuffled = rng.shuffle(pool);
  for (const seat of seats) {
    const n = a.hands[seat]!.length - keep[seat]!.length;
    a.hands[seat] = [...keep[seat]!, ...shuffled.splice(0, n)];
  }
  if (a.dummy && !mine.has(DUMMY)) {
    const downs = a.hands[DUMMY]!.filter((c) => !a.dummy!.up.includes(c));
    let i = 0;
    a.dummy.down = a.dummy.down.map((c) => (c === null ? null : (downs[i++] ?? c)));
  }
  for (const seat of Object.keys(a.dealt))
    if (!mine.has(seat)) a.dealt[seat] = rng.shuffle(a.dealt[seat]!);
  for (const t of a.tasks) {
    if (
      t.check.kind === 'predict' &&
      t.check.secret &&
      t.owner &&
      !mine.has(t.owner) &&
      t.prediction !== null
    ) {
      t.prediction = (t.prediction + 1) % 14;
      t.progress = t.progress ? `${t.progress}x` : t.progress;
    }
  }
  for (const seat of Object.keys(a.distress.passes))
    if (!mine.has(seat)) a.distress.passes[seat] = a.distress.passes[seat] === 'p1' ? 'p2' : 'p1';
  for (const seat of Object.keys(a.distress.received))
    if (!mine.has(seat))
      a.distress.received[seat] = a.distress.received[seat] === 'b1' ? 'b2' : 'b1';
  s.seed = (s.seed + 1) >>> 0;
  return s;
}

function expectNoLeak(state: MissionControlState, rng: Rng) {
  const viewers: (string | null)[] = [null, ...Object.keys(state.seats)];
  for (const v of viewers) {
    const seen = JSON.stringify(missionControl.view(state, v));
    const other = JSON.stringify(missionControl.view(scrambled(state, v, rng), v));
    expect(other, `viewer ${v} at ${state.attempt?.stage}`).toBe(seen);
  }
}

describe('view', () => {
  it('shows your own hand only, others as counts, nothing during the briefing', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    const brief = missionControl.view(h.state, 'p1').attempt!;
    expect(brief.hand).toBeNull();
    expect(brief.tasks).toEqual([]);
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    const v = missionControl.view(h.state, 'p2').attempt!;
    expect(v.hand).toHaveLength(att(h).hands.p2!.length);
    expect(v.crew.map((c) => c.cards)).toEqual(
      ['p1', 'p2', 'p3'].map((s) => att(h).hands[s]!.length),
    );
    const json = JSON.stringify([v.hand, v.legal, v.signalable, v.dummy, v.replay]);
    const othersOnly = [...att(h).hands.p1!, ...att(h).hands.p3!];
    for (const c of othersOnly) expect(json).not.toContain(`"${c}"`);
    expect(missionControl.view(h.state, null).attempt!.hand).toBeNull();
  });

  it('a secret prediction reaches only its holder until the end', () => {
    rig({ tasks: ['9'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'dive' });
    const t = att(h).tasks[0]!;
    h.act(t.owner!, { type: 'predict', task: 0, n: 11 });
    const other = ['p1', 'p2', 'p3'].find((p) => p !== t.owner)!;
    expect(missionControl.view(h.state, other).attempt!.tasks[0]!.prediction).toBeNull();
    expect(missionControl.view(h.state, t.owner).attempt!.tasks[0]!.prediction).toBe(11);
  });

  it('the replay (every hand) only at the end', () => {
    rig({ tasks: ['1'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    dive(h);
    expect(missionControl.view(h.state, 'p1').attempt!.replay).toBeNull();
  });

  it('the dummy’s face-down row is only a count', () => {
    const h = harness(2, 4);
    toDraft(h);
    const v = missionControl.view(h.state, 'p1').attempt!;
    expect(v.dummy!.down).toBe(7);
    expect(v.dummy!.up.filter(Boolean)).toHaveLength(7);
  });
});

/** Plays bot attempts one move at a time, checking every viewer after every move. */
function fuzz(players: number, seed: number, attempts: number) {
  const content = packContent();
  const rng = createRng(seed);
  const seats = Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  let now = NOW;
  let state = missionControl.create({ now, rng, content }, seats);
  const missions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0];
  let played = 0;
  let steps = 0;
  let lastStage: string | undefined;
  const apply = (by: string, action: MissionControlAction) => {
    const r = missionControl.reduce(state, action, { by, isHost: by === 'p1', now, rng, content });
    if (r instanceof GameError) {
      const a = state.attempt;
      throw new Error(
        `${by} ${JSON.stringify(action)}: ${r.code} ${JSON.stringify({ sel: a?.mission.selection, draft: a?.draft, tasks: a?.tasks.map((t) => [t.owner, t.check.kind]), crew: a?.crew, captain: a?.captain })}`,
      );
    }
    state = r;
    now += 700;
  };
  while (played < attempts && steps < attempts * 400) {
    steps++;
    if (state.phase === 'lobby') {
      apply('p1', { type: 'choose', mission: missions[(seed + played) % missions.length]! });
      apply('p1', { type: 'start' });
      continue;
    }
    if (state.phase === 'over') {
      played++;
      apply('p1', { type: 'lobby' });
      continue;
    }
    let moved = false;
    for (const s of seats) {
      const move = missionControlBot(missionControl.view(state, s.id), {
        me: s.id,
        now,
        rng: createRng(rng.int(2 ** 32)),
        words: () => [],
      });
      if (!move) continue;
      apply(s.id, move);
      moved = true;
      break;
    }
    if (!moved) {
      const due = missionControl.nextDeadline!(state);
      if (due === null) throw new Error(`stuck at ${state.attempt?.stage}`);
      now = Math.max(now, due);
      state = missionControl.onDeadline!(state, now);
    }
    // Every viewer, at every stage change and every few moves in between.
    const stage = state.attempt?.stage;
    if (stage !== lastStage || steps % 4 === 0) expectNoLeak(state, rng);
    lastStage = stage;
  }
  return played;
}

describe('fuzz: no viewer ever sees what they shouldn’t', () => {
  // 1,000 attempts in all, every table size.
  for (const players of [2, 3, 4, 5]) {
    for (const part of [1, 2]) {
      it(`${players} players, 125 attempts (${part})`, () => {
        expect(fuzz(players, players * 31 + part, 125)).toBe(125);
      }, 120_000);
    }
  }
});
