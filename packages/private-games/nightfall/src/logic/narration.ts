import { createRng } from '@vt/game-sdk';
import {
  FRAME_LINES,
  type StepId,
  buildNightPlan,
  epicPossible,
  pickRoleOf,
  stepDef,
  stepLines,
  stepMs,
} from './plan.ts';
import type { RoleId } from './roles.ts';
import { type PlayerSet, type StepPick, blobKey, pickFor } from './tables.ts';
import { type Announcement, NIGHT_INTRO_MS, type PublicNote, type Settings } from './types.ts';

// What the narrator says, as narration keys (into the manifest's `narration` map), and how long
// the night's steps last when they are stretched to fit it. Every device works out the same
// words from the public view, and the engine the same lengths, so neither needs to know who
// holds which card.

/**
 * A piece of what the narrator says: a line of its own, a step's random instruction, or an
 * announcement. Each knows its narration keys; the screen words each its own way.
 */
export type CuePart =
  | { kind: 'line'; key: string }
  | { kind: 'pick'; pick: StepPick; doppel?: boolean }
  | { kind: 'announcement'; announcement: Announcement };

/** The narration keys of a part. */
export function partLines(part: CuePart): string[] {
  switch (part.kind) {
    case 'line':
      return [part.key];
    case 'pick':
      return pickLines(part.pick);
    case 'announcement':
      return announcementLines(part.announcement);
  }
}

/** Player numbers, spoken: "player:3", joined by `and` or `or`. */
const spoken = (ns: readonly number[], joiner: 'and' | 'or') =>
  ns.flatMap((n, i) => (i ? [`fragment:${joiner}`, `player:${n}`] : [`player:${n}`]));

/** A set of players, as the narrator's fragments ("Any even player", "the centre"…). */
function setLines(set: PlayerSet, group: boolean): string[] {
  switch (set.kind) {
    case 'everyone':
      return ['fragment:everyone'];
    case 'any':
      return ['fragment:any-player'];
    case 'even':
      return [group ? 'fragment:even-players' : 'fragment:any-even-player'];
    case 'odd':
      return [group ? 'fragment:odd-players' : 'fragment:any-odd-player'];
    case 'numbers':
      return spoken(set.numbers, group ? 'and' : 'or');
    case 'center':
      return ['fragment:center'];
    case 'neighbours':
      return ['fragment:either-neighbor'];
    case 'both-neighbours':
      return ['fragment:both-neighbors'];
    case 'left':
      return ['fragment:left-neighbor'];
    case 'right':
      return ['fragment:right-neighbor'];
    case 'yourself':
      return ['fragment:yourself'];
    // Only the Rascal's swap names these: two players higher, lower, to the left or the right.
    case 'higher':
      return ['fragment:two-higher'];
    case 'lower':
      return ['fragment:two-lower'];
    case 'two-left':
      return ['fragment:two-left'];
    case 'two-right':
      return ['fragment:two-right'];
  }
}

/**
 * The narration keys for a step's random instruction, in the order the narrator says them (right
 * after the step's wake line): the action, then whose cards, then how it ends.
 */
export function pickLines(pick: StepPick): string[] {
  switch (pick.kind) {
    case 'alien':
      switch (pick.action) {
        case 'view':
        case 'all-view':
          return [`alien:action:${pick.action}`, ...(pick.from ? setLines(pick.from, false) : [])];
        case 'new-alien':
        case 'alien-helper':
          // "Even players, put a fist out. Aliens, tap one of the fists…"
          return [...(pick.fists ? setLines(pick.fists, true) : []), `alien:action:${pick.action}`];
        default:
          return [`alien:action:${pick.action}`];
      }
    case 'oracle':
      return [`oracle:question:${pick.question}`];
    case 'body-snatcher':
      if (pick.action === 'pretend') return ['body-snatcher:action:pretend'];
      return [
        `body-snatcher:action:${pick.action}`,
        ...(pick.action === 'steal' && pick.from ? setLines(pick.from, false) : []),
        'body-snatcher:end',
      ];
    case 'psychic':
      return [`psychic:action:view-${pick.count}`, ...setLines(pick.from, false)];
    case 'rascal': {
      const action = `rascal:action:${pick.action}`;
      if (pick.action === 'idiot') return [action];
      const from = pick.from ? setLines(pick.from, false) : [];
      if (pick.action === 'troublemaker') return [action, ...from];
      return [action, ...from, `${action}:end`];
    }
    case 'exposer':
      return [`exposer:action:flip-${pick.count}`];
    case 'mortician':
      return [
        `mortician:action:${pick.action}`,
        ...(pick.from && pick.action !== 'pretend' ? setLines(pick.from, false) : []),
      ];
    case 'empath':
      // "Odd players, keep your eyes closed and point at…"
      return [...setLines(pick.who, true), `empath:prompt:${pick.prompt}`];
  }
}

/** The narration keys for an announcement, in the order they are said. */
export function announcementLines(a: Announcement): string[] {
  switch (a.kind) {
    case 'oracle-parity':
      return [`oracle:answer:${a.parity}`];
    case 'oracle-view':
      return [`oracle:answer:view-player:${a.swapped ? 'other' : 'yes'}`, `player:${a.number}`];
    case 'oracle-number':
      return [`oracle:answer:number:${a.right ? 'right' : 'wrong'}`];
    case 'nostradamus':
      return [
        a.doppel ? 'doppelganger:nostradamus:announce' : 'nostradamus:announce',
        `nostradamus:team:${a.team}`,
      ];
    case 'blob':
      return [
        `blob:members:${blobKey(a.shape)}`,
        a.shape.left + a.shape.right === 1 ? 'blob:end:one' : 'blob:end:many',
      ];
    case 'ripple': {
      const rp = a.ripple;
      const intro = 'ripple:intro';
      switch (rp.key) {
        case 'none':
          return [];
        case 'one-minute':
          return [intro, 'ripple:event:one-minute'];
        case 'vote-for-app':
          return [intro, 'ripple:event:vote-for-app'];
        case 'repeat-role':
          return [intro, `name:${rp.role}`, 'ripple:event:repeat-role'];
        case 'i-am-alien':
        case 'face-away':
        case 'two-hand-vote':
        case 'no-speak':
          return [intro, ...setLines(rp.who, true), `ripple:event:${rp.key}`];
        case 'view-1':
        case 'view-2':
          return [
            intro,
            `player:${rp.actor}`,
            `ripple:event:${rp.key}`,
            ...setLines(rp.from, false),
          ];
        case 'dual-view':
          return [
            intro,
            ...spoken(rp.actors, 'and'),
            'ripple:event:view-2',
            ...setLines(rp.from, false),
          ];
        case 'insomniac':
          return [intro, ...spoken(rp.actors, 'and'), 'ripple:event:insomniac'];
        case 'troublemaker':
          return [
            intro,
            `player:${rp.actor}`,
            'ripple:event:troublemaker',
            ...spoken(rp.between, 'and'),
            'ripple:event:troublemaker:end',
          ];
        case 'steal':
        case 'drunk':
          return [
            intro,
            `player:${rp.actor}`,
            `ripple:event:${rp.key}`,
            ...setLines(rp.from, false),
            `ripple:event:${rp.key}:end`,
          ];
        case 'witch':
          return [intro, `player:${rp.actor}`, 'ripple:event:witch', ...setLines(rp.from, false)];
        case 'reveal':
          return [
            intro,
            `player:${rp.actor}`,
            'ripple:event:reveal',
            rp.target === 'yourself' ? 'fragment:yourself' : `fragment:${rp.target}-neighbor`,
            'ripple:event:reveal:end',
          ];
        case 'shuffle': {
          const other = rp.players.find((n) => n !== rp.giver) ?? rp.giver;
          return [
            intro,
            ...spoken(rp.players, 'and'),
            'ripple:event:shuffle:1',
            `player:${rp.giver}`,
            'ripple:event:shuffle:2',
            `player:${other}`,
            'ripple:event:shuffle:3',
          ];
        }
        case 'repeat-night':
          return [intro, 'ripple:event:repeat-night'];
        case 'repeat-observer':
          return [
            intro,
            'ripple:event:repeat-night',
            `player:${rp.observer}`,
            'ripple:event:repeat-night:observer-end',
          ];
      }
    }
  }
}

/** The announcements made at `at` (a step's start, or the dawn), in order. */
export const saidAt = (announcements: readonly PublicNote[], at: number): CuePart[] =>
  announcements
    .filter((a) => Math.abs(a.at - at) < 500)
    .map((announcement) => ({ kind: 'announcement', announcement }));

const line = (key: string): CuePart => ({ kind: 'line', key });

/**
 * What a step says: its opening (what was announced as it began, its wake line, its random
 * instruction, then the rest of its wake) and its close. A ripple's repeat says no instruction.
 */
export function stepParts(
  id: StepId,
  s: Pick<Settings, 'roles' | 'loneWolf'>,
  opts: { pick?: StepPick | undefined; said?: readonly CuePart[] } = {},
): { open: CuePart[]; close: CuePart[] } {
  const lines = stepLines(id, s.roles, { loneWolf: s.loneWolf });
  // The instruction follows the wake line ("Aliens, wake up… Each alien may view…"), before
  // anything else the step's wake says (the Cow's fist).
  const [wake, ...after] = lines.open.map(line);
  const def = stepDef(id);
  const pick: CuePart[] =
    opts.pick && !def.repeat
      ? [{ kind: 'pick', pick: opts.pick, ...(def.doppel ? { doppel: true } : {}) }]
      : [];
  return {
    open: [...(opts.said ?? []), ...(wake ? [wake] : []), ...pick, ...after],
    close: lines.close.map(line),
  };
}

/** The night's opening lines: with werewolves and vampires both in, a warning of an epic battle. */
export const introLines = (roles: readonly RoleId[]): string[] =>
  epicPossible(roles) ? [FRAME_LINES.epicBattle, FRAME_LINES.nightStart] : [FRAME_LINES.nightStart];

// ---- Steps stretched to the narration ----

/** Lengths of the narration lines in ms, by key (the manifest's clips, timed). */
export type LineLengths = Readonly<Record<string, number>>;

/** The line lengths a night is timed by: none with narration off, so its timing is the plain one. */
export const nightLengths = (
  s: Pick<Settings, 'narration'>,
  lengths: LineLengths | undefined,
): LineLengths | undefined => (s.narration === 'off' ? undefined : lengths);

/** A step's narration ends this long before the step does, and its close this long after it. */
export const NARRATION_GAP_MS = 500;

/** How long some lines take to say. Lines with no clip take no time. */
export const saidMs = (lengths: LineLengths, lines: readonly string[]) =>
  lines.reduce((sum, key) => sum + (lengths[key] ?? 0), 0);

const partsMs = (lengths: LineLengths, parts: readonly CuePart[]) =>
  saidMs(lengths, parts.flatMap(partLines));

/** Every line the narrator could say tonight, from the night's roles: the night keeps only these. */
export function linesInPlay(
  roles: readonly RoleId[],
  lengths: LineLengths,
): Record<string, number> {
  const heads = new Set<string>([...roles, 'fragment', 'player', 'ripple', 'name', 'night']);
  const s = { roles, loneWolf: true };
  for (const id of [...buildNightPlan(roles), ...buildNightPlan(roles, { loop: true })]) {
    const lines = stepLines(id, s.roles, s);
    for (const key of [...lines.open, ...lines.close, 'werewolf:lone-wolf'])
      heads.add(key.split(':')[0]!);
  }
  return Object.fromEntries(
    Object.entries(lengths).filter(([k]) => !k.includes('@') && heads.has(k.split(':')[0]!)),
  );
}

/**
 * How long a step lasts in ms. With the narrator's lengths (narration on), it is the step's own
 * time to act plus everything it says: its opening, its close and a short gap (the Oracle's close
 * is already inside her reply's time). It depends only on public things, the step, its random
 * instruction and what was announced as it began, so a role's step lasts as long whether or not
 * anyone holds the card.
 */
export function narratedStepMs(
  id: StepId,
  s: Pick<Settings, 'roles' | 'loneWolf' | 'stepSeconds'>,
  lengths: LineLengths | null | undefined,
  opts: { pick?: StepPick | undefined; said?: readonly CuePart[] } = {},
): number {
  const ms = stepMs(id, s.stepSeconds);
  if (!lengths) return ms;
  const parts = stepParts(id, s, opts);
  const said = partsMs(lengths, parts.open) + (id === 'oracle' ? 0 : partsMs(lengths, parts.close));
  return said ? ms + said + NARRATION_GAP_MS : ms;
}

/** How long the night's opening lasts: its usual pause, or longer when the narrator needs it. */
export function introMs(roles: readonly RoleId[], lengths: LineLengths | null | undefined) {
  if (!lengths) return NIGHT_INTRO_MS;
  return Math.max(NIGHT_INTRO_MS, saidMs(lengths, introLines(roles)) + NARRATION_GAP_MS);
}

/**
 * About how long the night lasts, for the lobby. With the narrator's lengths, each instruction
 * drawn at random counts as the average of a few draws; ripples and announcements aren't counted.
 */
export function nightEstimateMs(
  s: Pick<Settings, 'roles' | 'loneWolf' | 'stepSeconds' | 'weights'>,
  lengths: LineLengths | null | undefined,
  players: number,
): number {
  const roles = s.roles;
  return buildNightPlan(roles).reduce(
    (sum, id) => {
      const role = pickRoleOf(id);
      if (!lengths || !role) return sum + narratedStepMs(id, s, lengths);
      const draws = Array.from({ length: 12 }, (_, seed) => {
        const pick = pickFor(role, {
          rng: createRng(seed + 1),
          n: Math.max(3, players),
          weights: s.weights,
          roles,
        });
        return narratedStepMs(id, s, lengths, { pick: pick ?? undefined });
      });
      return sum + Math.round(draws.reduce((a, b) => a + b, 0) / draws.length);
    },
    introMs(roles, lengths),
  );
}
