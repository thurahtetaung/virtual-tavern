import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import type { CardType } from './cards.ts';
import { enableTestRig, shortFuse } from './game.ts';
import type {
  CardId,
  Game,
  Settings,
  ShortFuseAction,
  ShortFuseState,
  ShortFuseView,
} from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const ids = (n: number) =>
  [HOST, 'ana', 'ben', 'cy', 'dee', 'eve', 'fin', 'gus', 'hal', 'ivy'].slice(0, n);

const content: ContentProvider = { wordLists: () => [], words: () => [] };

enableTestRig();

export interface Harness {
  state: ShortFuseState;
  now: number;
  act(action: ShortFuseAction, by?: string): ShortFuseState;
  reject(action: ShortFuseAction, by?: string): string;
  view(viewer: string | null): ShortFuseView;
  game(): Game;
  /** Moves the clock on. */
  tick(ms: number): void;
  /** Moves the clock to the next deadline and runs it. */
  fire(): void;
  /** Lets the open Nope window run out. */
  settle(): void;
  /** The id of a card of `t` in `who`'s hand (throws if there is none). */
  card(who: string, t: CardType): CardId;
  hand(who: string): CardType[];
  /** Plays cards by type from `who`'s hand and lets the window run out. */
  play(who: string, types: CardType[], extra?: { target?: string; named?: CardType }): void;
}

export function harness(players = ids(3), seed = 7, settings: Partial<Settings> = {}): Harness {
  const rng = createRng(seed);
  const run = (state: ShortFuseState, action: ShortFuseAction, by: string, now: number) =>
    shortFuse.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    now: NOW,
    state: shortFuse.create(
      { now: NOW, rng, content },
      players.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST) {
      const r = run(h.state, action, by, h.now);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    reject(action, by = HOST) {
      const r = run(h.state, action, by, h.now);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return r.code;
    },
    view: (viewer) => shortFuse.view(h.state, viewer),
    game: () => h.state.game!,
    tick(ms) {
      h.now += ms;
    },
    fire() {
      const due = shortFuse.nextDeadline!(h.state);
      if (due === null) throw new Error('no deadline');
      h.now = Math.max(h.now, due);
      h.state = shortFuse.onDeadline!(h.state, h.now);
    },
    settle() {
      if (h.state.stage !== 'window') throw new Error(`no window (stage ${h.state.stage})`);
      h.fire();
    },
    card(who, t) {
      const g = h.game();
      const id = g.hands[who]!.find((c) => g.cards[c]!.t === t);
      if (!id) throw new Error(`${who} has no ${t}: ${h.hand(who).join(', ')}`);
      return id;
    },
    hand: (who) => h.game().hands[who]!.map((c) => h.game().cards[c]!.t),
    play(who, types, extra = {}) {
      const g = h.game();
      const pool = [...g.hands[who]!];
      const cards = types.map((t) => {
        const i = pool.findIndex((c) => g.cards[c]!.t === t);
        if (i < 0) throw new Error(`${who} has no ${t}`);
        return pool.splice(i, 1)[0]!;
      });
      h.act({ type: 'play', cards, ...extra }, who);
      h.settle();
    },
  };
  if (Object.keys(settings).length) h.act({ type: 'update-settings', ...settings });
  return h;
}

/**
 * A started game with fixed hands (by seat; the rest of each hand is left out) and the top of the
 * pile, and the first player (seat index, default 0).
 */
export function rigged(
  hands: CardType[][],
  top: CardType[] = [],
  opts: { players?: string[]; seed?: number; first?: number; settings?: Partial<Settings> } = {},
): Harness {
  const h = harness(opts.players ?? ids(Math.max(2, hands.length)), opts.seed ?? 7, opts.settings);
  h.act({ type: 'rig', hands, top, first: opts.first ?? 0 });
  h.act({ type: 'start' });
  return h;
}

/** Every card id, wherever it is: for conservation checks. */
export function everyCard(g: Game): CardId[] {
  return [
    ...g.pile,
    ...g.discard,
    ...Object.values(g.hands).flat(),
    ...Object.values(g.front).flat(),
    ...g.out,
    ...(g.stash ?? []),
    ...Object.values(g.mine ?? {}).flatMap((m) => (m ? [m.card] : [])),
    ...(g.limbo ? [g.limbo] : []),
    ...(g.toPlace ?? []).map((p) => p.card),
  ];
}

/**
 * The security boundary: for every viewer (each seat, the exploded, a watcher) nothing hidden may
 * appear in their view: other hands' card ids, the pile's ids or order, a drawn card while someone
 * else deals with it, other players' memories, the hidden seed or the truth log.
 */
export function leaks(state: ShortFuseState, viewer: string | null): string[] {
  const g = state.game;
  if (!g) return [];
  const v = shortFuse.view(state, viewer);
  const json = JSON.stringify(v);
  // Every string in the view, so each id check is a lookup rather than a scan.
  const strings = new Set<string>();
  const walk = (x: unknown) => {
    if (typeof x === 'string') strings.add(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(v);
  const has = (id: string) => strings.has(id);
  const found: string[] = [];
  // What someone drew reaches only their own log, even once the game is over.
  for (const e of v.game?.log ?? []) if (e.drew && e.by !== viewer) found.push(`drew ${e.id}`);
  const over = state.phase === 'over';
  if (over) return found;
  // Ghosts keep (and see) their own hand.
  const ghost = (p: string) => (g.ghosts ?? []).includes(p) && !g.left.includes(p);
  for (const p of g.players)
    if (p !== viewer || (g.dead.some((d) => d.id === p) && !ghost(p)) || g.blind?.[p])
      for (const id of g.hands[p]!) if (has(id)) found.push(`hand ${p} ${id}`);
  const altering =
    state.stage === 'alter' && g.alter?.by === viewer
      ? g.alter.cards
      : state.stage === 'dig' && g.dig?.by === viewer
        ? [g.dig.card]
        : [];
  for (const id of g.pile) if (!altering.includes(id) && has(id)) found.push(`pile ${id}`);
  const dealing =
    ((state.stage === 'bomb' || state.stage === 'search') && g.drawn?.by === viewer) ||
    (state.stage === 'target' && g.blindPlay?.by === viewer) ||
    (state.stage === 'place' && g.placing?.by === viewer);
  for (const id of g.stash ?? []) if (has(id)) found.push(`stash ${id}`);
  for (const m of Object.values(g.mine ?? {})) if (m && has(m.card)) found.push(`mine ${m.card}`);
  if (g.limbo && !dealing && has(g.limbo)) found.push(`limbo ${g.limbo}`);
  for (const id of g.out) if (has(id)) found.push(`out ${id}`);
  for (const pl of g.toPlace ?? []) if (has(pl.card)) found.push(`to place ${pl.card}`);
  if (/"seed"|"truth"|"limbo"|"cards":\{/.test(json)) found.push('internals');
  const mine = viewer ? (g.memory[viewer] ?? []).map((m) => m.id) : [];
  for (const m of v.game?.memory ?? []) if (!mine.includes(m.id)) found.push(`memory ${m.id}`);
  if (v.game?.end) found.push('end before over');
  return found;
}
