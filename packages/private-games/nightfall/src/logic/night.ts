import { GameError, type PlayerId, type Rng } from '@vt/game-sdk';
import {
  NIGHT_ORDER,
  REPEAT,
  type StepDef,
  buildNightPlan,
  repeatStepOf,
  stepFactor,
} from './plan.ts';
import { type MarkId, type NostraTeam, ROLES, type RoleId, nostraTeamOf } from './roles.ts';
import {
  TABLE_OF,
  blobOptions,
  evenly,
  numberOf,
  pickFor,
  pickRipple,
  playerNumbered,
  playersIn,
  type PlayerSet,
  type Ripple,
  type StepPick,
} from './tables.ts';
import {
  type Announcement,
  type Card,
  CHOICES,
  type Choice,
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
  type TimelineEntry,
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
  /** The server clock (when the step began or ends), for announcements. */
  now?: number;
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
    // Only the Apprentice Assassin's own Mark (she found no Assassin) records who placed it.
    ...(mark === 'assassin' && c.def.role === 'apprentice-assassin' ? { by } : {}),
  };
}

/** Who held which Mark, for the timeline. */
const markFaces = (r: GameRound, ...players: PlayerId[]) =>
  players.map((player) => ({ player, mark: markOf(r, player)?.id ?? null }));

// ---- Who wakes ----

/** The players acting in a step, by the role they wake as (§ "act as your original role"). */
export function actorsFor(r: GameRound, def: StepDef, ignoreFear = false): PlayerId[] {
  const here = r.order.filter((p) => !r.players[p]!.left);
  // Marks are seen (and lovers meet) by everyone holding one, whatever their role.
  if (def.id === 'dusk') return here;
  if (def.id === 'lovers') return here.filter((p) => markOf(r, p)?.id === 'love');
  // Nobody wakes for the Blob: the narrator just announces its members.
  if (def.id === 'blob') return [];
  const nightState = r.night;
  const pick = nightState?.picks?.[nightState.index];
  if (def.id === 'ripple') {
    const named = rippleActors(nightState?.ripple);
    return here.filter((p) => named.includes(numberOf(r.order, p)));
  }
  // Fear stops a player waking in the night proper; a dormant copy never wakes again. The dusk is
  // exempt only because the Mark is unseen until it ends: a ripple's repeat, and a time loop's
  // dusk for a player who already held Fear when the loop began, are stopped too.
  const inLoop = nightState?.loopFrom !== undefined && nightState.index >= nightState.loopFrom;
  const fearStops = (p: PlayerId) =>
    feared(r, p) &&
    (def.order >= NIGHT_ORDER ||
      def.repeat === true ||
      (inLoop && (nightState.loopFeared ?? []).includes(p)));
  const present = here.filter((p) => !r.players[p]!.dormant && (ignoreFear || !fearStops(p)));
  const night = (p: PlayerId) => r.players[p]!.night;
  const doppel = (p: PlayerId) => actsAsDoppel(r, p);
  if (def.id === 'werewolves')
    return present.filter((p) => ROLES[night(p)].wakesWithWerewolves === true);
  if (def.id === 'aliens' || (def.repeat && def.role === 'alien')) {
    // The aliens wake with their eyes open; the Cow puts out a fist (even under Fear, as a
    // thumb would be), and so does everyone the New Alien instruction names.
    const aliens = present.filter((p) => wakesAsAlien(r, p));
    const cows = def.repeat ? [] : here.filter((p) => night(p) === 'cow' && canThumb(r, p));
    const fists =
      pick?.kind === 'alien' && pick.fists
        ? playersIn(r.order, pick.fists, null).filter((p) => !aliens.includes(p) && canThumb(r, p))
        : [];
    return here.filter((p) => aliens.includes(p) || cows.includes(p) || fists.includes(p));
  }
  if (def.id === 'groob-zerb')
    return present.filter((p) => night(p) === 'groob' || night(p) === 'zerb');
  if (def.role === 'empath' && !def.repeat) {
    // The Empath watches; the players the narrator names point, eyes closed.
    const empaths = present.filter(
      (p) => night(p) === 'empath' && (def.doppel ? doppel(p) : !doppel(p)),
    );
    const named =
      pick?.kind === 'empath'
        ? playersIn(r.order, pick.who, null).filter((p) => canThumb(r, p))
        : [];
    return here.filter((p) => empaths.includes(p) || named.includes(p));
  }
  // A ripple's repeat wakes everyone who woke as the role, copies included.
  if (def.repeat) return present.filter((p) => night(p) === def.role);
  // In a time loop the Doppelgänger wakes as her copy again, to redo an action she did at once.
  if (
    def.id === 'doppelganger' &&
    nightState?.loopFrom !== undefined &&
    nightState.index >= nightState.loopFrom
  )
    return present.filter((p) => r.players[p]!.asDoppel === true && night(p) !== 'doppelganger');
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

/**
 * Players who can show a thumb: still at the table, and not a dormant copy (a Doppelgänger who
 * copied the Copycat doesn't know what she is, so she can't raise a thumb for it).
 */
const canThumb = (r: GameRound, p: PlayerId) => !r.players[p]!.left && !r.players[p]!.dormant;

/** Players who show a werewolf thumb: every Werewolf, the Dream Wolf included, by night role. */
const werewolfThumbs = (r: GameRound) =>
  r.order.filter((p) => canThumb(r, p) && ROLES[r.players[p]!.night].werewolfThumb === true);

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
export function randomPick(pr: Prompt, rng: Rng, step: number): NightAction | null {
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
  /** Time ran out on an optional action: what that means (the Empath's pointers point at nobody). */
  timeout?: (c: StepCtx, p: PlayerId) => void;
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
              canThumb(c.r, q) &&
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
    // A dormant copy still knows she looked at a card, so she shows the Aura Seer her thumb.
    const shows = (q: PlayerId) => (of === 'touched' ? !c.r.players[q]!.left : canThumb(c.r, q));
    w.picks = players.filter((q) => q !== p && shows(q));
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
      // The Doppelgänger's copy may hand it to any player but the Alpha Wolf, werewolves too.
      prompt('alpha-wolf', c.def.id === 'doppelganger' ? 'give-wolf-any' : 'give-wolf', {
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
        else note(c, q, { ...body, chosenBy: p }, { quiet: true });
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

/** The Alien set's roles, added once their actions are defined (below). */
function alienActions(): Partial<Record<RoleId, RoleAction>> {
  return {
    oracle,
    'body-snatcher': bodySnatcher,
    leader,
    psychic,
    rascal,
    exposer,
    mortician,
    empath,
    nostradamus,
  };
}

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

// ---- The Alien set ----

/** Wakes in the aliens' step: an alien role at night, or a player a New Alien tap made one. */
export const wakesAsAlien = (r: GameRound, p: PlayerId) =>
  ROLES[r.players[p]!.night].wakesWithAliens === true || (r.aliens?.players.includes(p) ?? false);

/** The player numbers a ripple names to act. */
export function rippleActors(ripple: Ripple | undefined): number[] {
  if (!ripple) return [];
  switch (ripple.key) {
    case 'view-1':
    case 'view-2':
    case 'troublemaker':
    case 'steal':
    case 'drunk':
    case 'witch':
    case 'reveal':
      return [ripple.actor];
    case 'dual-view':
    case 'insomniac':
      return ripple.actors;
    case 'shuffle':
      return ripple.players;
    default:
      return [];
  }
}

/** Says something out loud for everyone: public from now on, and in the timeline. */
export function announce(c: StepCtx, a: Announcement) {
  const list = (c.r.announcements ??= []);
  list.push({ ...a, step: c.step, at: c.now ?? 0 });
  c.r.night!.timeline.push({
    step: c.step,
    stepId: c.def.id,
    by: null,
    note: { kind: 'announced', announcement: a },
  });
}

/** The step's random instruction, if it has one. */
const pickOf = (c: StepCtx): StepPick | undefined => c.r.night!.picks?.[c.step];

/** Told what the narrator said for this step (quiet: the timeline has it once, by itself). */
const tell = (c: StepCtx, p: PlayerId) => {
  const pick = pickOf(c);
  if (pick) note(c, p, { kind: 'told', pick }, { quiet: true });
};

/** The players (or centre cards) a set names, for a prompt, never a shielded card. */
function fromSet(
  c: StepCtx,
  p: PlayerId,
  set: PlayerSet | undefined,
  extra: (q: PlayerId) => boolean = () => true,
) {
  if (!set) return { players: [] as PlayerId[], centre: [] as number[] };
  if (set.kind === 'center') return { players: [], centre: centreSlots(c.r) };
  return {
    players: playersIn(c.r.order, set, p).filter((q) => !shielded(c.r, q) && extra(q)),
    centre: [] as number[],
  };
}

/** A prompt to pick from a set: players, or centre cards when it names the centre. */
function setPrompt(
  as: RoleId,
  stage: string,
  from: { players: PlayerId[]; centre: number[] },
  min: number,
  max: number,
  mandatory = false,
): Prompt {
  if (from.centre.length)
    return prompt(as, stage, {
      center:
        from.centre.length >= min
          ? { slots: from.centre, min, max: Math.min(max, from.centre.length) }
          : null,
      mandatory,
    });
  return prompt(as, stage, { players: pickPlayers(from.players, min, max), mandatory });
}

/** The slot a night action picked: a player, or a centre card. */
const picked = (a: NightAction): Slot =>
  a.players?.length ? { player: a.players[0]! } : { center: a.center![0]! };

/** The awake aliens (not the Cow, not the fists), in seat order. */
const awakeAliens = (c: StepCtx) => c.r.night!.aliens ?? [];

const alien: RoleAction = {
  begin: (c, p, w) => {
    tell(c, p);
    const night = c.r.night!;
    const aliens = awakeAliens(c);
    note(
      c,
      p,
      { kind: 'group', group: 'aliens', players: [...aliens] },
      { quiet: aliens.indexOf(p) > 0 },
    );
    const cows = night.actors.filter((q) => c.r.players[q]!.night === 'cow' && !aliens.includes(q));
    if (cows.length) note(c, p, { kind: 'thumbs', of: 'cow', players: cows }, { quiet: true });
    const pick = pickOf(c);
    if (pick?.kind !== 'alien') {
      w.done = true;
      return;
    }
    switch (pick.action) {
      case 'show':
        // Each alien shows its card to the others (a shielded card stays hidden).
        for (const q of aliens) if (q !== p && !shielded(c.r, q)) see(c, p, { player: q });
        w.done = true;
        return;
      case 'view':
      case 'all-view':
      case 'new-alien':
      case 'alien-helper':
        return;
      default:
        w.done = true;
    }
  },
  prompt: (c, p) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'alien') return null;
    // A New Alien wakes with them as an alien, whatever card they hold.
    const night = c.r.players[p]!.night;
    const as: RoleId = ROLES[night].wakesWithAliens ? night : 'alien';
    if (pick.action === 'view' || pick.action === 'all-view')
      return setPrompt(as, `alien-${pick.action}`, fromSet(c, p, pick.from), 1, 1);
    if (pick.action === 'new-alien' || pick.action === 'alien-helper')
      return prompt(as, pick.action, {
        players: pickPlayers(c.r.night!.actors.filter((q) => fistOf(c, q))),
        mandatory: true,
      });
    return null;
  },
  act: (c, p, _w, a) => {
    const pick = pickOf(c)!;
    if (pick.kind !== 'alien') return;
    const night = c.r.night!;
    const target = a.players?.[0] ?? null;
    if (pick.action === 'view') {
      see(c, p, picked(a));
      night.work[p]!.done = true;
      return;
    }
    // Together: the first alien to confirm decides for them all, and every one of them sees it.
    night.alienTarget = target ?? `centre:${a.center?.[0] ?? 0}`;
    for (const q of awakeAliens(c)) {
      const w = night.work[q];
      if (w) w.done = true;
      if (pick.action === 'all-view') {
        const slot = picked(a);
        if (q === p) see(c, q, slot);
        else {
          note(c, q, { kind: 'saw', slot, role: cardAt(c.r, slot).role }, { quiet: true });
          touch(c, q);
        }
      } else {
        const helper = pick.action === 'alien-helper';
        const body: NoteBody = { kind: 'recruited', target: target!, helper };
        if (q === p) note(c, q, body);
        else note(c, q, { ...body, chosenBy: p }, { quiet: true });
      }
    }
    if (pick.action !== 'all-view' && target) {
      const helper = pick.action === 'alien-helper';
      const aliens = (c.r.aliens ??= { players: [], helpers: [] });
      const list = helper ? aliens.helpers : aliens.players;
      if (!list.includes(target)) list.push(target);
      note(c, target, { kind: 'fist', tapped: true, helper }, { quiet: true });
    }
  },
};

/** Whether `q` has a fist out for the aliens to tap (named by the New Alien instruction). */
function fistOf(c: StepCtx, q: PlayerId): boolean {
  const pick = pickOf(c);
  if (pick?.kind !== 'alien' || !pick.fists) return false;
  return !awakeAliens(c).includes(q) && playersIn(c.r.order, pick.fists, null).includes(q);
}

/** A fist out for the aliens: nothing to choose; tapped or not shows at the end of the step. */
const fist: RoleAction = {
  begin: (c, p, w) => {
    tell(c, p);
    // A Cow among the fists still learns whether an alien next to her tipped it.
    if (c.r.players[p]!.night === 'cow') cowTipped(c, p);
    w.done = true;
  },
  ...nothing,
};

function cowTipped(c: StepCtx, p: PlayerId) {
  const aliens = awakeAliens(c);
  const sides = [neighbour(c.r, p, 'left'), neighbour(c.r, p, 'right')];
  note(c, p, { kind: 'tipped', tipped: sides.some((q) => aliens.includes(q)) });
}

/** The Cow's fist: tipped if an awake alien sits right next to her. */
const cow: RoleAction = {
  begin: (c, p, w) => {
    cowTipped(c, p);
    w.done = true;
  },
  ...nothing,
};

/** The aliens' step before anyone acts: who is awake, and the swaps and timer that just happen. */
function startAliens(c: StepCtx) {
  const night = c.r.night!;
  const aliens = night.actors.filter((q) => wakesAsAlien(c.r, q) && !feared(c.r, q));
  night.aliens = aliens;
  night.alienTarget = null;
  const pick = pickOf(c);
  if (pick?.kind !== 'alien') return;
  if (pick.action === 'timer')
    c.r.daySeconds = Math.round((c.r.daySeconds ?? c.settings.daySeconds) / 2);
  if (pick.action === 'left' || pick.action === 'right') {
    // Each card passes to the next awake alien that way, round the table (shielded ones stay).
    const ring = aliens.filter((q) => !shielded(c.r, q));
    const n = ring.length;
    if (n < 2) {
      for (const q of aliens)
        note(c, q, { kind: 'passed-card', side: pick.action, to: null }, { quiet: true });
      return;
    }
    // Ring order follows the seats: "left" is towards higher seats.
    const before = ring.map((q) => c.r.cards[q]!);
    const faces = moved(c.r, ...ring.map((q) => ({ player: q })));
    ring.forEach((q, i) => {
      const from = pick.action === 'left' ? (i - 1 + n) % n : (i + 1) % n;
      c.r.cards[q] = before[from]!;
    });
    ring.forEach((q, i) => {
      const to = ring[pick.action === 'left' ? (i + 1) % n : (i - 1 + n) % n]!;
      note(
        c,
        q,
        { kind: 'passed-card', side: pick.action as 'left' | 'right', to },
        i === 0 ? { moved: faces } : { quiet: true },
      );
      touch(c, q);
    });
  }
}

const groobZerb: RoleAction = {
  begin: (c, p, w) => {
    const awake = c.r.night!.actors;
    note(
      c,
      p,
      { kind: 'group', group: 'groob-zerb', players: [...awake] },
      { quiet: awake.indexOf(p) > 0 },
    );
    w.done = true;
  },
  ...nothing,
};

/** Groob and Zerb saw each other when both kinds are awake together. */
function startGroobZerb(c: StepCtx) {
  const night = c.r.night!;
  const roles = new Set(night.actors.map((q) => c.r.players[q]!.night));
  night.groobZerb = roles.has('groob') && roles.has('zerb') ? [...night.actors] : [];
}

const bodySnatcher: RoleAction = {
  begin: (c, p, w) => {
    tell(c, p);
    const pick = pickOf(c);
    if (pick?.kind !== 'body-snatcher' || pick.action === 'pretend') {
      note(c, p, { kind: 'pretended' });
      w.done = true;
      return;
    }
    if (shielded(c.r, p)) {
      note(c, p, { kind: 'blocked', reason: 'shielded' });
      w.done = true;
    }
  },
  prompt: (c, p) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'body-snatcher') return null;
    if (pick.action === 'center')
      return prompt(c.r.players[p]!.night, 'snatch-centre', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
        mandatory: true,
      });
    // A non-alien's card: not one of the aliens he saw awake.
    const from = fromSet(c, p, pick.from, (q) => !awakeAliens(c).includes(q));
    return setPrompt(c.r.players[p]!.night, 'snatch', from, 1, 1, true);
  },
  act: (c, p, w, a) => {
    const slot = picked(a);
    const mine = c.r.cards[p]!;
    const faces = moved(c.r, { player: p }, slot);
    swap(c.r, { player: p }, slot);
    const card = c.r.cards[p]!;
    card.alienCard = true;
    // The Doppelgänger's copy makes her own card an Alien card too.
    if (actsAsDoppel(c.r, p)) mine.alienCard = true;
    note(c, p, { kind: 'snatched', slot, role: card.role }, { moved: faces });
    touch(c, p);
    w.done = true;
  },
};

const leader: RoleAction = {
  begin: (c, p, w) => {
    const thumbs = c.r.order.filter((q) => q !== p && canThumb(c.r, q) && wakesAsAlien(c.r, q));
    note(c, p, { kind: 'thumbs', of: 'aliens', players: thumbs });
    if (c.settings.roles.includes('groob') && c.settings.roles.includes('zerb'))
      note(c, p, {
        kind: 'thumbs',
        of: 'groob-zerb',
        players: (c.r.night!.groobZerb ?? []).filter((q) => q !== p && canThumb(c.r, q)),
      });
    w.done = true;
  },
  ...nothing,
};

const psychic: RoleAction = {
  begin: (c, p) => tell(c, p),
  prompt: (c, p) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'psychic') return null;
    return setPrompt(c.r.players[p]!.night, 'psychic', fromSet(c, p, pick.from), 1, pick.count);
  },
  act: (c, p, w, a) => {
    for (const q of a.players ?? []) see(c, p, { player: q });
    w.done = true;
  },
};

const rascal: RoleAction = {
  begin: (c, p, w) => {
    tell(c, p);
    const pick = pickOf(c);
    if (pick?.kind !== 'rascal') return;
    if ((pick.action === 'robber' || pick.action === 'drunk') && shielded(c.r, p)) {
      note(c, p, { kind: 'blocked', reason: 'shielded' });
      w.done = true;
    }
  },
  prompt: (c, p, w) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'rascal') return null;
    const as = c.r.players[p]!.night;
    switch (pick.action) {
      case 'troublemaker':
        return setPrompt(as, 'rascal-swap', fromSet(c, p, pick.from), 2, 2);
      case 'witch':
        if (w.stage === 'give') {
          const from = w.picks.length ? { player: w.picks[0]! } : { center: w.centre[0]! };
          const ids = c.r.order.filter(
            (q) => !shielded(c.r, q) && !('player' in from && from.player === q),
          );
          return prompt(as, 'rascal-give', { players: pickPlayers(ids), mandatory: true });
        }
        return setPrompt(as, 'rascal-view', fromSet(c, p, pick.from), 1, 1);
      case 'robber':
        return setPrompt(as, 'rascal-rob', fromSet(c, p, pick.from), 1, 1);
      case 'drunk':
        return setPrompt(as, 'rascal-drunk', fromSet(c, p, pick.from), 1, 1, true);
      case 'idiot':
        return prompt(as, 'move-all', { sides: true });
    }
  },
  act: (c, p, w, a) => {
    const pick = pickOf(c)!;
    if (pick.kind !== 'rascal') return;
    if (pick.action === 'idiot') return ACTIONS['village-idiot']!.act(c, p, w, a);
    if (pick.action === 'troublemaker') return ACTIONS.troublemaker!.act(c, p, w, a);
    if (pick.action === 'witch') {
      if (w.stage !== 'give') {
        const slot = picked(a);
        see(c, p, slot);
        if ('player' in slot) w.picks = [slot.player];
        else w.centre = [slot.center];
        w.stage = 'give';
        const from = slot;
        if (!c.r.order.some((q) => !shielded(c.r, q) && !('player' in from && from.player === q))) {
          note(c, p, { kind: 'blocked', reason: 'no-target' });
          w.done = true;
        }
        return;
      }
      const from: Slot = w.picks.length ? { player: w.picks[0]! } : { center: w.centre[0]! };
      const to = a.players![0]!;
      const faces = moved(c.r, from, { player: to });
      swap(c.r, from, { player: to });
      note(c, p, { kind: 'gave', from, to }, { moved: faces });
      touch(c, p);
      w.done = true;
      return;
    }
    const slot = picked(a);
    const faces = moved(c.r, { player: p }, slot);
    swap(c.r, { player: p }, slot);
    if (pick.action === 'robber')
      note(c, p, { kind: 'took', slot, role: c.r.cards[p]!.role }, { moved: faces });
    else note(c, p, { kind: 'swapped', a: { player: p }, b: slot }, { moved: faces });
    touch(c, p);
    w.done = true;
  },
};

const exposer: RoleAction = {
  begin: (c, p) => tell(c, p),
  prompt: (c, p) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'exposer') return null;
    const slots = centreSlots(c.r).filter((i) => !c.r.center[i]!.card.faceUp);
    // Exactly that many, or none at all.
    const k = Math.min(pick.count, slots.length);
    return prompt(c.r.players[p]!.night, 'expose', {
      center: k ? { slots, min: k, max: k } : null,
    });
  },
  act: (c, p, w, a) => {
    for (const i of a.center ?? []) {
      const card = c.r.center[i]!.card;
      card.faceUp = true;
      note(c, p, { kind: 'exposed', center: i, role: card.role });
    }
    touch(c, p);
    w.done = true;
  },
};

const mortician: RoleAction = {
  begin: (c, p, w) => {
    tell(c, p);
    const pick = pickOf(c);
    if (pick?.kind !== 'mortician' || pick.action === 'pretend') {
      note(c, p, { kind: 'pretended' });
      w.done = true;
    }
  },
  prompt: (c, p) => {
    const pick = pickOf(c);
    if (pick?.kind !== 'mortician' || pick.action === 'pretend') return null;
    // His own card counts here, unless it is shielded.
    const from =
      pick.from?.kind === 'yourself'
        ? { players: shielded(c.r, p) ? [] : [p], centre: [] }
        : fromSet(c, p, pick.from);
    return setPrompt(
      c.r.players[p]!.night,
      'mortician',
      from,
      1,
      pick.action === 'both-cards' ? 2 : 1,
    );
  },
  act: (c, p, w, a) => {
    for (const q of a.players ?? []) see(c, p, { player: q });
    w.done = true;
  },
};

/** The Empath watches the pointing; the named players point (eyes closed) or don't. */
const empath: RoleAction = {
  begin: (c, p, w) => {
    const pick = pickOf(c);
    if (pick) note(c, p, { kind: 'told', pick, watching: true }, { quiet: true });
    w.done = true;
  },
  ...nothing,
};

/** The Empath's actors: the role (or its copy), as opposed to the players pointing. */
const isEmpath = (c: StepCtx, p: PlayerId) =>
  c.r.players[p]!.night === 'empath' &&
  (c.def.doppel ? actsAsDoppel(c.r, p) : !actsAsDoppel(c.r, p));

function pointAt(c: StepCtx, p: PlayerId, target: PlayerId | null, auto = false) {
  note(c, p, { kind: 'pointed', target }, auto ? { auto: true } : {});
  for (const e of c.r.night!.actors)
    if (isEmpath(c, e) && e !== p)
      note(c, e, { kind: 'saw-point', from: p, target }, { quiet: true });
}

const pointer: RoleAction = {
  begin: (c, p) => tell(c, p),
  prompt: (c, p) =>
    prompt(c.r.players[p]!.night, 'point', { players: pickPlayers(others(c.r, p)) }),
  act: (c, p, w, a) => {
    pointAt(c, p, a.players![0]!);
    w.done = true;
  },
  skip: (c, p, w) => {
    pointAt(c, p, null);
    w.done = true;
  },
  timeout: (c, p) => pointAt(c, p, null, true),
};

/** Nostradamus: up to three looks at players' cards, stopping at one that isn't village. */
const nostradamus: RoleAction = {
  prompt: (c, p, w) => {
    const ids = others(c.r, p).filter((q) => !shielded(c.r, q) && !w.picks.includes(q));
    return prompt('nostradamus', w.picks.length ? 'foresee-again' : 'foresee', {
      players: pickPlayers(ids),
    });
  },
  act: (c, p, w, a) => {
    const target = a.players![0]!;
    w.picks.push(target);
    see(c, p, { player: target });
    if (!ROLES[c.r.cards[target]!.role].villageCard || w.picks.length >= 3) w.done = true;
  },
};

/** The team Nostradamus is on: the last card he saw, or the narrator's pick when he saw none. */
function foretell(c: StepCtx, p: PlayerId | null, owners: PlayerId[] = []) {
  const looked = p ? (c.r.notes[p] ?? []).filter((n) => n.step === c.step && n.kind === 'saw') : [];
  const last = looked.at(-1);
  let team: NostraTeam;
  let cardId: number | null;
  if (last?.kind === 'saw') {
    team = nostraTeamOf(last.role);
    cardId = cardAt(c.r, last.slot).id;
  } else {
    const teams = [...new Set(c.settings.roles.map(nostraTeamOf))];
    team = evenly(c.rng, teams);
    const all = [...c.r.order.map((q) => c.r.cards[q]!), ...c.r.center.map((x) => x.card)];
    cardId = all.find((card) => nostraTeamOf(card.role) === team)?.id ?? null;
  }
  // The team goes on his own card (a copy's card for a copy), wherever it is now. When nobody
  // acted, it goes on the cards of those who should have (a Feared copy), else on the card itself.
  const cardOf = (q: PlayerId) => cardAt(c.r, findCard(c.r, c.r.players[q]!.cardId));
  const own = p
    ? [cardOf(p)]
    : owners.length
      ? owners.map(cardOf)
      : c.def.doppel
        ? []
        : [...c.r.order.map((q) => c.r.cards[q]!), ...c.r.center.map((x) => x.card)]
            .filter((card) => card.role === 'nostradamus')
            .slice(0, 1);
  for (const card of own) card.foretold = { team, card: cardId };
  if (p) note(c, p, { kind: 'foretold', team });
  announce(c, { kind: 'nostradamus', doppel: c.def.doppel === true, team });
}

// ---- The Oracle ----

const YES_NO: Choice[] = ['yes', 'no'];
const NUMBERS = CHOICES.filter((x) => /^\d+$/.test(x));

/** What the Oracle may answer to her question. */
function oracleChoices(c: StepCtx): Choice[] {
  const q = c.r.oracle!.question;
  if (q === 'even-odd') return ['even', 'odd'];
  if (q === 'view-player') return NUMBERS.slice(0, c.r.order.length);
  if (q === 'number') return NUMBERS;
  return YES_NO;
}

/** The narrator's reply to an answer, and its effects (`p`: the Oracle, null in the centre). */
function answerOracle(c: StepCtx, p: PlayerId | null, answer: string) {
  const o = c.r.oracle!;
  o.answer = answer;
  const yes = answer === 'yes';
  const coin = () => c.rng.int(2) === 0;
  let outcome: string;
  switch (o.question) {
    case 'werewolf-team':
    case 'vampire-team':
      outcome = yes ? `${o.question}:yes` : 'team:no';
      if (yes && p) o.mod = o.question === 'werewolf-team' ? 'werewolf-card' : 'vampire-card';
      break;
    case 'alien-team':
      if (!yes) outcome = 'team:no';
      else if (coin()) {
        outcome = 'alien-team:yes';
        if (p) o.mod = 'alien-card';
      } else {
        outcome = 'alien-team:yes-helper';
        if (p) o.mod = 'aliens-win-only';
      }
      break;
    case 'alien-exchange':
      outcome = yes ? 'alien-exchange:yes' : 'alien-exchange:no';
      o.exchange = yes;
      break;
    case 'view-center':
      outcome = yes ? `view-center:${1 + c.rng.int(3)}` : 'view-center:no';
      break;
    case 'center-exchange':
      outcome = !yes
        ? 'center-exchange:no'
        : coin()
          ? 'center-exchange:yes'
          : 'center-exchange:denied';
      break;
    case 'ripple':
      outcome = yes ? 'ripple:yes' : 'ripple:no';
      o.ripple = yes;
      break;
    case 'even-odd':
      outcome = answer;
      break;
    case 'view-player': {
      const n = Number(answer);
      if (coin()) outcome = 'view-player:yes';
      else {
        outcome = 'view-player:other';
        const me = p ? numberOf(c.r.order, p) : 0;
        const pool = c.r.order.map((_, i) => i + 1).filter((x) => x !== n && x !== me);
        o.answer = `${n}>${evenly(c.rng, pool.length ? pool : [n])}`;
      }
      break;
    }
    case 'number':
      // One time in ten she guessed right, whatever her number.
      outcome = c.rng.int(10) === 0 ? 'number:right' : 'number:wrong';
      o.numberFail = outcome === 'number:wrong';
      break;
  }
  o.outcome = outcome;
  if (!p) return;
  o.player = p;
  note(c, p, { kind: 'oracle', question: o.question, answer, outcome });
  // Looking at the card the narrator named.
  if (o.question === 'view-player') {
    const target = playerNumbered(c.r.order, viewedNumber(o.answer));
    if (target && !shielded(c.r, target)) see(c, p, { player: target });
  }
}

/** The number whose card the Oracle views ("7", or "7>3" when the narrator chose another). */
const viewedNumber = (answer: string) => Number(answer.split('>').at(-1));

const oracle: RoleAction = {
  begin: (c, p) => tell(c, p),
  prompt: (c, p, w) => {
    const o = c.r.oracle!;
    if (w.stage === 'start')
      return prompt('oracle', 'oracle', { choices: oracleChoices(c), mandatory: true });
    if (w.stage === 'view-center') {
      const k = Number(o.outcome!.split(':')[1]);
      return prompt('oracle', 'view-center', {
        center: { slots: centreSlots(c.r), min: 1, max: k },
      });
    }
    if (w.stage === 'exchange' && !shielded(c.r, p))
      return prompt('oracle', 'take', {
        center: { slots: centreSlots(c.r), min: 1, max: 1 },
        mandatory: true,
      });
    return null;
  },
  act: (c, p, w, a) => {
    if (w.stage === 'start') {
      answerOracle(c, p, a.choice!);
      const out = c.r.oracle!.outcome!;
      if (out.startsWith('view-center:') && out !== 'view-center:no') w.stage = 'view-center';
      else if (out === 'center-exchange:yes') w.stage = 'exchange';
      else w.done = true;
      return;
    }
    if (w.stage === 'view-center') {
      for (const i of a.center ?? []) see(c, p, { center: i });
      w.done = true;
      return;
    }
    const i = a.center![0]!;
    const faces = moved(c.r, { player: p }, { center: i });
    swap(c.r, { player: p }, { center: i });
    note(c, p, { kind: 'took-center', center: i }, { moved: faces });
    touch(c, p);
    w.done = true;
  },
};

/** The Oracle's step at its end: the narrator answers for her if she can't, and says the rest. */
function endOracle(c: StepCtx) {
  const o = c.r.oracle;
  if (!o) return;
  if (o.answer === null) {
    o.centre = !c.r.order.some(
      (q) => c.r.players[q]!.night === 'oracle' && c.r.players[q]!.dealt === 'oracle',
    );
    answerOracle(c, null, evenly(c.rng, oracleChoices(c)));
  }
  if (o.question === 'even-odd')
    announce(c, { kind: 'oracle-parity', parity: o.answer === 'even' ? 'even' : 'odd' });
  if (o.question === 'view-player')
    announce(c, {
      kind: 'oracle-view',
      number: viewedNumber(o.answer!),
      swapped: o.outcome === 'view-player:other',
    });
  if (o.question === 'number') {
    announce(c, { kind: 'oracle-number', right: o.outcome === 'number:right' });
    const her = c.r.order.find((q) => c.r.players[q]!.dealt === 'oracle' && !c.r.players[q]!.left);
    if (o.outcome === 'number:right' && her && !o.centre) (c.r.observers ??= []).push(her);
  }
}

// ---- Ripples ----

/** A ripple's action for a player it names. */
const rippleAction: RoleAction = {
  begin: (c, p, w) => {
    const rp = c.r.night!.ripple;
    if (!rp) {
      w.done = true;
      return;
    }
    if ((rp.key === 'steal' || rp.key === 'drunk') && shielded(c.r, p)) {
      note(c, p, { kind: 'blocked', reason: 'shielded' });
      w.done = true;
    }
    if (rp.key === 'shuffle') w.done = true;
  },
  prompt: (c, p, w) => {
    const rp = c.r.night!.ripple!;
    const as = c.r.players[p]!.night;
    const num = (n: number) => playerNumbered(c.r.order, n)!;
    switch (rp.key) {
      case 'view-1':
      case 'view-2':
      case 'dual-view':
        return setPrompt(as, 'ripple-view', fromSet(c, p, rp.from), 1, rp.key === 'view-1' ? 1 : 2);
      case 'insomniac':
        return shielded(c.r, p) ? null : prompt(as, 'ripple-own', { players: pickPlayers([p]) });
      case 'troublemaker':
        return prompt(as, 'ripple-swap', {
          players: pickPlayers(
            rp.between.map(num).filter((q) => !shielded(c.r, q)),
            2,
            2,
          ),
        });
      case 'steal':
        return setPrompt(as, 'ripple-steal', fromSet(c, p, rp.from), 1, 1);
      case 'drunk':
        return setPrompt(as, 'ripple-drunk', fromSet(c, p, rp.from), 1, 1, true);
      case 'witch': {
        if (w.stage === 'give') {
          const ids = playersIn(c.r.order, rp.from, p).filter((q) => !shielded(c.r, q));
          return prompt(as, 'ripple-give', { players: pickPlayers(ids), mandatory: true });
        }
        return prompt(as, 'ripple-witch', { center: { slots: centreSlots(c.r), min: 1, max: 1 } });
      }
      case 'reveal': {
        const target = rp.target === 'yourself' ? p : neighbour(c.r, p, rp.target);
        const card = c.r.cards[target]!;
        return prompt(as, 'ripple-reveal', {
          players: pickPlayers(shielded(c.r, target) || card.faceUp ? [] : [target]),
        });
      }
      default:
        return null;
    }
  },
  act: (c, p, w, a) => {
    const rp = c.r.night!.ripple!;
    switch (rp.key) {
      case 'view-1':
      case 'view-2':
      case 'dual-view':
        for (const q of a.players ?? []) see(c, p, { player: q });
        for (const i of a.center ?? []) see(c, p, { center: i });
        break;
      case 'insomniac':
        note(c, p, { kind: 'saw-own', role: c.r.cards[p]!.role });
        touch(c, p);
        break;
      case 'troublemaker':
        return ACTIONS.troublemaker!.act(c, p, w, a);
      case 'steal':
      case 'drunk': {
        const slot = picked(a);
        const faces = moved(c.r, { player: p }, slot);
        swap(c.r, { player: p }, slot);
        if (rp.key === 'steal')
          note(c, p, { kind: 'took', slot, role: c.r.cards[p]!.role }, { moved: faces });
        else note(c, p, { kind: 'swapped', a: { player: p }, b: slot }, { moved: faces });
        touch(c, p);
        break;
      }
      case 'witch':
        if (w.stage !== 'give') {
          const i = a.center![0]!;
          see(c, p, { center: i });
          w.centre = [i];
          w.stage = 'give';
          if (!playersIn(c.r.order, rp.from, p).some((q) => !shielded(c.r, q))) {
            note(c, p, { kind: 'blocked', reason: 'no-target' });
            w.done = true;
          }
          return;
        } else {
          const from = { center: w.centre[0]! };
          const to = a.players![0]!;
          const faces = moved(c.r, from, { player: to });
          swap(c.r, from, { player: to });
          note(c, p, { kind: 'gave', from, to }, { moved: faces });
        }
        break;
      case 'reveal':
        return ACTIONS.revealer!.act(c, p, w, a);
      default:
        break;
    }
    w.done = true;
  },
};

/** The ripple at the end of the night: chosen, announced, and the parts that just happen. */
function startRipple(c: StepCtx) {
  const r = c.r;
  const night = r.night!;
  const n = r.order.length;
  const present = r.order.flatMap((p, i) => (r.players[p]!.left ? [] : [i + 1]));
  const rp = pickRipple({
    rng: c.rng,
    n,
    present,
    weights: c.settings.weights,
    roles: c.settings.roles,
    guaranteed: r.oracle?.ripple === true,
  });
  night.ripple = rp;
  if (rp.key === 'none') {
    night.timeline.push({ step: c.step, stepId: c.def.id, by: null, note: { kind: 'nobody' } });
    return;
  }
  announce(c, { kind: 'ripple', ripple: rp });
  const named = (set: PlayerSet) => playersIn(r.order, set, null);
  const rules = (r.rules ??= {});
  switch (rp.key) {
    case 'one-minute':
      r.daySeconds = Math.min(r.daySeconds ?? c.settings.daySeconds, 60);
      break;
    case 'vote-for-app':
      rules.voteApp = true;
      break;
    case 'two-hand-vote':
      rules.twoVotes = named(rp.who);
      break;
    case 'i-am-alien':
    case 'face-away':
    case 'no-speak':
      (rules.restrictions ??= []).push({ kind: rp.key, players: named(rp.who) });
      break;
    case 'repeat-role':
      night.plan.push(`${REPEAT}${repeatStepOf(rp.role)}`);
      break;
    case 'repeat-night':
    case 'repeat-observer': {
      night.loopFrom = night.plan.length;
      night.loopFeared = r.order.filter((p) => feared(r, p));
      night.plan.push(...buildNightPlan(c.settings.roles, { loop: true }));
      if (rp.key === 'repeat-observer') {
        const who = playerNumbered(r.order, rp.observer);
        if (who) (r.observers ??= []).push(who);
      }
      break;
    }
    default:
      break;
  }
}

/** The ripple's shuffle: the two see both cards, then the cards are shuffled between them. */
function shuffleRipple(c: StepCtx) {
  const rp = c.r.night!.ripple;
  if (rp?.key !== 'shuffle') return;
  const [a, b] = rp.players.map((n) => playerNumbered(c.r.order, n)!) as [PlayerId, PlayerId];
  if (shielded(c.r, a) || shielded(c.r, b)) {
    for (const p of [a, b])
      if (c.r.night!.actors.includes(p)) note(c, p, { kind: 'blocked', reason: 'shielded' });
    return;
  }
  const ra = c.r.cards[a]!.role;
  const rb = c.r.cards[b]!.role;
  const faces = moved(c.r, { player: a }, { player: b });
  const swapped = c.rng.int(2) === 0;
  if (swapped) swap(c.r, { player: a }, { player: b });
  for (const [p, mine, theirs, other] of [
    [a, ra, rb, b],
    [b, rb, ra, a],
  ] as const)
    if (c.r.night!.actors.includes(p)) {
      note(
        c,
        p,
        { kind: 'shuffled', with: other, mine, theirs },
        p === a && swapped ? { moved: faces } : {},
      );
      touch(c, p);
    }
}

/** Every card and Mark a timeline entry touched (what an open-eyed watcher sees). */
function touchedIn(e: TimelineEntry): { slots: Slot[]; marks: PlayerId[] } {
  const slots: Slot[] = (e.moved ?? []).map((m) => m.slot);
  const n = e.note;
  if (n.kind === 'saw' || n.kind === 'snatched' || n.kind === 'took') slots.push(n.slot);
  if (n.kind === 'revealed' || n.kind === 'shielded' || n.kind === 'artifact-placed')
    slots.push({ player: n.target });
  if (n.kind === 'exposed') slots.push({ center: n.center });
  return { slots, marks: (e.marks ?? []).map((m) => m.player) };
}

/** Players with their eyes open see who woke this step and what they touched. */
function watch(c: StepCtx) {
  const night = c.r.night!;
  // From the step after they opened their eyes.
  if (c.def.id === 'ripple' || c.def.id === 'oracle') return;
  const entries = night.timeline.filter((t) => t.step === c.step && t.by !== null);
  const slots = new Map<string, Slot>();
  const marks = new Set<PlayerId>();
  for (const e of entries) {
    const t = touchedIn(e);
    for (const s of t.slots) slots.set(JSON.stringify(s), s);
    for (const m of t.marks) marks.add(m);
  }
  for (const o of c.r.observers ?? []) {
    if (c.r.players[o]!.left || night.actors.includes(o)) continue;
    note(
      c,
      o,
      {
        kind: 'watched',
        stepId: c.def.id,
        awake: night.actors.filter((q) => q !== o),
        touched: [...slots.values()],
        marks: [...marks],
      },
      { quiet: true },
    );
  }
}

/** Steps whose random part is drawn as they begin, from their role's table. */
function drawPick(c: StepCtx) {
  const night = c.r.night!;
  const role =
    c.def.id === 'aliens' || (c.def.repeat && c.def.role === 'alien') ? 'alien' : c.def.role;
  if (!TABLE_OF[role] || (role === 'oracle' && c.def.doppel)) return;
  // A repeat does again what the role was told before ("whatever you did, do it again"), with
  // fresh choices: it reuses the original step's instruction.
  const before = c.def.repeat
    ? night.picks?.[night.plan.indexOf(c.def.id.slice(REPEAT.length))]
    : null;
  const pick =
    (before ? structuredClone(before) : null) ??
    pickFor(role, {
      rng: c.rng,
      n: c.r.order.length,
      weights: c.settings.weights,
      roles: c.settings.roles,
      oracleExchange: role === 'alien' && c.r.oracle?.exchange === true,
    });
  if (!pick) return;
  (night.picks ??= {})[c.step] = pick;
  night.timeline.push({ step: c.step, stepId: c.def.id, by: null, note: { kind: 'told', pick } });
  if (pick.kind === 'oracle')
    c.r.oracle = {
      question: pick.question,
      answer: null,
      outcome: null,
      mod: null,
      numberFail: false,
      centre: false,
      exchange: false,
      ripple: false,
    };
}

/** Before anyone wakes: the step's random part, and what the narrator announces at once. */
function prepareStep(c: StepCtx) {
  if (c.def.id === 'ripple') return startRipple(c);
  if (c.def.id === 'blob') {
    const shape = evenly(c.rng, blobOptions(c.r.order.length));
    c.r.blob = shape;
    announce(c, { kind: 'blob', shape });
    return;
  }
  drawPick(c);
}

/** Once the actors are known, before each acts: the parts of a step that just happen. */
function startStep(c: StepCtx) {
  if (c.def.id === 'aliens' || (c.def.repeat && c.def.role === 'alien')) startAliens(c);
  if (c.def.id === 'groob-zerb') startGroobZerb(c);
  if (c.def.id === 'ripple') shuffleRipple(c);
}

/** At the end of a step, after its actors: what the narrator says when time is up. */
function finishStep(c: StepCtx) {
  const night = c.r.night!;
  if (c.def.role === 'nostradamus' && !c.def.repeat) {
    const actors = night.actors.filter((q) => c.r.players[q]!.night === 'nostradamus');
    if (actors.length) for (const p of actors) foretell(c, p);
    else
      foretell(
        c,
        null,
        actorsFor(c.r, c.def, true).filter((q) => c.r.players[q]!.night === 'nostradamus'),
      );
  }
  if (c.def.id === 'oracle') endOracle(c);
  // Fists nobody tapped learn so as the aliens close their eyes.
  const pick = pickOf(c);
  if (pick?.kind === 'alien' && pick.fists)
    for (const q of night.actors)
      if (fistOf(c, q) && !(c.r.notes[q] ?? []).some((n) => n.step === c.step && n.kind === 'fist'))
        note(
          c,
          q,
          { kind: 'fist', tapped: false, helper: pick.action === 'alien-helper' },
          { quiet: true },
        );
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
      settle(c, p, w, roleAction(role));
      return;
    }
    // A copied Minion sees the werewolves' thumbs at the end of her step.
    if (mode === 'minion') thumbsBegin('werewolves')(c, p, w);
    w.done = true;
  },
};

let alienSet: Partial<Record<RoleId, RoleAction>> | null = null;
const roleAction = (role: RoleId): RoleAction =>
  ACTIONS[role] ?? (alienSet ??= alienActions())[role] ?? nothing;

/** In a time loop, a Doppelgänger who copied a role she acted at once does it again. */
const doppelLoop: RoleAction = {
  ...doppelganger,
  begin: (c, p, w) => {
    const role = c.r.players[p]!.night;
    w.stage = 'act';
    w.as = role;
    const mode = ROLES[role].doppel;
    if (mode === 'immediate') {
      roleAction(role).begin?.(c, p, w);
      settle(c, p, w, roleAction(role));
      return;
    }
    if (mode === 'minion') thumbsBegin('werewolves')(c, p, w);
    w.done = true;
  },
};

/** The action a player takes in the current step. */
function actionFor(c: StepCtx, p: PlayerId): RoleAction {
  if (c.def.id === 'doppelganger')
    return c.r.players[p]!.night === 'doppelganger' ? doppelganger : doppelLoop;
  if (c.def.id === 'dusk') return dusk;
  if (c.def.id === 'lovers') return lovers;
  if (c.def.id === 'ripple') return rippleAction;
  if (c.def.id === 'aliens' || (c.def.repeat && c.def.role === 'alien')) {
    if ((c.r.night!.aliens ?? []).includes(p)) return alien;
    return fistOf(c, p) ? fist : cow;
  }
  if (c.def.id === 'groob-zerb') return groobZerb;
  if (c.def.role === 'empath' && !c.def.repeat) return isEmpath(c, p) ? empath : pointer;
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
  prepareStep(c);
  night.actors = actorsFor(c.r, c.def);
  night.work = Object.fromEntries(
    night.actors.map((p) => [p, { stage: 'start', picks: [], centre: [], done: false }]),
  );
  // Players the Mark of Fear keeps asleep learn at daybreak that they slept through their turn.
  const asleep = actorsFor(c.r, c.def, true).filter((p) => !night.actors.includes(p));
  for (const p of asleep) {
    const body: NoteBody = { kind: 'feared', role: c.r.players[p]!.night };
    (c.r.dawn[p] ??= []).push(body);
    night.timeline.push({ step: c.step, stepId: c.def.id, by: p, note: body });
  }
  if (night.actors.length === 0) {
    const said = night.timeline.some((t) => t.step === c.step);
    if (!asleep.length && !said)
      night.timeline.push({ step: c.step, stepId: c.def.id, by: null, note: { kind: 'nobody' } });
    return;
  }
  startStep(c);
  for (const p of night.actors) {
    const w = night.work[p]!;
    if (w.done) continue;
    actionFor(c, p).begin?.(c, p, w);
    settle(c, p, w, actionFor(c, p));
  }
}

/** A prompt that offers nothing to pick. */
const empty = (pr: Prompt) => !pr.players && !pr.center && !pr.sides && !pr.choices;

/**
 * After an action begins: done if it has nothing left to ask, and told so plainly if it can't
 * choose anyone at all (every card it could pick is shielded, say).
 */
function settle(c: StepCtx, p: PlayerId, w: StepWork, action: RoleAction) {
  if (w.done) return;
  const pr = action.prompt(c, p, w);
  if (!pr) {
    w.done = true;
    return;
  }
  if (empty(pr)) {
    note(c, p, { kind: 'blocked', reason: 'no-target', role: pr.as });
    w.done = true;
  }
}

/** A player's choice in the current step. */
export function actInStep(c: StepCtx, p: PlayerId, a: NightAction): GameError | null {
  const night = c.r.night!;
  const w = night.work[p];
  if (!w) return new GameError('not-your-step', 'It isn’t your turn to act.');
  // The vampires choose together: a fellow vampire's pick may land a moment before yours. Yours
  // simply arrives too late to count, which is no mistake on your part.
  if (w.done && c.def.id === 'vampires' && night.vampireTarget) return null;
  if (w.done && night.aliens?.includes(p) && night.alienTarget) return null;
  if (w.done) return new GameError('done', 'You’ve already acted this step.');
  const action = actionFor(c, p);
  const pr = action.prompt(c, p, w);
  if (!pr) return new GameError('done', 'There is nothing to do now.');
  if (a.point) {
    // Pointing, before anyone confirms: the other vampires see who you have in mind.
    if (c.def.id !== 'vampires') return new GameError('bad-pick', 'There is nobody to show.');
    const target = a.players?.[0] ?? null;
    if ((a.players?.length ?? 0) > 1 || (target && !pr.players?.ids.includes(target)))
      return new GameError('bad-target', 'You can’t choose that card.');
    w.picks = target ? [target] : [];
    return null;
  }
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
        const action = actionFor(c, p);
        if (action.timeout) action.timeout(c, p);
        // Say they did nothing, unless they did something earlier in the step.
        else if (
          !(c.r.notes[p] ?? []).some(
            (n) => n.step === c.step && n.kind !== 'group' && n.kind !== 'told',
          )
        )
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
  finishStep(c);
  watch(c);
}
