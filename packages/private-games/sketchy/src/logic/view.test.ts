import { type PlayerId, createRng, encodeDrawing, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { sketchyBot } from './bot.ts';
import { sketchy } from './definition.ts';
import {
  HOST,
  NOW,
  drawAll,
  game,
  harness,
  ids,
  lieAll,
  packContent,
  started,
  truthIndex,
  turn,
  writing,
} from './test-utils.ts';
import type { SketchyState } from './types.ts';

const OTHER = encodeDrawing([{ c: 2, w: 2, points: [700, 900, 50, 50] }]);

/**
 * The state with everything `viewer` may not know changed: other players' prompts and drawings
 * (but the one on the table), the pool and the house titles, the order of drawings to come, other
 * players' lies while they are written, and, until the reveal, who picked and liked what. Their
 * view must not change.
 */
function perturb(state: SketchyState, viewer: PlayerId | null): SketchyState {
  const s = JSON.parse(JSON.stringify(state)) as SketchyState;
  s.seed = (s.seed + 12345) % 0x1_0000_0000;
  const g = s.game;
  if (!g || s.phase !== 'playing') return s;
  const t = g.turn;
  const onTable = g.stage !== 'draw' ? t?.artist : undefined;
  const revealed = g.stage === 'reveal';
  for (const [id, sketch] of Object.entries(g.sketches)) {
    if (id === viewer && g.stage === 'draw') continue;
    if (id === onTable && (revealed || id === viewer)) continue;
    sketch.prompt = { ...sketch.prompt, id: `x-${id}`, text: `secret ${id}`, alternates: ['nope'] };
    if (id !== onTable && !(id === viewer && g.stage === 'draw') && sketch.drawing)
      sketch.drawing = OTHER;
  }
  g.pool = g.pool.map((p, i) => ({ ...p, text: `pool ${i}` }));
  g.decoys = g.decoys.map((d, i) => `decoy ${i}`);
  // The drawings still to come, in another order.
  g.order = [...g.order.slice(0, g.at + 1), ...g.order.slice(g.at + 1).reverse()];
  if (t && !revealed) {
    const decoyKeys = new Set(t.decoys);
    const mine = viewer === null ? undefined : t.lies[viewer];
    if (g.stage === 'write') {
      for (const id of Object.keys(t.lies)) {
        const lie = t.lies[id]!;
        if (id === viewer || lie === mine || decoyKeys.has(lie)) continue;
        t.lies[id] = `hidden lie ${id}`;
      }
    }
    for (const id of Object.keys(t.votes)) {
      if (id === viewer) continue;
      t.votes[id] = (t.votes[id]! + 1) % t.options.length;
    }
    for (const id of Object.keys(t.likes)) if (id !== viewer) t.likes[id] = [];
    for (const o of t.options) {
      if (viewer !== null && o.authors.includes(viewer)) continue;
      o.auto = [];
    }
  }
  return s;
}

const viewers = (state: SketchyState): (PlayerId | null)[] => [null, ...Object.keys(state.seats)];

/** Every viewer's view is unchanged by the secrets they may not know, and names none of them. */
function check(state: SketchyState) {
  for (const v of viewers(state)) {
    const seen = JSON.stringify(sketchy.view(state, v));
    const changed = JSON.stringify(sketchy.view(perturb(state, v), v));
    if (seen !== changed) {
      throw new Error(`view of ${v} leaks at ${state.phase}/${state.game?.stage}`);
    }
    secrets(state, v, seen);
  }
}

/** Strings that must never reach `viewer`'s view at this point. */
function secrets(state: SketchyState, viewer: PlayerId | null, json: string) {
  const g = state.game;
  if (!g || state.phase !== 'playing') return;
  for (const p of g.pool) {
    if (json.includes(`"${p.text}"`)) throw new Error(`pool prompt reached ${viewer}`);
  }
  const t = g.turn;
  for (const [id, sk] of Object.entries(g.sketches)) {
    const shown =
      (id === viewer && g.stage === 'draw') ||
      (t?.artist === id && g.stage !== 'draw' && (g.stage !== 'write' || id === viewer)) ||
      g.history.some((h) => h.artist === id);
    if (!shown && json.includes(`"${sk.prompt.text}"`)) {
      throw new Error(`prompt of ${id} reached ${viewer} at ${g.stage}`);
    }
  }
  if (t && g.stage !== 'reveal' && g.stage !== 'draw') {
    const view = JSON.parse(json) as { game: { turn: { artist: unknown } } };
    if (view.game.turn.artist !== null) throw new Error('artist named before the reveal');
  }
}

describe('view', () => {
  it('sends your own prompt only, while drawing', () => {
    const h = started(4);
    const v = sketchy.view(h.state, 'p2');
    expect(v.game!.myPrompt).toBe(game(h).sketches.p2!.prompt.text);
    expect(JSON.stringify(v)).not.toContain(game(h).sketches.p3!.prompt.text);
    expect(sketchy.view(h.state, null).game!.myPrompt).toBeNull();
    check(h.state);
  });

  it('hides the artist and the real title until the reveal', () => {
    const h = writing(4);
    const artist = turn(h).artist;
    const truth = game(h).sketches[artist]!.prompt.text;
    const writer = turn(h).writers[0]!;
    const v = sketchy.view(h.state, writer);
    expect(v.game!.turn!.artist).toBeNull();
    expect(v.game!.turn!.prompt).toBeNull();
    expect(JSON.stringify(v)).not.toContain(truth);
    expect(sketchy.view(h.state, artist).game!.turn!.prompt).toBe(truth);
    // Nobody named as missing before anyone is in: it would point at the artist.
    expect(v.game!.turn!.missing).toBeNull();
    h.act(writer, { type: 'lie', text: 'first' });
    expect(sketchy.view(h.state, writer).game!.turn!.missing).toHaveLength(2);
    check(h.state);
  });

  it('keeps lies anonymous and votes as counts until the reveal', () => {
    const h = writing(4);
    lieAll(h);
    check(h.state);
    const [a, b] = turn(h).voters;
    h.act(a!, { type: 'vote', option: truthIndex(h) });
    const v = sketchy.view(h.state, b!).game!.turn!;
    expect(
      v.options.every((o) => o.authors === null && o.voters === null && o.truth === null),
    ).toBe(true);
    expect(v.done).toBe(1);
    check(h.state);
    for (const id of turn(h).voters.slice(1)) h.act(id, { type: 'vote', option: truthIndex(h) });
    const r = sketchy.view(h.state, b!).game!.turn!;
    expect(r.artist).toBe(turn(h).artist);
    expect(r.options.find((o) => o.truth)!.voters).toHaveLength(3);
    check(h.state);
  });

  it('shows a hidden drawing as hidden to everyone', () => {
    const h = writing(4);
    h.act(HOST, { type: 'hide', hidden: true });
    for (const v of viewers(h.state)) {
      const t = sketchy.view(h.state, v).game!.turn!;
      expect(t.hidden).toBe(true);
      expect(t.drawing).toBeNull();
    }
  });

  it('leaks nothing in 500 seeded games played by bots', () => {
    let games = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const n = 3 + (seed % 6);
      const rng = createRng(seed);
      const content = packContent();
      const h = harness(n, seed, content);
      h.act(HOST, { type: 'start' });
      check(h.state);
      // Every new stage is checked, and a sample of the moves within one, to keep the run short.
      let lastKey = '';
      const maybeCheck = () => {
        const g = h.state.game;
        const key = `${h.state.phase}/${g?.round}/${g?.at}/${g?.stage}`;
        if (key !== lastKey || rng.next() < 0.05) {
          check(h.state);
          expect(JSON.stringify(h.state).length).toBeLessThan(256_000);
        }
        lastKey = key;
      };
      for (let step = 0; step < 400 && h.state.phase === 'playing'; step++) {
        const g = h.state.game!;
        let moved = false;
        for (const id of ids(n)) {
          if (!h.state.seats[id]) continue;
          const move = sketchyBot(sketchy.view(h.state, id), {
            me: id,
            now: h.now,
            rng,
            words: () => [],
            hints: () => [],
          });
          if (!move) continue;
          // Bots sometimes skip a move, so strict clocks and missing players get exercised.
          if (rng.next() < 0.15) continue;
          const r = sketchy.reduce(h.state, move, {
            by: id,
            isHost: id === HOST,
            now: h.now,
            rng,
            content,
          });
          if (isGameError(r)) continue;
          h.state = r;
          moved = true;
          maybeCheck();
          break;
        }
        if (moved) {
          h.wait(500);
          continue;
        }
        if (g.stage === 'reveal') {
          if (rng.next() < 0.3) h.act(HOST, { type: 'skip-reveal' });
          else h.act(HOST, { type: 'next' });
        } else if (rng.next() < 0.05 && n > 3) {
          const leaver = ids(n).find((id) => id !== HOST && h.state.seats[id]);
          if (leaver) h.state = sketchy.playerLeft(h.state, leaver, h.now);
        } else {
          h.tick();
        }
        maybeCheck();
      }
      expect(h.state.phase).toBe('over');
      games += 1;
    }
    expect(games).toBe(500);
  }, 300_000);
});

describe('view at the end', () => {
  it('shows every finished drawing’s title in the history', () => {
    const h = started(3);
    for (let r = 0; r < 2; r++) {
      drawAll(h);
      while (h.state.phase === 'playing' && game(h).stage !== 'draw') {
        lieAll(h);
        for (const id of turn(h).voters) h.act(id, { type: 'vote', option: truthIndex(h) });
        h.act(HOST, { type: 'next' });
      }
    }
    const v = sketchy.view(h.state, 'p1');
    expect(v.phase).toBe('over');
    expect(v.game!.history).toHaveLength(6);
    expect(NOW).toBeGreaterThan(0);
  });
});
