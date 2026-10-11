import { GameError, type PlayerId, type Rng } from '@vt/game-sdk';
import { type StepDef, stepFactor } from './plan.ts';
import { ROLES, type RoleId } from './roles.ts';
import {
  type Card,
  type GameRound,
  MAX_NOTES,
  MAX_TIMELINE,
  type NightAction,
  type NoteBody,
  type Prompt,
  type Settings,
  type Slot,
  type StepWork,
} from './types.ts';

// The night runs on a mutable draft of the round: the game clones the state first, so these
// helpers stay pure from the outside.

/** Everything a role's action needs while its step runs. */
export interface StepCtx {
  r: GameRound;
  /** Plan index of the step. */
  step: number;
  def: StepDef;
  settings: Settings;
  rng: Rng;
  /** Next note id. */
  nextId: () => number;
}

// ---- Cards and seats ----

export const isPlayerSlot = (s: Slot): s is { player: PlayerId } => 'player' in s;

export function cardAt(r: GameRound, slot: Slot): Card {
  return isPlayerSlot(slot) ? r.cards[slot.player]! : r.center[slot.center]!.card;
}

function put(r: GameRound, slot: Slot, card: Card) {
  if (isPlayerSlot(slot)) r.cards[slot.player] = card;
  else r.center[slot.center] = { ...r.center[slot.center]!, card };
}

export function swap(r: GameRound, a: Slot, b: Slot) {
  const ca = cardAt(r, a);
  const cb = cardAt(r, b);
  put(r, a, cb);
  put(r, b, ca);
}

/** Where a physical card is now. */
export function findCard(r: GameRound, cardId: number): Slot {
  for (const p of r.order) if (r.cards[p]!.id === cardId) return { player: p };
  const at = r.center.findIndex((c) => c.card.id === cardId);
  return { center: at };
}

/** The neighbour on a side: left is the next seat, right the previous one. */
export function neighbour(r: GameRound, p: PlayerId, side: 'left' | 'right'): PlayerId {
  const i = r.order.indexOf(p);
  const n = r.order.length;
  return r.order[(i + (side === 'left' ? 1 : n - 1)) % n]!;
}

const shielded = (r: GameRound, p: PlayerId) => r.cards[p]!.shield !== null;
const others = (r: GameRound, p: PlayerId) => r.order.filter((q) => q !== p);
const centreSlots = (r: GameRound) => r.center.map((_, i) => i);

// ---- Who wakes ----

/** The players acting in a step, by the role they wake as (§ "act as your original role"). */
export function actorsFor(r: GameRound, def: StepDef): PlayerId[] {
  const present = r.order.filter((p) => !r.players[p]!.left);
  const night = (p: PlayerId) => r.players[p]!.night;
  const dealtDoppel = (p: PlayerId) => r.players[p]!.dealt === 'doppelganger';
  if (def.id === 'werewolves')
    return present.filter((p) => ROLES[night(p)].wakesWithWerewolves === true);
  if (def.id === 'doppelganger') return present.filter(dealtDoppel);
  if (def.doppel) return present.filter((p) => dealtDoppel(p) && night(p) === def.role);
  return present.filter(
    (p) => night(p) === def.role && (!dealtDoppel(p) || ROLES[def.role].doppel === 'with-group'),
  );
}

/** Players who show a werewolf thumb: every Werewolf, the Dream Wolf included, by night role. */
const werewolfThumbs = (r: GameRound) =>
  r.order.filter((p) => ROLES[r.players[p]!.night].werewolfThumb === true);

// ---- Notes ----

export function note(
  c: StepCtx,
  p: PlayerId,
  body: NoteBody,
  extra: {
    auto?: boolean;
    moved?: { slot: Slot; role: RoleId; card: number }[];
    quiet?: boolean;
  } = {},
) {
  const list = c.r.notes[p] ?? [];
  list.push({ ...body, id: c.nextId(), step: c.step, ...(extra.auto ? { auto: true } : {}) });
  c.r.notes[p] = list.slice(-MAX_NOTES);
  if (extra.quiet) return;
  const night = c.r.night!;
  night.timeline.push({
    step: c.step,
    stepId: c.def.id,
    by: p,
    note: body,
    ...(extra.auto ? { auto: true } : {}),
    ...(extra.moved ? { moved: extra.moved } : {}),
  });
  night.timeline = night.timeline.slice(-MAX_TIMELINE);
}

const touch = (c: StepCtx, p: PlayerId) => {
  const t = c.r.night!.touched;
  if (!t.includes(p)) t.push(p);
};

const see = (c: StepCtx, p: PlayerId, slot: Slot) => {
  note(c, p, { kind: 'saw', slot, role: cardAt(c.r, slot).role });
  touch(c, p);
};

/** A swap, recorded with the faces of the cards for the timeline. */
const moved = (r: GameRound, ...slots: Slot[]) =>
  slots.map((slot) => ({ slot, role: cardAt(r, slot).role, card: cardAt(r, slot).id }));

// ---- Prompts and picks ----

const prompt = (as: RoleId, stage: string, p: Partial<Prompt>): Prompt => ({
  stage,
  as,
  players: null,
  center: null,
  either: false,
  sides: false,
  mandatory: false,
  ...p,
});

const pickPlayers = (ids: PlayerId[], min = 1, max = 1) =>
  ids.length >= min ? { ids, min, max: Math.min(max, ids.length) } : null;

/** Checks a night action against the prompt it answers. */
function checkPick(pr: Prompt, a: NightAction): GameError | null {
  if (a.pass) {
    return pr.mandatory ? new GameError('mandatory', 'You must choose this time.') : null;
  }
  const players = a.players ?? [];
  const center = a.center ?? [];
  if (new Set(players).size !== players.length || new Set(center).size !== center.length)
    return new GameError('duplicate', 'Choose different cards.');
  if (pr.sides) {
    if (!a.side || players.length || center.length)
      return new GameError('bad-pick', 'Choose left or right.');
    return null;
  }
  if (a.side) return new GameError('bad-pick', 'There is no side to choose.');
  const usesPlayers = players.length > 0;
  const usesCenter = center.length > 0;
  if (!usesPlayers && !usesCenter) return new GameError('bad-pick', 'Choose a card first.');
  if (usesPlayers && usesCenter && (pr.either || !pr.players || !pr.center))
    return new GameError('bad-pick', 'Choose players or centre cards, not both.');
  if (usesPlayers) {
    if (!pr.players) return new GameError('bad-pick', 'You can’t choose a player now.');
    if (players.some((p) => !pr.players!.ids.includes(p)))
      return new GameError('bad-target', 'You can’t choose that card.');
    if (players.length < pr.players.min || players.length > pr.players.max)
      return new GameError(
        'bad-count',
        pr.players.min === pr.players.max
          ? `Choose ${pr.players.min === 1 ? 'one player' : `${pr.players.min} players`}.`
          : `Choose up to ${pr.players.max} players.`,
      );
  }
  if (usesCenter) {
    if (!pr.center) return new GameError('bad-pick', 'You can’t choose a centre card now.');
    if (center.some((i) => !pr.center!.slots.includes(i)))
      return new GameError('bad-target', 'You can’t choose that card.');
    if (center.length < pr.center.min || center.length > pr.center.max)
      return new GameError(
        'bad-count',
        pr.center.min === 1 && pr.center.max === 1
          ? 'Choose one centre card.'
          : `Choose ${pr.center.min} centre cards.`,
      );
  }
  return null;
}

/** A random legal answer to a prompt, for a mandatory action when time runs out. */
function randomPick(pr: Prompt, rng: Rng, step: number): NightAction | null {
  if (pr.sides) return { type: 'night', step, side: rng.int(2) === 0 ? 'left' : 'right' };
  if (pr.players) {
    const ids = rng.shuffle(pr.players.ids).slice(0, pr.players.min);
    return { type: 'night', step, players: ids };
  }
  if (pr.center) {
    const slots = rng.shuffle(pr.center.slots).slice(0, pr.center.min);
    return { type: 'night', step, center: slots };
  }
  return null;
}

// ---- Role actions ----

/**
 * A role's night action. `begin` runs as the step starts (information roles act here and are
 * done), `prompt` says what the actor may do now (null: nothing left), and `act` applies a
 * validated pick. A Doppelgänger runs the copied role's action with the same functions.
 */
interface RoleAction {
  begin?: (c: StepCtx, p: PlayerId, w: StepWork) => void;
  prompt: (c: StepCtx, p: PlayerId, w: StepWork) => Prompt | null;
  act: (c: StepCtx, p: PlayerId, w: StepWork, a: NightAction) => void;
}

const nothing: RoleAction = { prompt: () => null, act: () => {} };

/** Who the night step woke together, for the werewolves' and masons' steps. */
function groupBegin(group: 'werewolves' | 'masons') {
  return (c: StepCtx, p: PlayerId, w: StepWork) => {
    const awake = c.r.night!.actors;
    const thumbs =
      group === 'werewolves'
        ? c.r.order.filter(
            (q) =>
              ROLES[c.r.players[q]!.night].werewolfThumb === true &&
              !ROLES[c.r.players[q]!.night].wakesWithWerewolves,
          )
        : [];
    note(
      c,
      p,
      {
        kind: 'group',
        group,
        players: [...awake],
        ...(group === 'werewolves' ? { thumbs } : {}),
      },
      { quiet: awake.indexOf(p) > 0 },
    );
    if (group === 'werewolves') {
      c.r.night!.knownWolves = [...new Set([...awake, ...thumbs])];
      // A lone wolf (nobody else awake, no Dream Wolf thumb) may look at a centre card.
      const lone = c.settings.loneWolf && awake.length === 1 && thumbs.length === 0;
      if (!lone) w.done = true;
      else c.r.loneWolf = p;
    } else w.done = true;
  };
}

function thumbsBegin(of: 'werewolves' | 'tanner' | 'seers' | 'touched', done = true) {
  return (c: StepCtx, p: PlayerId, w: StepWork) => {
    const night = (q: PlayerId) => c.r.players[q]!.night;
    const players =
      of === 'werewolves'
        ? werewolfThumbs(c.r)
        : of === 'tanner'
          ? c.r.order.filter((q) => night(q) === 'tanner')
          : of === 'seers'
            ? c.r.order.filter((q) => night(q) === 'seer' || night(q) === 'apprentice-seer')
            : [...c.r.night!.touched];
    w.picks = players.filter((q) => q !== p);
    note(c, p, { kind: 'thumbs', of, players: w.picks });
    if (done || w.picks.length === 0) w.done = true;
  };
}

/** View some of the players who showed a thumb (Squire, Beholder). */
const viewThumbs = (as: RoleId): RoleAction => ({
  prompt: (c, _p, w) => {
    const ids = w.picks.filter((q) => !shielded(c.r, q));
    return w.done ? null : prompt(as, 'view-thumbs', { players: pickPlayers(ids, 1, ids.length) });
  },
  act: (c, p, w, a) => {
    for (const q of a.players ?? []) see(c, p, { player: q });
    w.done = true;
  },
});

const ACTIONS: Partial<Record<RoleId, RoleAction>> = {
  sentinel: {
    prompt: (c, p) =>
      prompt('sentinel', 'shield', {
        players: pickPlayers(others(c.r, p).filter((q) => !shielded(c.r, q))),
      }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      c.r.cards[target]!.shield = c.r.players[p]!.dealt === 'doppelganger' ? 'doppel' : 'normal';
      note(c, p, { kind: 'shielded', target });
      w.done = true;
    },
  },
  'alpha-wolf': {
    begin: (c, p, w) => {
      if (alphaTargets(c, p).length === 0 || wolfSlot(c.r) < 0) {
        note(c, p, { kind: 'blocked', reason: 'no-target' });
        w.done = true;
      }
    },
    prompt: (c, p) =>
      prompt('alpha-wolf', 'give-wolf', {
        players: pickPlayers(alphaTargets(c, p)),
        mandatory: true,
      }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      const wolf = { center: wolfSlot(c.r) };
      const faces = moved(c.r, wolf, { player: target });
      swap(c.r, wolf, { player: target });
      note(c, p, { kind: 'swapped', a: wolf, b: { player: target } }, { moved: faces });
      touch(c, p);
      w.done = true;
    },
  },
  'mystic-wolf': {
    prompt: (c, p) =>
      prompt('mystic-wolf', 'view', {
        players: pickPlayers(others(c.r, p).filter((q) => !shielded(c.r, q))),
      }),
    act: (c, p, w, a) => {
      see(c, p, { player: a.players![0]! });
      w.done = true;
    },
  },
  seer: {
    prompt: (c, p) =>
      prompt('seer', 'view', {
        players: pickPlayers(others(c.r, p).filter((q) => !shielded(c.r, q))),
        center: { slots: centreSlots(c.r), min: 2, max: 2 },
        either: true,
      }),
    act: (c, p, w, a) => {
      if (a.players?.length) {
        const target = a.players[0]!;
        see(c, p, { player: target });
        c.r.seerLooks.push({ by: p, target, cardId: c.r.cards[target]!.id });
      } else for (const i of a.center!) see(c, p, { center: i });
      w.done = true;
    },
  },
  'apprentice-seer': {
    prompt: (c) =>
      prompt('apprentice-seer', 'view', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
      }),
    act: (c, p, w, a) => {
      see(c, p, { center: a.center![0]! });
      w.done = true;
    },
  },
  'paranormal-investigator': {
    prompt: (c, p, w) => {
      const ids = others(c.r, p).filter((q) => !shielded(c.r, q) && !w.picks.includes(q));
      return prompt('paranormal-investigator', w.picks.length ? 'view-again' : 'view', {
        players: pickPlayers(ids),
      });
    },
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      w.picks.push(target);
      see(c, p, { player: target });
      const role = c.r.cards[target]!.role;
      if (!ROLES[role].villageCard) {
        // He stops and becomes what he saw; the change travels with his own card.
        const mine = cardAt(c.r, findCard(c.r, c.r.players[p]!.cardId));
        mine.became = role;
        note(c, p, { kind: 'became', role });
        w.done = true;
      } else if (w.picks.length >= 2) w.done = true;
    },
  },
  robber: {
    begin: (c, p, w) => {
      if (shielded(c.r, p)) {
        note(c, p, { kind: 'blocked', reason: 'shielded' });
        w.done = true;
      }
    },
    prompt: (c, p) =>
      prompt('robber', 'rob', {
        players: pickPlayers(others(c.r, p).filter((q) => !shielded(c.r, q))),
      }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      const faces = moved(c.r, { player: p }, { player: target });
      swap(c.r, { player: p }, { player: target });
      note(c, p, { kind: 'robbed', target, role: c.r.cards[p]!.role }, { moved: faces });
      touch(c, p);
      w.done = true;
    },
  },
  witch: {
    prompt: (c, p, w) => {
      if (w.stage !== 'swap')
        return prompt('witch', 'view', { center: { slots: centreSlots(c.r), min: 1, max: 1 } });
      return prompt('witch', 'swap', {
        players: pickPlayers(c.r.order.filter((q) => !shielded(c.r, q))),
        mandatory: true,
      });
    },
    act: (c, p, w, a) => {
      if (w.stage !== 'swap') {
        const i = a.center![0]!;
        see(c, p, { center: i });
        w.centre = [i];
        w.stage = 'swap';
        if (c.r.order.every((q) => shielded(c.r, q))) {
          note(c, p, { kind: 'blocked', reason: 'no-target' });
          w.done = true;
        }
        return;
      }
      const target = a.players![0]!;
      const centre = { center: w.centre[0]! };
      const faces = moved(c.r, centre, { player: target });
      swap(c.r, centre, { player: target });
      note(c, p, { kind: 'witched', center: centre.center, target }, { moved: faces });
      w.done = true;
    },
  },
  troublemaker: {
    prompt: (c, p) =>
      prompt('troublemaker', 'swap', {
        players: pickPlayers(
          others(c.r, p).filter((q) => !shielded(c.r, q)),
          2,
          2,
        ),
      }),
    act: (c, p, w, a) => {
      const [x, y] = a.players! as [PlayerId, PlayerId];
      const faces = moved(c.r, { player: x }, { player: y });
      swap(c.r, { player: x }, { player: y });
      note(c, p, { kind: 'swapped', a: { player: x }, b: { player: y } }, { moved: faces });
      touch(c, p);
      w.done = true;
    },
  },
  'village-idiot': {
    prompt: () => prompt('village-idiot', 'move-all', { sides: true }),
    act: (c, p, w, a) => {
      const side = a.side!;
      // Every card but his own and the shielded ones moves to the next movable seat that way.
      const movable = c.r.order.filter((q) => q !== p && !shielded(c.r, q));
      const before = movable.map((q) => c.r.cards[q]!);
      const n = movable.length;
      const faces = moved(c.r, ...movable.map((q) => ({ player: q })));
      movable.forEach((q, i) => {
        const from = side === 'left' ? (i - 1 + n) % n : (i + 1) % n;
        c.r.cards[q] = before[from]!;
      });
      note(c, p, { kind: 'moved-all', side }, { moved: faces });
      if (n > 1) touch(c, p);
      w.done = true;
    },
  },
  thing: {
    prompt: () => prompt('thing', 'tap', { sides: true }),
    act: (c, p, w, a) => {
      const side = a.side!;
      const target = neighbour(c.r, p, side);
      note(c, p, { kind: 'tapped', target, side });
      // The tapped player learns it at daybreak (their screen must not change mid-night).
      const from = side === 'left' ? 'right' : 'left';
      (c.r.dawn[target] ??= []).push({ kind: 'was-tapped', side: from });
      w.done = true;
    },
  },
  drunk: {
    begin: (c, p, w) => {
      if (shielded(c.r, p)) {
        note(c, p, { kind: 'blocked', reason: 'shielded' });
        w.done = true;
      }
    },
    prompt: (c) =>
      prompt('drunk', 'take', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
        mandatory: true,
      }),
    act: (c, p, w, a) => {
      const i = a.center![0]!;
      const faces = moved(c.r, { player: p }, { center: i });
      swap(c.r, { player: p }, { center: i });
      note(c, p, { kind: 'took-center', center: i }, { moved: faces });
      touch(c, p);
      w.done = true;
    },
  },
  insomniac: {
    begin: (c, p, w) => {
      if (shielded(c.r, p)) note(c, p, { kind: 'blocked', reason: 'shielded' });
      else note(c, p, { kind: 'saw-own', role: c.r.cards[p]!.role });
      w.done = true;
    },
    ...nothing,
  },
  revealer: {
    prompt: (c, p) =>
      prompt('revealer', 'reveal', {
        players: pickPlayers(
          others(c.r, p).filter((q) => !shielded(c.r, q) && !c.r.cards[q]!.faceUp),
        ),
      }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      const card = c.r.cards[target]!;
      const stayed = ROLES[card.role].villageCard;
      if (stayed) card.faceUp = true;
      note(c, p, { kind: 'revealed', target, role: card.role, stayed });
      touch(c, p);
      w.done = true;
    },
  },
  curator: {
    prompt: (c) =>
      c.r.night!.bag.length === 0
        ? null
        : prompt('curator', 'place', {
            players: pickPlayers(
              c.r.order.filter((q) => !shielded(c.r, q) && c.r.cards[q]!.artifact === null),
            ),
          }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      const bag = c.r.night!.bag;
      const artifact = bag.splice(c.rng.int(bag.length), 1)[0]!;
      c.r.cards[target]!.artifact = artifact;
      note(c, p, { kind: 'artifact-placed', target });
      w.done = true;
    },
  },
  werewolf: { begin: groupBegin('werewolves'), ...loneWolf() },
  mason: { begin: groupBegin('masons'), ...nothing },
  minion: { begin: thumbsBegin('werewolves'), ...nothing },
  'apprentice-tanner': { begin: thumbsBegin('tanner'), ...nothing },
  'aura-seer': { begin: thumbsBegin('touched'), ...nothing },
  squire: { begin: thumbsBegin('werewolves', false), ...viewThumbs('squire') },
  beholder: { begin: thumbsBegin('seers', false), ...viewThumbs('beholder') },
};

function loneWolf(): Pick<RoleAction, 'prompt' | 'act'> {
  return {
    prompt: (c, p) =>
      prompt(c.r.players[p]!.night, 'lone-wolf', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
      }),
    act: (c, p, w, a) => {
      see(c, p, { center: a.center![0]! });
      w.done = true;
    },
  };
}

const wolfSlot = (r: GameRound) => r.center.findIndex((s) => s.kind === 'wolf');

/** Who an Alpha Wolf may hand the centre werewolf to. */
function alphaTargets(c: StepCtx, p: PlayerId): PlayerId[] {
  const doppel = c.def.id === 'doppelganger';
  return others(c.r, p).filter((q) => {
    if (shielded(c.r, q)) return false;
    // The Doppelgänger copy acts before the werewolves wake: anyone but the Alpha Wolf.
    if (doppel) return c.r.players[q]!.dealt !== 'alpha-wolf';
    return !c.r.night!.knownWolves.includes(q);
  });
}

// ---- The Doppelgänger ----

const doppelganger: RoleAction = {
  prompt: (c, p, w) => {
    if (w.stage === 'start')
      return prompt('doppelganger', 'copy', {
        players: pickPlayers(others(c.r, p)),
        mandatory: true,
      });
    return roleAction(w.as!).prompt(c, p, w);
  },
  act: (c, p, w, a) => {
    if (w.stage !== 'start') return roleAction(w.as!).act(c, p, w, a);
    const target = a.players![0]!;
    const card = c.r.cards[target]!;
    // She copies what the card is: a copier's card counts as what it copied.
    const role = card.role === 'doppelganger' ? (card.copied ?? 'villager') : card.role;
    cardAt(c.r, findCard(c.r, c.r.players[p]!.cardId)).copied = role;
    c.r.players[p]!.night = role;
    note(c, p, { kind: 'copied', target, role });
    touch(c, p);
    const mode = ROLES[role].doppel;
    w.stage = 'act';
    w.as = role;
    if (mode === 'immediate') {
      roleAction(role).begin?.(c, p, w);
      if (!w.done && !roleAction(role).prompt(c, p, w)) w.done = true;
      return;
    }
    // A copied Minion sees the werewolves' thumbs at the end of her step.
    if (mode === 'minion') thumbsBegin('werewolves')(c, p, w);
    w.done = true;
  },
};

const roleAction = (role: RoleId): RoleAction => ACTIONS[role] ?? nothing;

const actionFor = (c: StepCtx): RoleAction =>
  c.def.id === 'doppelganger' ? doppelganger : roleAction(c.def.role);

/** What a player may do in the current step, or null. */
export function promptFor(c: StepCtx, p: PlayerId): Prompt | null {
  const w = c.r.night!.work[p];
  if (!w || w.done) return null;
  return actionFor(c).prompt(c, p, w);
}

// ---- Step flow ----

/** Starts a step: wakes its players and runs the information roles. */
export function beginStep(c: StepCtx, now: number) {
  const night = c.r.night!;
  night.index = c.step;
  night.deadline = now + stepFactor(c.def.id) * c.settings.stepSeconds * 1000;
  night.actors = actorsFor(c.r, c.def);
  night.work = Object.fromEntries(
    night.actors.map((p) => [p, { stage: 'start', picks: [], centre: [], done: false }]),
  );
  if (night.actors.length === 0) {
    night.timeline.push({ step: c.step, stepId: c.def.id, by: null, note: { kind: 'nobody' } });
    return;
  }
  for (const p of night.actors) {
    const w = night.work[p]!;
    actionFor(c).begin?.(c, p, w);
    if (!w.done && !actionFor(c).prompt(c, p, w)) w.done = true;
  }
}

/** A player's choice in the current step. */
export function actInStep(c: StepCtx, p: PlayerId, a: NightAction): GameError | null {
  const night = c.r.night!;
  const w = night.work[p];
  if (!w) return new GameError('not-your-step', 'It isn’t your turn to act.');
  if (w.done) return new GameError('done', 'You’ve already acted this step.');
  const pr = actionFor(c).prompt(c, p, w);
  if (!pr) return new GameError('done', 'There is nothing to do now.');
  const err = checkPick(pr, a);
  if (err) return err;
  if (a.pass) {
    note(c, p, { kind: 'passed' });
    w.done = true;
    return null;
  }
  actionFor(c).act(c, p, w, a);
  if (!w.done && !actionFor(c).prompt(c, p, w)) w.done = true;
  return null;
}

/** Time is up: mandatory actions are made at random, optional ones are skipped. */
export function endStep(c: StepCtx) {
  const night = c.r.night!;
  for (const p of night.actors) {
    const w = night.work[p]!;
    let guard = 0;
    while (!w.done && guard++ < 6) {
      const pr = actionFor(c).prompt(c, p, w);
      if (!pr) break;
      if (!pr.mandatory) {
        note(c, p, { kind: 'passed' }, { auto: true });
        break;
      }
      const pick = randomPick(pr, c.rng, c.step);
      if (!pick) break;
      const before = (c.r.notes[p] ?? []).length;
      actionFor(c).act(c, p, w, pick);
      // Mark what the game chose for them.
      for (const n of (c.r.notes[p] ?? []).slice(before)) n.auto = true;
      for (const t of night.timeline) if (t.by === p && t.step === c.step) t.auto = true;
    }
    w.done = true;
  }
}
