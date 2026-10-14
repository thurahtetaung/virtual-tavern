import { GameError, type PlayerId, type Rng } from '@vt/game-sdk';
import { TOP_POWER, cardDef } from './cards.ts';
import {
  type CardDef,
  type CardId,
  type Choice,
  type ChoiceKind,
  type Effect,
  type EndReason,
  type Flavour,
  type Frame,
  type Game,
  HAND_START,
  HP_MAX,
  type Hit,
  type Inst,
  type LastingKind,
  MAX_LOG,
  type NewLog,
  SOCIAL_SECONDS,
  type ShieldInPlay,
  type Step,
  type Tally,
  type TavernBrawlState,
} from './types.ts';

/**
 * The rules engine. Every function here works on a draft (a deep copy the reducer made), so it
 * mutates freely; nothing outside `game.ts` sees a half-finished state.
 */

export interface Env {
  now: number;
  rng: Rng;
}

type S = TavernBrawlState;

export const gameOf = (s: S): Game => s.game!;

export function log(s: S, entry: NewLog) {
  s.seq += 1;
  const full = { ...entry, id: s.seq, turn: s.game?.turn.number ?? 0 };
  s.log.push(full);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

export const emptyTally = (): Tally => ({
  dealt: 0,
  healed: 0,
  absorbed: 0,
  biggestHit: 0,
  longestChain: 0,
  stolen: 0,
  howls: 0,
  plays: 0,
});

function tally(g: Game, p: PlayerId): Tally {
  g.tally[p] ??= emptyTally();
  return g.tally[p];
}

export const defOf = (g: Game, inst: Inst): CardDef => cardDef(g.cards[inst]!.card);
export const ownerOf = (g: Game, inst: Inst): PlayerId => g.cards[inst]!.owner;

/** A ghost's attack and a broken trigger shield's strikes resolve like little cards. */
const VIRTUAL: Record<'ghost' | 'bones', CardDef> = {
  ghost: {
    id: 'ghost',
    hero: 'brute',
    count: 0,
    steps: [{ k: 'atk', n: 1 }],
    shield: 0,
    attack: false,
    effect: null,
    form: null,
  },
  bones: {
    id: 'bones',
    hero: 'slime',
    count: 0,
    steps: [
      { k: 'atk', n: 1 },
      { k: 'atk', n: 1 },
    ],
    shield: 0,
    attack: false,
    effect: null,
    form: null,
  },
};

/** What a frame resolves as: its card, the card a mirror copies, or a virtual attack. */
const frameDef = (g: Game, f: Frame): CardDef =>
  f.virtual ? VIRTUAL[f.virtual] : f.copy ? cardDef(f.copy) : defOf(g, f.id);

/** The card a frame names (the broken shield for its strikes, nothing for a ghost). */
const frameCard = (g: Game, f: Frame): CardId | null =>
  f.virtual ? (f.card ?? null) : (g.cards[f.id]?.card ?? null);

// ---- Who can be touched ----

export const living = (g: Game): PlayerId[] => g.order.filter((p) => !g.players[p]!.out);

export const opponents = (g: Game, by: PlayerId): PlayerId[] => living(g).filter((p) => p !== by);

export const hasLasting = (g: Game, kind: LastingKind, p: PlayerId) =>
  g.lasting.some((l) => l.kind === kind && l.player === p);

export const disguised = (g: Game, p: PlayerId) => hasLasting(g, 'disguise', p);

/** Whether a card played by `by` can affect `p`: a disguise only shields from opponents. */
export const affects = (g: Game, by: PlayerId, p: PlayerId) => p === by || !disguised(g, p);

/** Living opponents the player's cards can reach. */
export const reachable = (g: Game, by: PlayerId): PlayerId[] =>
  opponents(g, by).filter((p) => affects(g, by, p));

/** Living players from `by` round the table in seat order (`by` first). */
export function fromSeat(g: Game, by: PlayerId): PlayerId[] {
  const at = g.order.indexOf(by);
  const round = [...g.order.slice(at), ...g.order.slice(0, at)];
  return round.filter((p) => !g.players[p]!.out);
}

/** Living players from `by` going right (the previous seats), `by` first. */
export function toRight(g: Game, by: PlayerId): PlayerId[] {
  const [first, ...rest] = fromSeat(g, by);
  return first === undefined ? [] : [first, ...rest.reverse()];
}

/** The nearest living players on `p`'s left and right (knocked-out seats are skipped). */
export function neighbours(
  g: Game,
  p: PlayerId,
): { left: PlayerId | null; right: PlayerId | null } {
  const round = fromSeat(g, p).filter((q) => q !== p);
  return { left: round[0] ?? null, right: round.at(-1) ?? null };
}

/** Who steers `by`'s attack cards (the latest controller who isn't `by`), if anyone. */
function controllerOf(g: Game, by: PlayerId): PlayerId | null {
  const c = g.lasting.findLast((l) => l.kind === 'control');
  return c && c.player !== by && !g.players[c.player]!.out ? c.player : null;
}

// ---- Shields ----

/** A shield's printed points (a mirror's are its copy's). */
export const pointsOf = (g: Game, sh: ShieldInPlay) =>
  cardDef(sh.copyOf ?? g.cards[sh.id]!.card).shield;

/** The card a shield in play acts as. */
const shieldCard = (g: Game, sh: ShieldInPlay): CardId => sh.copyOf ?? g.cards[sh.id]!.card;

export function holderOf(g: Game, inst: Inst): PlayerId | null {
  for (const p of g.order) if (g.players[p]!.shields.some((sh) => sh.id === inst)) return p;
  return null;
}

function shieldIn(g: Game, inst: Inst): ShieldInPlay | null {
  for (const p of g.order) {
    const sh = g.players[p]!.shields.find((x) => x.id === inst);
    if (sh) return sh;
  }
  return null;
}

const remaining = (g: Game, p: PlayerId) =>
  g.players[p]!.shields.reduce((n, sh) => n + pointsOf(g, sh) - sh.damage, 0);

/** Whether the attacker's choice of shield changes anything for `amount` damage at `p`. */
export const orderMatters = (g: Game, p: PlayerId, amount: number) =>
  g.players[p]!.shields.length >= 2 && amount > 0 && amount < remaining(g, p);

/** Every shield in front of a player the card can touch. */
const shieldsTouched = (g: Game, by: PlayerId) =>
  g.order.filter((p) => affects(g, by, p)).flatMap((p) => g.players[p]!.shields.map((sh) => sh.id));

// ---- Cards moving ----

export function toDiscard(g: Game, inst: Inst) {
  g.players[ownerOf(g, inst)]!.discard.push(inst);
  g.turn.fresh.push(inst);
}

/** The top of a player's deck, reshuffling their discard pile first when the deck is empty. */
export function takeTop(s: S, env: Env, p: PlayerId): Inst | null {
  const g = gameOf(s);
  const pl = g.players[p]!;
  if (pl.deck.length === 0) {
    if (pl.discard.length === 0) return null;
    pl.deck = env.rng.shuffle(pl.discard);
    pl.discard = [];
    log(s, { kind: 'reshuffle', player: p });
  }
  return pl.deck.shift() ?? null;
}

export function draw(s: S, env: Env, p: PlayerId, n: number, refill = false): number {
  const g = gameOf(s);
  let drew = 0;
  for (let i = 0; i < n; i++) {
    const inst = takeTop(s, env, p);
    if (inst === null) break;
    g.players[p]!.hand.push(inst);
    drew += 1;
  }
  if (drew > 0 || refill)
    log(s, { kind: 'draw', player: p, count: drew, ...(refill && { refill }) });
  return drew;
}

/** Breaks a shield; a trigger shield then strikes back once the card in play has resolved. */
export function destroyShield(s: S, inst: Inst, by: PlayerId) {
  const g = gameOf(s);
  const holder = holderOf(g, inst);
  if (holder === null) return;
  const pl = g.players[holder]!;
  const sh = pl.shields.find((x) => x.id === inst)!;
  const card = shieldCard(g, sh);
  pl.shields = pl.shields.filter((x) => x.id !== inst);
  toDiscard(g, inst);
  log(s, { kind: 'destroy', by, holder, shield: inst, card, owner: ownerOf(g, inst) });
  if (cardDef(card).effect === 'bonesOnDestroy') (g.bones ??= []).push({ holder, card });
}

function heal(s: S, p: PlayerId, n: number) {
  const g = gameOf(s);
  const pl = g.players[p]!;
  const amount = Math.max(0, Math.min(n, HP_MAX - pl.hp));
  pl.hp += amount;
  tally(g, p).healed += amount;
  log(s, { kind: 'heal', player: p, amount });
}

// ---- Choices ----

type ChoiceExtra = Pick<
  Choice,
  'amount' | 'target' | 'tag' | 'fallback' | 'flavour' | 'attacker' | 'card'
>;

/**
 * Opens a question. Social prompts and anything asked of someone other than the player whose
 * turn it is get a fixed 20 seconds, whatever the room's timer.
 */
export function openChoice(
  s: S,
  env: Env,
  kind: ChoiceKind,
  chooser: PlayerId,
  options: string[],
  source: Inst,
  extra: ChoiceExtra = {},
) {
  s.seq += 1;
  const g = gameOf(s);
  const fixed = kind === 'social' || chooser !== g.turn.player;
  g.choice = {
    id: s.seq,
    kind,
    chooser,
    options,
    source,
    ...extra,
    ...(fixed && { deadline: env.now + SOCIAL_SECONDS * 1000 }),
  };
}

/**
 * Players (and their shields) an attack by `by` may aim at: living opponents its card can
 * touch, only the neighbours under the zone, and nobody below `minHp` (ghosts need 2).
 */
export function attackOptions(
  g: Game,
  by: PlayerId,
  opts: { zone?: boolean; minHp?: number } = {},
): string[] {
  const near = opts.zone ? neighbours(g, by) : null;
  const players = reachable(g, by).filter(
    (p) => (!near || p === near.left || p === near.right) && g.players[p]!.hp >= (opts.minHp ?? 0),
  );
  return [...players, ...players.flatMap((p) => g.players[p]!.shields.map((sh) => sh.id))];
}

/** How many really different answers a target choice among `options` has. */
export function distinctTargets(g: Game, options: string[], amount: number): number {
  return options
    .filter((o) => g.players[o])
    .reduce((n, p) => n + (orderMatters(g, p, amount) ? g.players[p]!.shields.length : 1), 0);
}

/** The answer the timer, the host's "Act for" or the table makes for someone. */
export function defaultPick(g: Game, rng: Rng): string | null {
  const c = g.choice;
  if (!c) return null;
  if (c.fallback !== undefined && c.options.includes(c.fallback)) return c.fallback;
  if (c.kind === 'social') return 'done';
  if (c.kind === 'form') return 'skip';
  return c.options[rng.int(c.options.length)] ?? null;
}

// ---- Resolving cards ----

type StepResult = 'next' | 'wait';

/** A question was opened: resolution pauses. */
const WAIT = Symbol('wait');

function attackStep(s: S, env: Env, f: Frame, def: CardDef, amount: number): StepResult {
  const g = gameOf(s);
  const by = f.by;
  const ghost = f.virtual === 'ghost';
  const virtual = !!f.virtual;
  const ignore = !virtual && def.attack && g.turn.ignoreShields === true;
  // "Your attacks hit all opponents": every opponent takes the whole attack.
  if (!virtual && def.attack && hasLasting(g, 'allOpps', by)) {
    for (const p of reachable(g, by)) f.queue.push({ target: p, amount, power: false, ignore });
    return 'next';
  }
  let pick = f.data.target as string | undefined;
  if (pick === undefined) {
    // The zone limits regular attack cards only; powers, ghosts and trigger shields reach anyone.
    const zone = !!g.zone && !virtual && def.effect === null;
    const options = attackOptions(g, by, { zone, minHp: ghost ? 2 : 0 });
    if (options.length === 0) {
      if (ghost) log(s, { kind: 'haunt', player: by });
      else {
        const card = frameCard(g, f);
        if (card) log(s, { kind: 'fizzle', by, card, why: 'no-target' });
      }
      return 'next';
    }
    if (distinctTargets(g, options, amount) === 1) pick = options[0]!;
    else {
      openChoice(s, env, 'target', by, options, f.id, {
        amount,
        ...(virtual && { card: f.card ?? def.id }),
      });
      return 'wait';
    }
  }
  // Someone else may steer this attack card (never at the attacker), zone or not.
  const controller = !virtual && def.attack ? controllerOf(g, by) : null;
  let final = pick;
  if (controller) {
    const redirect = f.data.redirect as string | undefined;
    if (redirect === undefined) {
      const options = [pick, ...attackOptions(g, by).filter((o) => o !== pick)];
      if (distinctTargets(g, options, amount) > 1) {
        openChoice(s, env, 'redirect', controller, options, f.id, {
          amount,
          attacker: by,
          fallback: pick,
        });
        return 'wait';
      }
    } else final = redirect;
  }
  const holder = g.players[final] ? final : holderOf(g, final);
  if (!holder) return 'next';
  if (controller && final !== pick)
    log(s, { kind: 'redirect', by: controller, attacker: by, target: holder });
  f.queue.push({
    target: holder,
    amount,
    power: virtual,
    ...(holder !== final && { first: final }),
    ...(ignore && { ignore }),
    ...(ghost && { nonLethal: true }),
  });
  return 'next';
}

function powerStep(s: S, env: Env, f: Frame, def: CardDef, effect = def.effect): StepResult {
  const g = gameOf(s);
  const by = f.by;
  const me = g.players[by]!;
  const fizzle = (why: 'no-target' | 'no-shield' | 'no-card'): StepResult => {
    log(s, { kind: 'fizzle', by, card: def.id, why });
    return 'next';
  };
  /** One answer from `options`: asked when there's a real choice, else taken. */
  const ask = (
    kind: ChoiceKind,
    options: string[],
    o: ChoiceExtra & { chooser?: PlayerId; always?: boolean } = {},
  ): string | null | typeof WAIT => {
    const key = o.tag ?? kind;
    const answered = f.data[key];
    if (typeof answered === 'string') return answered;
    if (options.length === 0) return null;
    if (options.length === 1 && !o.always) return options[0]!;
    const { chooser = by, always: _, ...extra } = o;
    openChoice(s, env, kind, chooser, options, f.id, { ...extra, tag: key });
    return WAIT;
  };
  const hitEach = (players: PlayerId[], amount: number) => {
    for (const p of players) f.queue.push({ target: p, amount, power: true });
  };
  const hitOne = (target: string, amount: number, from?: PlayerId) => {
    const holder = g.players[target] ? target : holderOf(g, target);
    if (!holder || amount <= 0) return;
    f.queue.push({
      target: holder,
      amount,
      power: true,
      ...(holder !== target && { first: target }),
      ...(from && from !== by && { by: from }),
    });
  };
  /** Social prompts log once, with whether the timer answered. */
  const social = (player: PlayerId, key: string, flavour: Flavour, done: boolean) => {
    log(s, {
      kind: 'social',
      player,
      done,
      flavour,
      ...(f.data[`${key}Auto`] === true && { auto: true }),
    });
    if (done) tally(g, player).howls += 1;
  };
  /** Destroys a chosen shield once; its printed points, or null when there was none. */
  const destroyOne = (): number | null | typeof WAIT => {
    if (typeof f.data.points === 'number') return f.data.points;
    const pick = ask('destroy', shieldsTouched(g, by));
    if (pick === WAIT || pick === null) return pick;
    const sh = shieldIn(g, pick);
    const points = sh ? pointsOf(g, sh) : 0;
    destroyShield(s, pick, by);
    f.data.points = points;
    return points;
  };

  switch (effect) {
    case 'healPerOppThenHitEach':
      heal(s, by, opponents(g, by).length);
      hitEach(reachable(g, by), 1);
      return 'next';
    case 'allDiscardDraw3': {
      const players = fromSeat(g, by).filter((p) => affects(g, by, p));
      for (const p of players) {
        const pl = g.players[p]!;
        for (const inst of pl.hand) toDiscard(g, inst);
        pl.hand = [];
      }
      log(s, { kind: 'roar', players });
      for (const p of players) draw(s, env, p, HAND_START);
      return 'next';
    }
    case 'destroyOneShield': {
      const pick = ask('destroy', shieldsTouched(g, by));
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-shield');
      destroyShield(s, pick, by);
      return 'next';
    }
    case 'damageAll3':
      hitEach(
        fromSeat(g, by).filter((p) => affects(g, by, p)),
        3,
      );
      return 'next';
    case 'stealShield': {
      const options = reachable(g, by).flatMap((p) => g.players[p]!.shields.map((sh) => sh.id));
      const pick = ask('charm', options);
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-shield');
      const from = holderOf(g, pick)!;
      const fromPl = g.players[from]!;
      const shield = fromPl.shields.find((sh) => sh.id === pick)!;
      fromPl.shields = fromPl.shields.filter((sh) => sh.id !== pick);
      me.shields.push(shield);
      log(s, { kind: 'charm', by, from, shield: pick, card: shieldCard(g, shield) });
      return 'next';
    }
    case 'swapHpWithOpp': {
      const pick = ask('swap', reachable(g, by));
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-target');
      const other = g.players[pick]!;
      [me.hp, other.hp] = [other.hp, me.hp];
      log(s, { kind: 'swap', a: by, b: pick, hpA: me.hp, hpB: other.hp });
      return 'next';
    }
    case 'takeFromDiscard': {
      const options = me.discard.filter((inst) => !g.turn.fresh.includes(inst));
      // Every copy of the same card is the same answer.
      const distinct = [...new Map(options.map((i) => [g.cards[i]!.card, i])).values()];
      const pick = ask('recover', distinct.length === 1 ? distinct : options);
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-card');
      me.discard = me.discard.filter((inst) => inst !== pick);
      me.hand.push(pick);
      log(s, { kind: 'recover', player: by, card: g.cards[pick]!.card, inst: pick });
      return 'next';
    }
    case 'destroyAllShields':
      for (const p of g.order) {
        if (!affects(g, by, p)) continue;
        for (const sh of [...g.players[p]!.shields]) destroyShield(s, sh.id, by);
      }
      return 'next';
    case 'disguise':
      g.lasting = g.lasting.filter((l) => !(l.kind === 'disguise' && l.player === by));
      g.lasting.push({ kind: 'disguise', player: by, card: f.id });
      log(s, { kind: 'disguise', player: by });
      return 'next';
    case 'playOpponentTop': {
      const pick = ask('pickpocket', reachable(g, by));
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-target');
      const inst = takeTop(s, env, pick);
      log(s, { kind: 'pickpocket', by, from: pick, card: inst ? g.cards[inst]!.card : null });
      if (inst === null) return 'next';
      tally(g, by).stolen += 1;
      log(s, {
        kind: 'play',
        by,
        card: g.cards[inst]!.card,
        inst,
        owner: ownerOf(g, inst),
        stolen: true,
      });
      g.frames.push(newFrame(inst, by, true));
      return 'next';
    }
    case 'rotateHpRight': {
      const players = fromSeat(g, by).filter((p) => affects(g, by, p));
      if (players.length < 2) return 'next';
      const before = players.map((p) => g.players[p]!.hp);
      // Each player gives their total to the player on their right (the previous seat), so
      // everyone ends with what the next seat had.
      const after = players.map((_, i) => before[(i + 1) % players.length]!);
      players.forEach((p, i) => (g.players[p]!.hp = after[i]!));
      log(s, { kind: 'rotate', players, before, after });
      return 'next';
    }
    case 'drawFromEachOpp': {
      const from: PlayerId[] = [];
      for (const p of reachable(g, by)) {
        const inst = takeTop(s, env, p);
        if (inst === null) continue;
        me.hand.push(inst);
        from.push(p);
      }
      tally(g, by).stolen += from.length;
      log(s, { kind: 'scout', by, from, count: from.length });
      return 'next';
    }
    case 'attackBonus':
      g.turn.bonus += 1;
      log(s, { kind: 'bonus', player: by, bonus: g.turn.bonus });
      return 'next';
    case 'formBear':
    case 'formWolf': {
      // Only the deck's own owner ever holds a Form; anyone else just gets the printed symbols.
      if (ownerOf(g, f.id) !== by) return 'next';
      if (me.form) toDiscard(g, me.form.id);
      const kind = def.form!;
      me.form = { kind, id: f.id };
      f.data.inForm = true;
      log(s, { kind: 'form', player: by, form: kind });
      return 'next';
    }
    case 'freeFormPlay': {
      const forms = me.hand.filter((inst) => defOf(g, inst).form !== null);
      const answered = f.data.form;
      let pick: string | null;
      if (typeof answered === 'string') pick = answered;
      else if (forms.length === 0) pick = null;
      else {
        openChoice(s, env, 'form', by, [...forms, 'skip'], f.id);
        return 'wait';
      }
      if (pick === null || pick === 'skip') return 'next';
      me.hand = me.hand.filter((inst) => inst !== pick);
      log(s, {
        kind: 'play',
        by,
        card: g.cards[pick]!.card,
        inst: pick,
        owner: ownerOf(g, pick),
        free: true,
      });
      g.frames.push(newFrame(pick, by, false));
      return 'next';
    }
    case 'howlThenHitEach': {
      const answered = ask('social', ['done', 'skip'], { always: true, flavour: 'howl' });
      if (answered === WAIT) return 'wait';
      const done = answered === 'done';
      social(by, 'social', 'howl', done);
      if (done) hitEach(reachable(g, by), 1);
      return 'next';
    }

    // ---- The monster heroes ----

    case 'everyoneChooses': {
      // Starting with you and going right, each player attacks, heals or draws, and you
      // repeat each choice. Everyone's attacks here reach anyone (no zone).
      const parts =
        (f.data.parts as string[] | undefined) ?? toRight(g, by).filter((p) => affects(g, by, p));
      f.data.parts = parts;
      for (let i = (f.data.i as number | undefined) ?? 0; i < parts.length; i++) {
        f.data.i = i;
        const p = parts[i]!;
        if (g.players[p]!.out) continue;
        const pick = ask('mna', ['attack', 'heal', 'draw'], {
          chooser: p,
          tag: `mna${i}`,
          fallback: 'draw',
          always: true,
        });
        if (pick === WAIT) return 'wait';
        if (pick === 'attack') {
          const theirs = opponents(g, p).filter((q) => affects(g, by, q));
          const options = [
            ...theirs,
            ...theirs.flatMap((q) => g.players[q]!.shields.map((sh) => sh.id)),
          ];
          const t = ask('target', options, { chooser: p, tag: `t${i}`, amount: 1 });
          if (t === WAIT) return 'wait';
          let mine: string | null;
          if (p === by) mine = t;
          else {
            const yours = attackOptions(g, by);
            const b = ask('target', yours, { tag: 'byTarget', amount: 1 });
            if (b === WAIT) return 'wait';
            mine = b;
          }
          if (typeof mine === 'string') f.data.byTarget = mine;
          if (t !== null) hitOne(t, 1, p);
          if (p !== by && mine !== null) hitOne(mine, 1);
        } else if (pick === 'heal') {
          heal(s, p, 1);
          if (p !== by) heal(s, by, 1);
        } else {
          draw(s, env, p, 1);
          if (p !== by) draw(s, env, by, 1);
        }
        log(s, { kind: 'mna', player: p, pick: pick as 'attack' | 'heal' | 'draw' });
      }
      return 'next';
    }
    case 'discardHandHit': {
      if (typeof f.data.n !== 'number') {
        const n = me.hand.length;
        for (const inst of me.hand) toDiscard(g, inst);
        me.hand = [];
        f.data.n = n;
        log(s, { kind: 'liquidate', player: by, count: n });
      }
      const amount = Math.min(5, f.data.n);
      if (amount === 0) return 'next';
      const t = ask('opponent', reachable(g, by), { amount });
      if (t === WAIT) return 'wait';
      if (t === null) return fizzle('no-target');
      hitOne(t, amount);
      return 'next';
    }
    case 'threeTargets': {
      if (f.data.all !== true) {
        hitEach(reachable(g, by), 1);
        f.data.all = true;
      }
      const first = ask('opponent', reachable(g, by), { tag: 'first', amount: 2 });
      if (first === WAIT) return 'wait';
      if (first === null) return 'next';
      if (f.data.firstHit !== true) {
        hitOne(first, 2);
        f.data.firstHit = true;
      }
      const second = ask(
        'second',
        reachable(g, by).filter((p) => p !== first),
        { amount: 1 },
      );
      if (second === WAIT) return 'wait';
      if (second !== null) hitOne(second, 1);
      return 'next';
    }
    case 'destroyThenHitPerShield': {
      const points = destroyOne();
      if (points === WAIT) return 'wait';
      if (points === null) return fizzle('no-shield');
      const t = ask('opponent', reachable(g, by), { amount: points });
      if (t === WAIT) return 'wait';
      if (t !== null) hitOne(t, points);
      return 'next';
    }
    case 'destroyThenHealPerShield': {
      const points = destroyOne();
      if (points === WAIT) return 'wait';
      if (points === null) return fizzle('no-shield');
      heal(s, by, points);
      return 'next';
    }
    case 'danceDraw': {
      // Each player may dance and draw 1; you draw 1 more for every dancer (you included).
      const parts =
        (f.data.parts as string[] | undefined) ?? fromSeat(g, by).filter((p) => affects(g, by, p));
      f.data.parts = parts;
      for (let i = (f.data.i as number | undefined) ?? 0; i < parts.length; i++) {
        f.data.i = i;
        const p = parts[i]!;
        const key = `d${i}`;
        const answered = ask('social', ['done', 'skip'], {
          chooser: p,
          tag: key,
          flavour: 'dance',
          fallback: 'done',
          always: true,
        });
        if (answered === WAIT) return 'wait';
        const done = answered === 'done';
        social(p, key, 'dance', done);
        if (done) {
          draw(s, env, p, 1);
          f.data.count = ((f.data.count as number | undefined) ?? 0) + 1;
        }
      }
      draw(s, env, by, (f.data.count as number | undefined) ?? 0);
      return 'next';
    }
    case 'hitAllOpps':
      g.lasting = g.lasting.filter((l) => !(l.kind === 'allOpps' && l.player === by));
      g.lasting.push({ kind: 'allOpps', player: by, card: f.id });
      log(s, { kind: 'lasting', player: by, what: 'allOpps' });
      return 'next';
    case 'swapHands': {
      const t = ask('opponent', reachable(g, by));
      if (t === WAIT) return 'wait';
      if (t === null) return fizzle('no-target');
      const other = g.players[t]!;
      [me.hand, other.hand] = [other.hand, me.hand];
      log(s, { kind: 'hands', a: by, b: t });
      return 'next';
    }
    case 'takeTopDiscards': {
      const cards: CardId[] = [];
      for (const p of reachable(g, by)) {
        const inst = g.players[p]!.discard.pop();
        if (inst === undefined) continue;
        me.hand.push(inst);
        cards.push(g.cards[inst]!.card);
      }
      tally(g, by).stolen += cards.length;
      log(s, { kind: 'mother', by, cards });
      return 'next';
    }
    case 'hitPerHandCard': {
      const t = ask('opponent', reachable(g, by));
      if (t === WAIT) return 'wait';
      if (t === null) return fizzle('no-target');
      hitOne(t, Math.min(5, g.players[t]!.hand.length));
      return 'next';
    }
    case 'ignoreShields':
      g.turn.ignoreShields = true;
      log(s, { kind: 'lasting', player: by, what: 'ignoreShields' });
      return 'next';
    case 'bonesOnDestroy':
      // Strikes when destroyed (see destroyShield), not when played.
      return 'next';
    case 'praiseOrHit': {
      const parts = (f.data.parts as string[] | undefined) ?? reachable(g, by);
      f.data.parts = parts;
      for (let i = (f.data.i as number | undefined) ?? 0; i < parts.length; i++) {
        f.data.i = i;
        const p = parts[i]!;
        const key = `p${i}`;
        const answered = ask('social', ['done', 'skip'], {
          chooser: p,
          tag: key,
          flavour: 'praise',
          fallback: 'done',
          always: true,
        });
        if (answered === WAIT) return 'wait';
        const done = answered === 'done';
        if (f.data[`${key}Logged`] !== true) {
          social(p, key, 'praise', done);
          f.data[`${key}Logged`] = true;
          if (!done) hitOne(p, 2);
        }
      }
      return 'next';
    }
    case 'controlAttacks':
      // The last one played wins.
      g.lasting = g.lasting.filter((l) => l.kind !== 'control');
      g.lasting.push({ kind: 'control', player: by, card: f.id });
      log(s, { kind: 'lasting', player: by, what: 'control' });
      return 'next';
    case 'hitUnshieldedThenWipe': {
      const bare = reachable(g, by).filter((p) => g.players[p]!.shields.length === 0);
      hitEach(bare, 2);
      for (const p of g.order) {
        if (!affects(g, by, p)) continue;
        for (const sh of [...g.players[p]!.shields]) destroyShield(s, sh.id, by);
      }
      return 'next';
    }
    case 'copyShield': {
      const pick = ask('mirror', shieldsTouched(g, by));
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-shield');
      const sh = shieldIn(g, pick)!;
      // Resolves as if freshly played: the copy's own symbols, then it stays as that shield.
      f.copy = shieldCard(g, sh);
      log(s, { kind: 'mirror', player: by, card: f.copy });
      f.step = -1;
      return 'next';
    }
    case 'borrowNeighbourPower': {
      const { left, right } = neighbours(g, by);
      const sides = [...new Set([left, right].filter((p): p is PlayerId => p !== null))];
      const pick = ask('side', sides);
      if (pick === WAIT) return 'wait';
      if (pick === null) return fizzle('no-target');
      const borrowed: Effect = TOP_POWER[g.players[pick]!.hero];
      if (f.data.borrowLogged !== true) {
        log(s, { kind: 'borrow', player: by, from: pick, effect: borrowed });
        f.data.borrowLogged = true;
      }
      return powerStep(s, env, f, def, borrowed);
    }
    case 'copyHp': {
      const players = living(g).filter((p) => affects(g, by, p));
      const a = ask('copyA', players);
      if (a === WAIT) return 'wait';
      if (a === null) return fizzle('no-target');
      const b = ask(
        'copyB',
        players.filter((p) => p !== a),
      );
      if (b === WAIT) return 'wait';
      if (b === null) return fizzle('no-target');
      g.players[a]!.hp = g.players[b]!.hp;
      log(s, { kind: 'hp-copy', a, b, hp: g.players[b]!.hp });
      return 'next';
    }
    case null:
      return 'next';
  }
}

function runStep(s: S, env: Env, f: Frame, def: CardDef, step: Step): StepResult {
  const g = gameOf(s);
  const me = g.players[f.by]!;
  switch (step.k) {
    case 'atk': {
      const wolf = me.form?.kind === 'wolf' && def.steps.some((st) => st.k === 'paw');
      const bonus = def.attack ? g.turn.bonus : 0;
      return attackStep(s, env, f, def, step.n + bonus + (wolf ? 1 : 0));
    }
    case 'paw': {
      const hasAttack = def.steps.some((st) => st.k === 'atk');
      if (me.form?.kind === 'bear') heal(s, f.by, 1);
      else if (me.form?.kind === 'wolf' && !hasAttack) return attackStep(s, env, f, def, 1);
      return 'next';
    }
    case 'heal':
      heal(s, f.by, step.n);
      return 'next';
    case 'play':
      g.turn.debt += step.n;
      log(s, { kind: 'debt', player: f.by, amount: step.n });
      return 'next';
    case 'draw':
      draw(s, env, f.by, step.n);
      return 'next';
    case 'power':
      return powerStep(s, env, f, def);
  }
}

export const newFrame = (id: Inst, by: PlayerId, stolen: boolean): Frame => ({
  id,
  by,
  step: 0,
  stolen,
  queue: [],
  data: {},
});

/** Deals one hit's damage: shields first (the attacker picks which), then hit points. */
function processHit(s: S, env: Env, f: Frame, hit: Hit): StepResult {
  const g = gameOf(s);
  const t = g.players[hit.target]!;
  if (t.out) return 'next';
  const attackerId = hit.by ?? f.by;
  let left = hit.amount;
  let toShields = 0;
  while (left > 0 && t.shields.length > 0 && !hit.ignore) {
    let first = t.shields.find((sh) => sh.id === hit.first);
    if (!first) {
      if (orderMatters(g, hit.target, left)) {
        hit.amount = left;
        openChoice(
          s,
          env,
          'shield',
          attackerId,
          t.shields.map((sh) => sh.id),
          f.id,
          { amount: left, target: hit.target, ...(f.virtual && { card: f.card ?? f.virtual }) },
        );
        return 'wait';
      }
      first = t.shields[0]!;
    }
    hit.first = undefined;
    const take = Math.min(left, pointsOf(g, first) - first.damage);
    first.damage += take;
    left -= take;
    toShields += take;
    log(s, {
      kind: 'shield-hit',
      target: hit.target,
      shield: first.id,
      card: shieldCard(g, first),
      amount: take,
    });
    if (first.damage >= pointsOf(g, first)) destroyShield(s, first.id, attackerId);
  }
  // A ghost can never take anyone below 1.
  const toHp = Math.min(left, hit.nonLethal ? Math.max(0, t.hp - 1) : t.hp);
  t.hp -= toHp;
  hit.amount = 0;
  const total = (hit.dealt ?? 0) + toShields + toHp;
  const attacker = tally(g, attackerId);
  if (hit.target !== attackerId) {
    attacker.dealt += toShields + toHp;
    attacker.biggestHit = Math.max(attacker.biggestHit, total);
  }
  tally(g, hit.target).absorbed += toShields;
  log(s, {
    kind: 'damage',
    by: attackerId,
    target: hit.target,
    hp: toHp,
    shield: toShields,
    power: hit.power,
    ...(f.virtual === 'ghost' && { ghost: true }),
  });
  return 'next';
}

/** Where a card goes once it has resolved: into play (shields), its Form slot, or the played pile. */
function finishCard(s: S, f: Frame) {
  if (f.virtual) return;
  const g = gameOf(s);
  const def = frameDef(g, f);
  if (def.shield > 0) {
    g.players[f.by]!.shields.push({ id: f.id, damage: 0, ...(f.copy && { copyOf: f.copy }) });
    log(s, { kind: 'shield-up', player: f.by, shield: f.id, card: def.id });
  } else if (f.data.inForm !== true) {
    g.turn.played.push(f.id);
  }
}

/**
 * Runs the cards being resolved until a question is open or every card is done; then checks
 * knockouts (after the whole card, ruling A7), the empty-hand draw and the end of the turn.
 */
export function run(s: S, env: Env) {
  const g = gameOf(s);
  while (g.frames.length > 0 && !g.choice && s.phase === 'playing') {
    const f = g.frames[g.frames.length - 1]!;
    if (f.queue.length > 0) {
      if (processHit(s, env, f, f.queue[0]!) === 'wait') return;
      f.queue.shift();
      continue;
    }
    const def = frameDef(g, f);
    const step = def.steps[f.step];
    if (!step) {
      finishCard(s, f);
      g.frames.pop();
      if (g.frames.length === 0) afterCard(s, env, f);
      continue;
    }
    if (runStep(s, env, f, def, step) === 'wait') return;
    f.step += 1;
    f.data = f.data.inForm === true ? { inForm: true } : {};
  }
}

function knockOut(s: S, p: PlayerId, by: PlayerId, card: string | null, removed = false) {
  const g = gameOf(s);
  const pl = g.players[p]!;
  if (pl.out) return;
  pl.out = true;
  // Five or more at the start: the knocked out come back to haunt the table.
  if (g.zone && !removed) pl.ghost = true;
  for (const inst of [...pl.hand, ...pl.deck]) toDiscard(g, inst);
  pl.hand = [];
  pl.deck = [];
  if (pl.form) toDiscard(g, pl.form.id);
  pl.form = null;
  // Shields in front of them go to their owners' discards (a taken one goes home); their own
  // shields that someone else took stay in play there. Being knocked out doesn't count as a
  // shield being destroyed.
  for (const sh of pl.shields) toDiscard(g, sh.id);
  pl.shields = [];
  g.lasting = g.lasting.filter((l) => l.player !== p);
  if (g.bones) g.bones = g.bones.filter((b) => b.holder !== p);
  g.knockouts.push({ player: p, turn: g.turn.number, by, card, ...(removed && { removed }) });
  log(s, { kind: 'ko', player: p, by, card, ...(removed && { removed }) });
}

export function endGame(s: S, reason: EndReason, winners: PlayerId[]) {
  const g = gameOf(s);
  s.phase = 'over';
  g.winners = winners;
  g.endReason = reason;
  g.frames = [];
  g.choice = null;
  g.clock = null;
  g.bones = [];
  log(s, { kind: 'end', winners, reason });
}

/**
 * After every card: knockouts (A7), the winner, anyone left with an empty hand draws 2, a broken
 * trigger shield strikes back (then all of this again), and the turn goes on.
 */
function afterCard(s: S, env: Env, outer: Frame) {
  const g = gameOf(s);
  const card = frameCard(g, outer);
  const by = outer.by;
  for (const p of g.order) {
    if (!g.players[p]!.out && g.players[p]!.hp <= 0) knockOut(s, p, by, card);
  }
  if (checkWinner(s)) return;
  for (const p of living(g)) {
    const pl = g.players[p]!;
    if (p !== g.turn.player && pl.hand.length === 0 && pl.deck.length + pl.discard.length > 0)
      draw(s, env, p, 2, true);
  }
  const bones = g.bones?.shift();
  if (bones && !g.players[bones.holder]!.out) {
    g.frames.push({ ...newFrame('', bones.holder, false), virtual: 'bones', card: bones.card });
    return;
  }
  continueTurn(s, env);
}

/** Ends the game when one player (or nobody) is left. */
export function checkWinner(s: S): boolean {
  const g = gameOf(s);
  const alive = living(g);
  if (alive.length > 1) return false;
  endGame(s, alive.length === 1 ? 'last-standing' : 'tie', alive);
  return true;
}

/** Between cards: refill an empty hand with two, then wait for the next card or end the turn. */
export function continueTurn(s: S, env: Env) {
  const g = gameOf(s);
  const p = g.turn.player;
  const me = g.players[p]!;
  if (me.out) return endTurn(s, env);
  if (me.hand.length === 0) draw(s, env, p, 2, true);
  const t = tally(g, p);
  t.longestChain = Math.max(t.longestChain, g.turn.plays);
  if (g.turn.debt <= 0 || me.hand.length === 0) endTurn(s, env);
}

/** Whether a seat takes a turn: living players, and ghosts. */
const takesTurns = (g: Game, p: PlayerId) => !g.players[p]!.out || g.players[p]!.ghost === true;

export function endTurn(s: S, env: Env) {
  const g = gameOf(s);
  for (const inst of g.turn.played) toDiscard(g, inst);
  g.turn.played = [];
  // Find the next player who can play; anyone with nothing anywhere passes (ruling 7).
  let current = g.turn.player;
  for (let guard = 0; guard < g.order.length * 2 + 2; guard++) {
    const at = g.order.indexOf(current);
    const next = [...g.order.slice(at + 1), ...g.order.slice(0, at + 1)].find((p) =>
      takesTurns(g, p),
    )!;
    if (g.players[next]!.out) return ghostTurn(s, env, next);
    startTurn(s, env, next);
    if (g.players[next]!.hand.length > 0) {
      g.passes = 0;
      return;
    }
    log(s, { kind: 'pass', player: next });
    g.passes += 1;
    for (const inst of g.turn.played) toDiscard(g, inst);
    g.turn.played = [];
    if (g.passes >= living(g).length) {
      // Nobody can play a card ever again: the most hit points wins.
      const alive = living(g);
      const top = Math.max(...alive.map((q) => g.players[q]!.hp));
      endGame(
        s,
        'stalled',
        alive.filter((q) => g.players[q]!.hp === top),
      );
      return;
    }
    current = next;
  }
}

function newTurn(g: Game, p: PlayerId, debt: number) {
  // Effects "until your next turn" end now.
  g.lasting = g.lasting.filter((l) => l.player !== p);
  g.turn = {
    player: p,
    number: g.turn.number + 1,
    debt,
    played: [],
    bonus: 0,
    fresh: [],
    plays: 0,
  };
}

export function startTurn(s: S, env: Env, p: PlayerId) {
  const g = gameOf(s);
  newTurn(g, p, 1);
  const inst = takeTop(s, env, p);
  if (inst !== null) g.players[p]!.hand.push(inst);
  log(s, { kind: 'turn', player: p, drew: inst === null ? 0 : 1 });
}

/** A ghost's turn: one 1-damage attack that can't be lethal, at anyone above 1 hit point. */
function ghostTurn(s: S, env: Env, p: PlayerId) {
  const g = gameOf(s);
  newTurn(g, p, 0);
  log(s, { kind: 'turn', player: p, drew: 0 });
  g.frames.push({ ...newFrame('', p, false), virtual: 'ghost' });
  run(s, env);
}

// ---- Moves ----

export function playCard(
  s: S,
  env: Env,
  by: PlayerId,
  inst: Inst,
  auto?: 'timer' | 'host' | 'left',
): GameError | null {
  const g = s.game;
  if (s.phase !== 'playing' || !g) return new GameError('not-playing', 'No game in play.');
  if (g.turn.player !== by) return new GameError('not-your-turn', "It's not your turn.");
  if (g.frames.length > 0 || g.choice)
    return new GameError('resolving', 'Finish the card being played first.');
  if (g.turn.debt <= 0) return new GameError('no-plays', 'You have no plays left this turn.');
  const me = g.players[by]!;
  if (!me.hand.includes(inst)) return new GameError('not-in-hand', "That card isn't in your hand.");
  me.hand = me.hand.filter((i) => i !== inst);
  g.turn.debt -= 1;
  g.turn.plays += 1;
  tally(g, by).plays += 1;
  log(s, {
    kind: 'play',
    by,
    card: g.cards[inst]!.card,
    inst,
    owner: ownerOf(g, inst),
    ...(auto && { auto }),
  });
  g.frames.push(newFrame(inst, by, false));
  run(s, env);
  return null;
}

export function answer(
  s: S,
  env: Env,
  by: PlayerId,
  choiceId: number,
  pick: string,
  auto = false,
): GameError | null {
  const g = s.game;
  if (s.phase !== 'playing' || !g) return new GameError('not-playing', 'No game in play.');
  const c = g.choice;
  if (!c || c.id !== choiceId)
    return new GameError('stale-choice', 'That question has already been answered.');
  if (c.chooser !== by) return new GameError('not-yours', "That choice isn't yours to make.");
  if (!c.options.includes(pick)) return new GameError('bad-pick', "You can't pick that.");
  const f = g.frames[g.frames.length - 1]!;
  g.choice = null;
  if (c.kind === 'shield') {
    f.queue[0]!.first = pick;
  } else {
    const key = c.tag ?? c.kind;
    f.data[key] = pick;
    if (auto) f.data[`${key}Auto`] = true;
  }
  run(s, env);
  return null;
}

/** Plays whatever the table is waiting on from `who` with a random legal move. */
export function autoAct(s: S, env: Env, who: PlayerId, why: 'timer' | 'host' | 'left'): boolean {
  const g = s.game;
  if (s.phase !== 'playing' || !g) return false;
  if (g.choice) {
    if (g.choice.chooser !== who) return false;
    const pick = defaultPick(g, env.rng);
    if (pick === null) return false;
    const kind = g.choice.kind;
    log(s, { kind: 'auto', player: who, by: why, what: kind === 'social' ? 'done' : 'choice' });
    return answer(s, env, who, g.choice.id, pick, true) === null;
  }
  if (g.turn.player !== who || g.frames.length > 0) return false;
  const hand = g.players[who]!.hand;
  const inst = hand[env.rng.int(hand.length)];
  if (inst === undefined) return false;
  log(s, { kind: 'auto', player: who, by: why, what: 'play' });
  return playCard(s, env, who, inst, why) === null;
}

/** Who the table is waiting on right now, if anyone. */
export function awaited(g: Game): PlayerId | null {
  if (g.choice) return g.choice.chooser;
  if (g.frames.length === 0 && g.turn.debt > 0) return g.turn.player;
  return null;
}

/** Restarts the decision clock whenever the table starts waiting on something new. */
export function settle(s: S, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const who = awaited(g);
  if (who === null) {
    g.clock = null;
    return;
  }
  const key = g.choice ? `c${g.choice.id}` : `p${g.turn.number}.${g.turn.plays}`;
  if (g.clock?.key !== key) g.clock = { key, who, since: now, reminded: false };
}

export function removePlayer(s: S, env: Env, p: PlayerId) {
  const g = gameOf(s);
  knockOut(s, p, p, null, true);
  if (checkWinner(s)) return;
  if (g.turn.player === p) endTurn(s, env);
}
