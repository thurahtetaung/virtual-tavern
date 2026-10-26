import { type PlayerId, createRng, encodeDrawing, isGameError, pickOne } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import {
  GROUPS,
  HOST,
  NOW,
  auctioning,
  drawAll,
  hammer,
  ids,
  nextLot,
  packContent,
  pastIntro,
  started,
} from './test-utils.ts';
import type { GoingOnceAction, GoingOnceState } from './types.ts';

const OTHER = encodeDrawing([{ c: 2, w: 2, points: [700, 900, 50, 50] }]);
const ALL_TITLES = GROUPS.flatMap((g) => g.titles);

/**
 * The state with everything `viewer` may not know changed: titles, values and drawings of lots
 * not yet sold (except the viewer's own titles and the lot on the easel's picture), the artist of
 * anything unsold, other players' money, wish lists and messages. Their view must not change.
 */
function perturb(state: GoingOnceState, viewer: PlayerId | null): GoingOnceState {
  const s = JSON.parse(JSON.stringify(state)) as GoingOnceState;
  const g = s.game;
  if (!g) return s;
  const over = s.phase === 'over';
  // During a lot's intro its picture isn't up yet: even its strokes are hidden.
  const current =
    g.auction &&
    (g.stage === 'auction' || g.stage === 'sold') &&
    !(g.stage === 'auction' && g.auction.close === 'intro')
      ? g.lots[g.auction.lot]
      : null;
  for (const item of Object.values(g.items)) {
    const own = item.drawer !== null && item.drawer === viewer;
    if (!over && !item.sale && !own) {
      item.title = `Secret ${item.id}`;
      item.value += 7;
    }
    if (!over && !item.sale?.buyer && !own) item.artist = item.artist ? null : 'nobody';
    if (!over && item.id !== current && !own && item.drawing) item.drawing = OTHER;
  }
  for (const id of g.order) {
    if (id === viewer) continue;
    const p = g.players[id]!;
    if (!over) {
      p.cash += 11;
      p.debt += 1500;
      p.loans = 3 - p.loans;
    }
    p.bankCalls = 3 - p.bankCalls;
    p.bids += 5;
    if (!over) p.wish = p.wish.map((w) => ({ ...w, title: 'Nope', value: 1 }));
    p.messages = p.messages.map((m) => ({ ...m, text: 'Hidden', kind: 'filler', value: 99 }));
    p.sent = [];
    p.pending = [];
    p.lastBidAt = 123;
  }
  for (const id of g.order)
    if (id !== viewer && g.contacts)
      g.contacts[id] = g.contacts[id] === 'buyer1' ? 'buyer2' : 'buyer1';
  g.lines = { filler: ['nothing'] };
  g.hostLines = { opening: ['Secret line'] };
  g.spares = null;
  g.lastBidLot = {};
  g.calledOut = { quiet: {}, empty: [] };
  s.seed = 42;
  s.usedGroups = ['x'];
  return s;
}

/** Titles the viewer may see right now. */
function allowedTitles(state: GoingOnceState, viewer: PlayerId | null): Set<string> {
  const g = state.game!;
  if (state.phase === 'over') return new Set(ALL_TITLES);
  const out = new Set<string>();
  for (const item of Object.values(g.items)) if (item.sale) out.add(item.title);
  // The practice lot's title (from a spare group no lot uses) is shown from its Sold step on.
  const p = g.practice;
  if (p && p.step !== 'hint' && p.step !== 'bid') out.add(p.title);
  if (viewer && g.players[viewer]) {
    for (const id of g.prompts[viewer]!) out.add(g.items[id]!.title);
    if (g.stage !== 'draw') for (const w of g.players[viewer].wish) out.add(w.title);
  }
  return out;
}

function checkViews(state: GoingOnceState, where: string, only?: PlayerId | null) {
  const viewers: (PlayerId | null)[] =
    only === undefined ? [...Object.keys(state.seats), null] : [only];
  for (const viewer of viewers) {
    const text = JSON.stringify(goingOnce.view(state, viewer));
    const changed = JSON.stringify(goingOnce.view(perturb(state, viewer), viewer));
    // Compared as text (fast enough for the fuzz); on a mismatch, show the difference.
    if (changed !== text)
      expect(JSON.parse(changed), `${where}: ${viewer}`).toEqual(JSON.parse(text));
    if (!state.game) continue;
    const ok = allowedTitles(state, viewer);
    for (const t of ALL_TITLES)
      if (!ok.has(t))
        expect(text.includes(`"${t}"`), `${where}: ${viewer} sees "${t}"`).toBe(false);
  }
}

describe('view', () => {
  it('hides what each viewer may not see at every stage', () => {
    const h = started(4, 3);
    checkViews(h.state, 'draw');
    const g = h.state.game!;
    h.act('p1', { type: 'draw', item: g.prompts.p1![0]!, drawing: OTHER });
    checkViews(h.state, 'draw, one sent');
    drawAll(h, ['p1']);
    h.act('p1', { type: 'draw', item: g.prompts.p1![1]!, drawing: OTHER });
    for (let guard = 0; guard < 30 && h.state.phase === 'playing'; guard++) {
      if (h.state.game!.auction!.close === 'intro') {
        checkViews(h.state, `lot ${h.state.game!.auction!.lot} intro`);
        pastIntro(h);
      }
      checkViews(h.state, `lot ${h.state.game!.auction!.lot} open`);
      const a = h.state.game!.auction!;
      h.wait(400);
      h.act(h.state.game!.order[a.lot % 4]!, { type: 'bid', amount: 400, seq: a.seq });
      checkViews(h.state, `lot ${a.lot} bid`);
      hammer(h);
      checkViews(h.state, `lot ${a.lot} sold`);
      nextLot(h);
    }
    expect(h.state.phase).toBe('over');
    checkViews(h.state, 'over');
  });

  it('shows the lot’s drawing to all, but its title, value and artist only once sold', () => {
    const h = auctioning(3, 2);
    const g = h.state.game!;
    const item = g.items[g.lots[0]!]!;
    for (const viewer of ['p1', 'p2', 'p3', null]) {
      const v = goingOnce.view(h.state, viewer);
      expect(v.game!.auction!.picture.drawing).toEqual(item.drawing);
      expect(JSON.stringify(v.game!.auction)).not.toContain(item.title);
      expect(v.game!.results).toEqual([]);
    }
  });

  it('reveals who knew what only at the end', () => {
    const h = auctioning(3, 2);
    expect(goingOnce.view(h.state, 'p1').game!.knew).toBeNull();
    while (h.state.phase !== 'over') {
      hammer(h);
      nextLot(h);
    }
    const knew = goingOnce.view(h.state, null).game!.knew!;
    const g = h.state.game!;
    for (const id of g.order) {
      expect(knew.lists[id]).toEqual(
        g.players[id]!.wish.map((w) => ({ title: w.title, value: w.value })),
      );
      for (const w of g.players[id]!.wish) expect(knew.by[w.item]).toContain(id);
    }
  });

  it('keeps each player’s cash to themself until the end', () => {
    const h = auctioning(3, 2);
    const v = goingOnce.view(h.state, 'p1');
    expect(v.mine!.cash).toBe(3000);
    expect(v.game!.final).toBeNull();
    expect(JSON.stringify(v.game)).not.toContain('"cash"');
  });

  it('shows the screw picker only to the screwer', () => {
    const h = auctioning(3, 2);
    const s = structuredClone(h.state);
    s.game!.auction!.lot = s.game!.lots.length - 2;
    h.state = s;
    h.act('p1', { type: 'screw' });
    expect(goingOnce.view(h.state, 'p1').mine!.targets.length).toBe(2);
    expect(goingOnce.view(h.state, 'p2').mine!.targets).toEqual([]);
    checkViews(h.state, 'screwing');
  });
});

describe('fuzz', () => {
  // Random players act from their own views (bids, screws, the bank, hiding), the clock runs in
  // between; every other change one viewer is checked, and every viewer when the stage changes.
  const play = (seed: number) => {
    const n = 3 + (seed % 4);
    const rng = createRng(seed);
    const content = packContent();
    let now = NOW;
    let state = goingOnce.create(
      { now, rng, content },
      ids(n).map((id) => ({ id, name: id.toUpperCase() })),
    );
    const run = (by: string, action: GoingOnceAction) => {
      const r = goingOnce.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
      if (!isGameError(r)) state = r;
    };
    run(HOST, {
      type: 'update-settings',
      pace: (['relaxed', 'normal', 'fast'] as const)[seed % 3],
      practice: seed % 2 === 0,
    });
    run(HOST, { type: 'start' });
    let stage = '';
    for (let step = 0; step < 400 && state.phase === 'playing'; step++) {
      const g = state.game!;
      const key = `${g.stage}:${g.auction?.lot}:${g.auction?.close === 'intro'}:${g.practice?.step}`;
      if (key !== stage) checkViews(state, `seed ${seed} step ${step}`);
      else if (step % 2 === 0)
        checkViews(state, `seed ${seed} step ${step}`, pickOne(rng, [...g.order, null]));
      stage = key;
      const id = pickOne(rng, g.order)!;
      const view = goingOnce.view(state, id);
      const a = view.game!.auction;
      const roll = rng.next();
      if (g.stage === 'draw') {
        const todo = view.mine!.prompts.find((p) => !p.sent);
        if (todo && roll < 0.9) run(id, { type: 'draw', item: todo.item, drawing: OTHER });
      } else if (g.stage === 'practice' && view.game!.practice) {
        const p = view.game!.practice;
        now += 350;
        if (roll < 0.05) run(id, { type: 'skip-practice' });
        else if (roll < 0.4 && p.step === 'bid')
          run(id, { type: 'practice-bid', amount: pickOne(rng, p.steps)!, seq: p.seq });
        if (roll < 0.4) continue;
      } else if (g.stage === 'bank' && roll < 0.6) {
        run(id, { type: 'loan', take: rng.next() < 0.4 });
      } else if (g.stage === 'auction' && a && (roll < 0.3 || view.mine!.targets.length)) {
        now += 350;
        if (view.mine!.targets.length)
          run(id, { type: 'screw-pick', target: pickOne(rng, view.mine!.targets)! });
        else if (roll < 0.04) run(id, { type: 'screw' });
        else if (roll < 0.06) run(id, { type: 'call-bank' });
        else if (roll < 0.07)
          run(HOST, { type: 'hide', item: a.picture.item, hidden: !a.picture.hidden });
        else run(id, { type: 'bid', amount: pickOne(rng, a.steps)!, seq: a.seq });
        continue;
      }
      if (roll < 0.02) state = goingOnce.playerLeft(state, id, now);
      const at = goingOnce.nextDeadline!(state);
      if (at === null) break;
      if (g.stage === 'draw' && roll < 0.9) continue;
      now = Math.max(now + 1, at);
      state = goingOnce.onDeadline!(state, now);
    }
    checkViews(state, `seed ${seed} end`);
    return state;
  };

  it('plays 500 seeded games without a leak, every one to the end', () => {
    let over = 0;
    const games = Number(process.env.GOING_ONCE_FUZZ ?? 500);
    for (let seed = 1; seed <= games; seed++) if (play(seed).phase === 'over') over++;
    expect(over).toBe(games);
  }, 300_000);
});
