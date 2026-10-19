import { type BotCtx, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { starlight } from './game.ts';
import { starlightBot } from './bot.ts';
import { content, fromFirst, harness, markAll, round, startedGame } from './test-utils.ts';
import type { StarlightState } from './types.ts';

/** The only fields a round view has: anything new must be checked here first. */
const ROUND_KEYS = [
  'no',
  'first',
  'players',
  'gone',
  'board',
  'fresh',
  'word',
  'choices',
  'side',
  'stage',
  'myMarks',
  'locked',
  'counts',
  'dark',
  'scout',
  'shown',
  'fallen',
  'left',
  'stars',
  'results',
  'deadline',
  'autoLocked',
].sort();

/** What a viewer's view gives away that it shouldn't; empty when it keeps every secret. */
function leaks(state: StarlightState, viewer: string | null): string[] {
  const view = starlight.view(state, viewer);
  const json = JSON.stringify(view);
  const found: string[] = [];
  for (const key of ['"pile"', '"words"', '"seed"', '"marks"', '"departed"'])
    if (json.includes(key)) found.push(`field ${key}`);
  for (const card of state.words)
    for (const w of card) if (json.includes(JSON.stringify(w))) found.push(`a later word ${w}`);
  const r = state.round;
  if (!r) return found;
  const v = view.round!;
  if (JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(ROUND_KEYS))
    found.push('round keys');
  // The word card: both words only to the First Scout while they choose; after, only the one played.
  const [top, bottom] = r.card;
  if (r.stage === 'word') {
    if (
      viewer !== r.first &&
      (json.includes(JSON.stringify(top)) || (bottom && json.includes(JSON.stringify(bottom))))
    )
      found.push('the word card before it was chosen');
  } else if (bottom && json.includes(JSON.stringify(r.side === 0 ? bottom : top))) {
    found.push('the word not played');
  }
  // Crosses: your own, and who marked a card only once it is shown.
  if (JSON.stringify(v.myMarks) !== JSON.stringify(viewer ? (r.marks[viewer] ?? []) : []))
    found.push('own marks');
  for (const s of v.shown) {
    const truth = r.players.filter((id) => r.marks[id]?.includes(s.pos));
    if ([...s.markers].sort().join() !== truth.sort().join()) found.push('shown markers');
  }
  if (v.shown.length !== r.shown.length) found.push('shown cards');
  if ((r.stage === 'word' || r.stage === 'mark') && (v.counts !== null || v.left !== null))
    found.push('counts before the Announce');
  return found;
}

const viewers = (state: StarlightState) => [null, ...Object.keys(state.seats), 'stranger'];

describe('view() is the boundary', () => {
  it('shows each player only their own crosses, at every stage of a played round', () => {
    const h = startedGame(['host', 'ana', 'ben', 'cy', 'dee'], 5, content);
    const check = () => {
      for (const v of viewers(h.state)) expect(leaks(h.state, v), `${v}`).toEqual([]);
    };
    check();
    if (round(h).stage === 'word') h.act({ type: 'choose-word', side: 1 }, round(h).first);
    check();
    const [a, b, c, d, e] = fromFirst(h);
    h.act({ type: 'mark', positions: [0, 7, 9] }, a);
    check();
    const view = starlight.view(h.state, b!);
    expect(JSON.stringify(view)).not.toContain('[0,7,9]');
    markAll(h, { [a!]: [0, 7, 9], [b!]: [0, 3], [c!]: [3, 4], [d!]: [5], [e!]: [0] });
    check();
    // Only once a card is shown does anyone learn who marked it.
    expect(starlight.view(h.state, b!).round!.shown).toEqual([]);
    h.act({ type: 'show', pos: 0 }, a);
    check();
    expect(starlight.view(h.state, c!).round!.shown[0]!.markers).toEqual([a, b, e]);
  });

  it('never leaks in 500 seeded bot games, for every viewer at every step', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const rng = createRng(seed);
      const n = 3 + (seed % 4);
      const ids = ['host', 'p1', 'p2', 'p3', 'p4', 'p5'].slice(0, n);
      const h = harness(ids, seed, content);
      if (seed % 7 === 0) h.act({ type: 'update-settings', clueSeconds: 30, timerMode: 'strict' });
      h.act({ type: 'start' });
      let steps = 0;
      while (h.state.phase === 'playing' && steps++ < 400) {
        for (const v of viewers(h.state)) {
          const found = leaks(h.state, v);
          if (found.length) throw new Error(`seed ${seed} viewer ${v}: ${found.join(', ')}`);
        }
        const r = round(h);
        if (r.stage === 'done') {
          h.act({ type: 'next-round' });
          continue;
        }
        // A leaver now and then.
        if (seed % 11 === 0 && steps === 6 && Object.keys(h.state.seats).length > 3) {
          h.state = starlight.playerLeft(h.state, ids.at(-1)!, 1_000_000);
          continue;
        }
        if (seed % 7 === 0 && r.stage === 'mark' && rng.next() < 0.3) {
          h.state = starlight.onDeadline!(h.state, r.deadline ?? 0);
          continue;
        }
        let moved = false;
        for (const id of r.players) {
          const ctx: BotCtx = { me: id, now: 0, rng, words: () => [] };
          const action = starlightBot(starlight.view(h.state, id), ctx);
          if (action) {
            h.act(action, id);
            moved = true;
            break;
          }
        }
        if (!moved) throw new Error(`seed ${seed}: stuck at ${r.stage}`);
      }
      expect(h.state.phase, `seed ${seed}`).toBe('over');
    }
  }, 120_000);
});
