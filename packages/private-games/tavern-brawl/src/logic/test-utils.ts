import { type ActionCtx, type PlayerId, type Rng, createRng, isGameError } from '@vt/game-sdk';
import { tavernBrawl, setTestRig } from './game.ts';
import type {
  CardId,
  FormKind,
  HeroId,
  Inst,
  TavernBrawlAction,
  TavernBrawlState,
} from './types.ts';

export const NOW = 1_700_000_000_000;
const NO_CONTENT = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: TavernBrawlState;
  rng: Rng;
  now: number;
  /** Applies an action; throws on a refusal. */
  act(by: PlayerId, action: TavernBrawlAction, isHost?: boolean): TavernBrawlState;
  /** Applies an action and returns the refusal code, or null if it was accepted. */
  refuse(by: PlayerId, action: TavernBrawlAction, isHost?: boolean): string | null;
  /** Plays a card from `by`'s hand by card id. */
  play(by: PlayerId, card: CardId): TavernBrawlState;
  /** Answers the open choice. */
  choose(by: PlayerId, pick: string): TavernBrawlState;
  /** The instance of a card in a player's hand / in play. */
  inHand(p: PlayerId, card: CardId): Inst;
  shieldOf(p: PlayerId, card: CardId): Inst;
  /** Advances the clock and fires the deadline if it's due. */
  tick(ms: number): TavernBrawlState;
}

export function harness(state: TavernBrawlState, seed = 7): Harness {
  const h: Harness = {
    state,
    rng: createRng(seed),
    now: NOW,
    act(by, action, isHost = by === 'p1') {
      const ctx: ActionCtx = { now: h.now, rng: h.rng, content: NO_CONTENT, by, isHost };
      const parsed = tavernBrawl.actionSchema.parse(action);
      const next = tavernBrawl.reduce(h.state, parsed, ctx);
      if (isGameError(next)) throw new Error(`${next.code}: ${next.message}`);
      h.state = next;
      return next;
    },
    refuse(by, action, isHost = by === 'p1') {
      const ctx: ActionCtx = { now: h.now, rng: h.rng, content: NO_CONTENT, by, isHost };
      const next = tavernBrawl.reduce(h.state, action, ctx);
      if (isGameError(next)) return next.code;
      h.state = next;
      return null;
    },
    play(by, card) {
      return h.act(by, { type: 'play', card: h.inHand(by, card) });
    },
    choose(by, pick) {
      const c = h.state.game!.choice;
      if (!c) throw new Error('no open choice');
      return h.act(by, { type: 'choose', choice: c.id, pick });
    },
    inHand(p, card) {
      const g = h.state.game!;
      const inst = g.players[p]!.hand.find((i) => g.cards[i]!.card === card);
      if (!inst) throw new Error(`${p} has no ${card} in hand`);
      return inst;
    },
    shieldOf(p, card) {
      const g = h.state.game!;
      const sh = g.players[p]!.shields.find((x) => g.cards[x.id]!.card === card);
      if (!sh) throw new Error(`${p} has no ${card} in play`);
      return sh.id;
    },
    tick(ms) {
      h.now += ms;
      const due = tavernBrawl.nextDeadline!(h.state);
      if (due !== null && due <= h.now) h.state = tavernBrawl.onDeadline!(h.state, h.now);
      return h.state;
    },
  };
  return h;
}

export const ids = (n: number): PlayerId[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** A started game: p1… in seat order with the given heroes, p1 first. */
export function started(
  heroes: HeroId[],
  seed = 7,
  settings?: Partial<TavernBrawlState['settings']>,
): Harness {
  const rng = createRng(seed);
  const players = ids(heroes.length).map((id, i) => ({ id, name: `Player ${i + 1}` }));
  let state = tavernBrawl.create({ now: NOW, rng, content: NO_CONTENT }, players);
  for (const p of players) state = tavernBrawl.playerJoined(state, p);
  const h = harness(state, seed);
  heroes.forEach((hero, i) => h.act(`p${i + 1}`, { type: 'pick-hero', hero }));
  if (settings) h.act('p1', { type: 'update-settings', ...settings });
  setTestRig({ firstSeat: true });
  try {
    h.act('p1', { type: 'start' });
  } finally {
    setTestRig({});
  }
  return h;
}

export interface Arrangement {
  hp?: number;
  hand?: CardId[];
  /** Top first. */
  deck?: CardId[];
  discard?: CardId[];
  shields?: (CardId | [CardId, number])[];
  form?: FormKind;
}

/** Takes one instance of `card` out of wherever it is (deck, hand or discard). */
function pull(state: TavernBrawlState, card: CardId, avoid: Set<Inst>): Inst {
  const g = state.game!;
  for (const p of g.order) {
    const pl = g.players[p]!;
    for (const zone of ['deck', 'hand', 'discard'] as const) {
      const at = pl[zone].findIndex((i) => g.cards[i]!.card === card && !avoid.has(i));
      if (at >= 0) {
        const [inst] = pl[zone].splice(at, 1);
        avoid.add(inst!);
        return inst!;
      }
    }
  }
  throw new Error(`no free copy of ${card}`);
}

/**
 * Rigs a player's zones with exact cards. Listed zones are replaced: the cards that were there go
 * back to their owners' decks (at the bottom), so every instance stays in exactly one place.
 */
export function arrange(h: Harness, p: PlayerId, a: Arrangement) {
  const g = h.state.game!;
  const pl = g.players[p]!;
  const taken = new Set<Inst>();
  const back = (insts: Inst[]) => {
    for (const i of insts) g.players[g.cards[i]!.owner]!.deck.push(i);
  };
  if (a.hand) {
    back(pl.hand);
    pl.hand = [];
    pl.hand = a.hand.map((c) => pull(h.state, c, taken));
  }
  if (a.discard) {
    back(pl.discard);
    pl.discard = [];
    pl.discard = a.discard.map((c) => pull(h.state, c, taken));
  }
  if (a.shields) {
    back(pl.shields.map((s) => s.id));
    pl.shields = a.shields.map((s) => {
      const [card, damage] = typeof s === 'string' ? [s, 0] : s;
      return { id: pull(h.state, card, taken), damage };
    });
  }
  if (a.form) {
    if (pl.form) back([pl.form.id]);
    const card = a.form === 'bear' ? 'druid.06' : 'druid.13';
    pl.form = { kind: a.form, id: pull(h.state, card, taken) };
  }
  if (a.deck) {
    const top = a.deck.map((c) => pull(h.state, c, taken));
    pl.deck = [...top, ...pl.deck];
  }
  if (a.hp !== undefined) pl.hp = a.hp;
}

/** Empties a player's deck and discard (into nowhere: only for draw tests; breaks conservation). */
export function exhaust(h: Harness, p: PlayerId) {
  const pl = h.state.game!.players[p]!;
  pl.deck = [];
  pl.discard = [];
}

/** Every instance is in exactly one place, and each player still owns 28. */
export function checkConservation(state: TavernBrawlState) {
  const g = state.game!;
  const seen = new Map<Inst, string>();
  const put = (i: Inst, where: string) => {
    if (seen.has(i)) throw new Error(`${i} is in ${seen.get(i)} and ${where}`);
    seen.set(i, where);
  };
  for (const p of g.order) {
    const pl = g.players[p]!;
    pl.deck.forEach((i) => put(i, `${p}.deck`));
    pl.hand.forEach((i) => put(i, `${p}.hand`));
    pl.discard.forEach((i) => put(i, `${p}.discard`));
    pl.shields.forEach((s) => put(s.id, `${p}.shields`));
    if (pl.form) put(pl.form.id, `${p}.form`);
  }
  g.turn.played.forEach((i) => put(i, 'played'));
  g.frames.forEach((f) => put(f.id, 'frames'));
  const all = Object.keys(g.cards);
  for (const i of all) if (!seen.has(i)) throw new Error(`${i} (${g.cards[i]!.card}) is nowhere`);
  if (seen.size !== all.length) throw new Error('unknown instance in play');
}

export const cardsIn = (h: Harness, insts: Inst[]) =>
  insts.map((i) => h.state.game!.cards[i]!.card);
