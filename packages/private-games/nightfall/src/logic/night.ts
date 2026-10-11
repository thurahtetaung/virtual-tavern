import { GameError, type PlayerId, type Rng } from '@vt/game-sdk';
import { NIGHT_ORDER, type StepDef, stepFactor } from './plan.ts';
import { type MarkId, ROLES, type RoleId } from './roles.ts';
import {
  type Card,
  type GameRound,
  MAX_NOTES,
  MAX_TIMELINE,
  type MarkToken,
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

// ---- Marks ----

/** The Mark in front of a player (null in a game without Marks). */
export const markOf = (r: GameRound, p: PlayerId): MarkToken | null => r.marks?.[p] ?? null;

/** A player holding the Mark of Fear sleeps through their night action (never the dusk). */
export const feared = (r: GameRound, p: PlayerId) => markOf(r, p)?.id === 'fear';

/** Acts as the Doppelgänger: dealt her, or a Copycat who copied her card. */
export const actsAsDoppel = (r: GameRound, p: PlayerId) =>
  r.players[p]!.dealt === 'doppelganger' || r.players[p]!.asDoppel === true;

/** Puts a Mark in front of a player; their old one goes back to the board, unseen. */
function giveMark(c: StepCtx, by: PlayerId, target: PlayerId, mark: MarkId) {
  if (!c.r.marks) c.r.marks = {};
  c.r.marks[target] = {
    id: mark,
    doppel: actsAsDoppel(c.r, by) && mark !== 'vampire',
    ...(mark === 'assassin' ? { by } : {}),
  };
}

/** Who held which Mark, for the timeline. */
const markFaces = (r: GameRound, ...players: PlayerId[]) =>
  players.map((player) => ({ player, mark: markOf(r, player)?.id ?? null }));

// ---- Who wakes ----

/** The players acting in a step, by the role they wake as (§ "act as your original role"). */
export function actorsFor(r: GameRound, def: StepDef): PlayerId[] {
  const here = r.order.filter((p) => !r.players[p]!.left);
  // Marks are seen (and lovers meet) by everyone holding one, whatever their role.
  if (def.id === 'dusk') return here;
  if (def.id === 'lovers') return here.filter((p) => markOf(r, p)?.id === 'love');
  // Fear stops a player waking in the night proper; a dormant copy never wakes again.
  const present = here.filter(
    (p) => !r.players[p]!.dormant && !(def.order >= NIGHT_ORDER && feared(r, p)),
  );
  const night = (p: PlayerId) => r.players[p]!.night;
  const doppel = (p: PlayerId) => actsAsDoppel(r, p);
  if (def.id === 'werewolves')
    return present.filter((p) => ROLES[night(p)].wakesWithWerewolves === true);
  if (def.id === 'vampires')
    return present.filter((p) => ROLES[night(p)].wakesWithVampires === true);
  if (def.id === 'doppelganger') return present.filter((p) => night(p) === 'doppelganger');
  // The Assassin keeps his eyes open while the Apprentice Assassin (and her copy) look for him.
  const watching =
    def.role === 'apprentice-assassin'
      ? present.filter((p) => night(p) === 'assassin' && !doppel(p))
      : [];
  if (def.doppel)
    return present.filter((p) => (doppel(p) && night(p) === def.role) || watching.includes(p));
  return present.filter(
    (p) =>
      (night(p) === def.role && (!doppel(p) || ROLES[def.role].doppel === 'with-group')) ||
      watching.includes(p),
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
    marks?: { player: PlayerId; mark: MarkId | null }[];
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
    ...(extra.marks ? { marks: extra.marks } : {}),
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
  choices: null,
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
  if (pr.choices) {
    if (!a.choice || !pr.choices.includes(a.choice) || players.length || center.length || a.side)
      return new GameError('bad-pick', 'Choose one of the options.');
    return null;
  }
  if (a.choice) return new GameError('bad-pick', 'There is nothing like that to choose.');
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
  if (pr.choices) return { type: 'night', step, choice: pr.choices[rng.int(pr.choices.length)]! };
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
  /** Skipping one part of a two-part action (the Marksman): moves on instead of ending. */
  skip?: (c: StepCtx, p: PlayerId, w: StepWork) => void;
}

const nothing: RoleAction = { prompt: () => null, act: () => {} };

/** Who the night step woke together, for the werewolves' and masons' steps. */
function groupBegin(group: 'werewolves' | 'masons') {
  return (c: StepCtx, p: PlayerId, w: StepWork) => {
    const awake = c.r.night!.actors;
    // A Dream Wolf shows a thumb here, unless Fear keeps even that from him.
    const thumbs =
      group === 'werewolves'
        ? c.r.order.filter(
            (q) =>
              ROLES[c.r.players[q]!.night].werewolfThumb === true &&
              !ROLES[c.r.players[q]!.night].wakesWithWerewolves &&
              !feared(c.r, q),
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
  copycat: {
    prompt: (c) =>
      prompt('copycat', 'copy-centre', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
        mandatory: true,
      }),
    act: (c, p, w, a) => {
      const i = a.center![0]!;
      const seen = cardAt(c.r, { center: i }).role;
      // He becomes the card he saw, and wakes when it is called. A copied Doppelgänger acts at
      // her own step, as her.
      const role: RoleId = seen === 'copycat' ? 'villager' : seen;
      cardAt(c.r, findCard(c.r, c.r.players[p]!.cardId)).copied = role;
      c.r.players[p]!.night = role;
      note(c, p, { kind: 'copied-centre', center: i, role: seen });
      touch(c, p);
      w.done = true;
    },
  },
  vampire: {
    begin: (c, p, w) => {
      const night = c.r.night!;
      const awake = night.actors;
      night.vampires = [...awake];
      note(
        c,
        p,
        { kind: 'group', group: 'vampires', players: [...awake] },
        { quiet: awake.indexOf(p) > 0 },
      );
      if (vampireTargets(c).length === 0) {
        note(c, p, { kind: 'blocked', reason: 'no-target' }, { quiet: true });
        w.done = true;
      }
    },
    prompt: (c, p) =>
      prompt(c.r.players[p]!.night, 'give-vampire', {
        players: pickPlayers(vampireTargets(c)),
        mandatory: true,
      }),
    act: (c, p, _w, a) => {
      // One choice for them all: the first vampire to pick decides, and every one of them sees it.
      const target = a.players![0]!;
      const night = c.r.night!;
      const faces = markFaces(c.r, target);
      giveMark(c, p, target, 'vampire');
      night.vampireTarget = target;
      for (const q of night.actors) {
        touch(c, q);
        night.work[q]!.done = true;
        const body: NoteBody = { kind: 'marked', mark: 'vampire', targets: [target] };
        if (q === p) note(c, q, body, { marks: faces });
        else note(c, q, body, { quiet: true });
      }
    },
  },
  'the-count': {
    begin: (c, p, w) => {
      if (fearTargets(c).length === 0) {
        note(c, p, { kind: 'blocked', reason: 'no-target' });
        w.done = true;
      }
    },
    prompt: (c) =>
      prompt('the-count', 'give-fear', { players: pickPlayers(fearTargets(c)), mandatory: true }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'fear'),
  },
  renfield: {
    begin: (c, p, w) => {
      const night = c.r.night!;
      const faces = markFaces(c.r, p);
      giveMark(c, p, p, 'bat');
      note(
        c,
        p,
        {
          kind: 'saw-vampires',
          players: [...(night.vampires ?? [])],
          target: night.vampireTarget ?? null,
        },
        { marks: faces },
      );
      touch(c, p);
      w.done = true;
    },
    ...nothing,
  },
  diseased: {
    prompt: () => prompt('diseased', 'give-disease', { sides: true, mandatory: true }),
    act: (c, p, w, a) => giveTo(c, p, w, [neighbour(c.r, p, a.side!)], 'disease'),
  },
  cupid: {
    prompt: (c) => prompt('cupid', 'give-love', { players: pickPlayers(c.r.order, 2, 2) }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'love'),
  },
  instigator: {
    prompt: (c) => prompt('instigator', 'give-traitor', { players: pickPlayers(c.r.order) }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'traitor'),
  },
  priest: {
    // He must take Clarity himself, then may give one more.
    begin: (c, p) => {
      const faces = markFaces(c.r, p);
      giveMark(c, p, p, 'clarity');
      note(c, p, { kind: 'marked', mark: 'clarity', targets: [p] }, { marks: faces });
      touch(c, p);
    },
    prompt: (c, p) => prompt('priest', 'give-clarity', { players: pickPlayers(others(c.r, p)) }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'clarity'),
  },
  assassin: {
    prompt: (c) =>
      prompt('assassin', 'give-assassin', { players: pickPlayers(c.r.order), mandatory: true }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'assassin'),
  },
  'apprentice-assassin': {
    begin: (c, p, w) => {
      const assassins = c.r.night!.actors.filter(
        (q) => c.r.players[q]!.night === 'assassin' && !actsAsDoppel(c.r, q),
      );
      note(c, p, { kind: 'group', group: 'assassins', players: assassins });
      // With an Assassin awake, she only looks; with none, she must place the Mark herself.
      if (assassins.length) w.done = true;
    },
    prompt: (c) =>
      prompt('apprentice-assassin', 'give-assassin', {
        players: pickPlayers(c.r.order),
        mandatory: true,
      }),
    act: (c, p, w, a) => giveTo(c, p, w, a.players!, 'assassin'),
  },
  marksman: {
    prompt: (c, p, w) =>
      w.stage === 'card'
        ? prompt('marksman', 'view', {
            players: pickPlayers(
              others(c.r, p).filter((q) => !shielded(c.r, q) && !w.picks.includes(q)),
            ),
          })
        : // A shield guards the card, never the Mark.
          prompt('marksman', 'view-mark', { players: pickPlayers(others(c.r, p)) }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      if (w.stage === 'card') {
        see(c, p, { player: target });
        w.done = true;
        return;
      }
      note(c, p, { kind: 'saw-mark', target, mark: markOf(c.r, target)?.id ?? 'clarity' });
      touch(c, p);
      w.picks = [target];
      w.stage = 'card';
    },
    skip: (c, p, w) => {
      if (w.stage === 'card') {
        if (!w.picks.length) note(c, p, { kind: 'passed' });
        w.done = true;
      } else w.stage = 'card';
    },
  },
  pickpocket: {
    prompt: (c, p) => prompt('pickpocket', 'pickpocket', { players: pickPlayers(others(c.r, p)) }),
    act: (c, p, w, a) => {
      const target = a.players![0]!;
      const faces = markFaces(c.r, p, target);
      swapMarks(c.r, p, target);
      note(
        c,
        p,
        { kind: 'pickpocketed', target, mark: markOf(c.r, p)?.id ?? 'clarity' },
        { marks: faces },
      );
      touch(c, p);
      w.done = true;
    },
  },
  gremlin: {
    prompt: (c, _p, w) => {
      const movable = c.r.order.filter((q) => !shielded(c.r, q));
      if (w.stage === 'marks')
        return prompt('gremlin', 'swap-marks', { players: pickPlayers(c.r.order, 2, 2) });
      if (w.stage === 'cards')
        return prompt('gremlin', 'swap-cards', { players: pickPlayers(movable, 2, 2) });
      return prompt('gremlin', 'gremlin', {
        choices: movable.length >= 2 ? ['marks', 'cards'] : ['marks'],
      });
    },
    act: (c, p, w, a) => {
      if (a.choice) {
        w.stage = a.choice;
        return;
      }
      const [x, y] = a.players! as [PlayerId, PlayerId];
      if (w.stage === 'marks') {
        const faces = markFaces(c.r, x, y);
        swapMarks(c.r, x, y);
        note(c, p, { kind: 'swapped-marks', a: x, b: y }, { marks: faces });
      } else {
        const faces = moved(c.r, { player: x }, { player: y });
        swap(c.r, { player: x }, { player: y });
        note(c, p, { kind: 'swapped', a: { player: x }, b: { player: y } }, { moved: faces });
      }
      touch(c, p);
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

/** Gives a Mark to each target, noted with the Marks they had (the Count, Cupid, …). */
function giveTo(c: StepCtx, p: PlayerId, w: StepWork, targets: PlayerId[], mark: MarkId) {
  const faces = markFaces(c.r, ...targets);
  for (const t of targets) giveMark(c, p, t, mark);
  note(c, p, { kind: 'marked', mark, targets: [...targets] }, { marks: faces });
  touch(c, p);
  w.done = true;
}

function swapMarks(r: GameRound, a: PlayerId, b: PlayerId) {
  const ma = r.marks?.[a];
  const mb = r.marks?.[b];
  if (!r.marks || !ma || !mb) return;
  r.marks[a] = mb;
  r.marks[b] = ma;
}

/** Who the vampires may mark: anyone who didn't wake with them. */
const vampireTargets = (c: StepCtx) => c.r.order.filter((q) => !c.r.night!.actors.includes(q));

/** Who the Count may frighten: no vampire, and not the player they just marked. */
const fearTargets = (c: StepCtx) =>
  c.r.order.filter(
    (q) =>
      !(c.r.night!.vampires ?? []).includes(q) &&
      q !== c.r.night!.vampireTarget &&
      markOf(c.r, q)?.id !== 'vampire',
  );

/** The Assassin watches the Apprentice Assassin (or her copy) wake: they see each other. */
const watchApprentice: RoleAction = {
  begin: (c, p, w) => {
    const apprentices = c.r.night!.actors.filter(
      (q) => c.r.players[q]!.night === 'apprentice-assassin',
    );
    note(c, p, { kind: 'group', group: 'apprentices', players: apprentices }, { quiet: true });
    w.done = true;
  },
  ...nothing,
};

/** Dusk's end: everyone looks at their own Mark. */
const dusk: RoleAction = {
  begin: (c, p, w) => {
    const m = markOf(c.r, p);
    if (m) note(c, p, { kind: 'mark', mark: m.id, ...(m.doppel ? { doppel: true } : {}) });
    w.as = c.r.players[p]!.dealt;
    w.done = true;
  },
  ...nothing,
};

/** The lovers wake and see each other. */
const lovers: RoleAction = {
  begin: (c, p, w) => {
    const awake = c.r.night!.actors;
    note(
      c,
      p,
      { kind: 'group', group: 'lovers', players: [...awake] },
      { quiet: awake.indexOf(p) > 0 },
    );
    w.as = c.r.players[p]!.dealt;
    w.done = true;
  },
  ...nothing,
};

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
    c.r.players[p]!.asDoppel = true;
    // She copies what the card is: a Doppelgänger's card counts as what it copied. A Copycat's
    // card makes her whatever the Copycat copied, though she can't see what, and she never
    // wakes for it.
    const blind = card.role === 'copycat';
    let role: RoleId =
      card.role === 'doppelganger' || blind ? (card.copied ?? 'villager') : card.role;
    if (role === 'doppelganger' || role === 'copycat') role = 'villager';
    cardAt(c.r, findCard(c.r, c.r.players[p]!.cardId)).copied = role;
    c.r.players[p]!.night = role;
    touch(c, p);
    w.stage = 'act';
    if (blind) {
      note(c, p, { kind: 'copied', target, role: 'copycat', blind: true });
      c.r.players[p]!.dormant = true;
      w.as = 'copycat';
      w.done = true;
      return;
    }
    note(c, p, { kind: 'copied', target, role });
    const mode = ROLES[role].doppel;
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

/** The action a player takes in the current step. */
function actionFor(c: StepCtx, p: PlayerId): RoleAction {
  if (c.def.id === 'doppelganger') return doppelganger;
  if (c.def.id === 'dusk') return dusk;
  if (c.def.id === 'lovers') return lovers;
  if (c.def.role === 'apprentice-assassin' && c.r.players[p]!.night === 'assassin')
    return watchApprentice;
  return roleAction(c.def.role);
}

/** What a player may do in the current step, or null. */
export function promptFor(c: StepCtx, p: PlayerId): Prompt | null {
  const w = c.r.night!.work[p];
  if (!w || w.done) return null;
  return actionFor(c, p).prompt(c, p, w);
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
    if (w.done) continue;
    actionFor(c, p).begin?.(c, p, w);
    if (!w.done && !actionFor(c, p).prompt(c, p, w)) w.done = true;
  }
}

/** A player's choice in the current step. */
export function actInStep(c: StepCtx, p: PlayerId, a: NightAction): GameError | null {
  const night = c.r.night!;
  const w = night.work[p];
  if (!w) return new GameError('not-your-step', 'It isn’t your turn to act.');
  if (w.done) return new GameError('done', 'You’ve already acted this step.');
  const action = actionFor(c, p);
  const pr = action.prompt(c, p, w);
  if (!pr) return new GameError('done', 'There is nothing to do now.');
  const err = checkPick(pr, a);
  if (err) return err;
  if (a.pass) {
    if (action.skip) action.skip(c, p, w);
    else {
      note(c, p, { kind: 'passed' });
      w.done = true;
    }
  } else action.act(c, p, w, a);
  if (!w.done && !action.prompt(c, p, w)) w.done = true;
  return null;
}

/** Time is up: mandatory actions are made at random, optional ones are skipped. */
export function endStep(c: StepCtx) {
  const night = c.r.night!;
  for (const p of night.actors) {
    const w = night.work[p]!;
    let guard = 0;
    while (!w.done && guard++ < 6) {
      const pr = actionFor(c, p).prompt(c, p, w);
      if (!pr) break;
      if (!pr.mandatory) {
        // Say they did nothing, unless they did something earlier in the step.
        if (!(c.r.notes[p] ?? []).some((n) => n.step === c.step && n.kind !== 'group'))
          note(c, p, { kind: 'passed' }, { auto: true });
        break;
      }
      const pick = randomPick(pr, c.rng, c.step);
      if (!pick) break;
      const before = (c.r.notes[p] ?? []).length;
      actionFor(c, p).act(c, p, w, pick);
      // Mark what the game chose for them.
      for (const n of (c.r.notes[p] ?? []).slice(before)) n.auto = true;
      for (const t of night.timeline) if (t.by === p && t.step === c.step) t.auto = true;
    }
    w.done = true;
  }
}
