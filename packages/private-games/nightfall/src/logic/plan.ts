import { ROLES, type RoleId } from './roles.ts';

/**
 * The night's steps. Each step is called when its role is *selected*, whether or not a player
 * holds that card, and lasts the same time either way, so the clock never tells anyone where
 * the cards are. The plan is a pure function of the selected roles, so every device can work it
 * out from the public settings: `view()` never needs to say which step is running.
 *
 * `order` sorts the steps; it follows the narrator's wake codes (the code is kept for reference).
 * Gaps leave room for later sets' steps (dusk, aliens, villains) to slot in between.
 */
export interface StepDef {
  id: string;
  /** The narrator's wake code, for reference: "-7", "2B", "9a"… */
  code: string;
  order: number;
  /** The role whose players wake (for the werewolves' step, the werewolves). */
  role: RoleId;
  /** A Doppelgänger re-wake: only a Doppelgänger who copied `role` acts. */
  doppel?: boolean;
  /** Whether the step runs for this selection of roles. */
  when: (selected: ReadonlySet<RoleId>) => boolean;
}

const has =
  (...roles: RoleId[]) =>
  (s: ReadonlySet<RoleId>) =>
    roles.some((r) => s.has(r));
const all =
  (...roles: RoleId[]) =>
  (s: ReadonlySet<RoleId>) =>
    roles.every((r) => s.has(r));

/** A role's own step: runs whenever the role is selected. */
const own = (role: RoleId, code: string, order: number): StepDef => ({
  id: role,
  code,
  order,
  role,
  when: has(role),
});

/** The Doppelgänger's own re-wake right after `role`'s step. */
const doppelAfter = (base: StepDef, code: string): StepDef => ({
  id: `doppelganger-${base.role}`,
  code,
  order: base.order + 1,
  role: base.role,
  doppel: true,
  when: (s) => s.has('doppelganger') && base.when(s),
});

const apprenticeTanner: StepDef = {
  ...own('apprentice-tanner', '3B', 320),
  // He only wakes when there is a Tanner to look for.
  when: all('apprentice-tanner', 'tanner'),
};
const auraSeer = own('aura-seer', '7C', 730);
const insomniac = own('insomniac', '9', 900);
const squire = own('squire', '9C', 930);
const beholder: StepDef = {
  ...own('beholder', '9Z', 990),
  // Only when there is a seer to behold.
  when: (s) => s.has('beholder') && (s.has('seer') || s.has('apprentice-seer')),
};
const revealer = own('revealer', '10', 1000);
const curator = own('curator', '11', 1100);

export const STEPS: StepDef[] = (
  [
    own('doppelganger', '-7', -700),
    own('sentinel', '0B', 20),
    {
      id: 'werewolves',
      code: '2',
      order: 200,
      role: 'werewolf',
      when: has('werewolf', 'alpha-wolf', 'mystic-wolf'),
    },
    own('alpha-wolf', '2B', 220),
    own('mystic-wolf', '2C', 230),
    own('minion', '3', 300),
    apprenticeTanner,
    doppelAfter(apprenticeTanner, '-3-Ba'),
    { ...own('mason', '4', 400) },
    own('thing', '4B', 420),
    own('seer', '5', 500),
    own('apprentice-seer', '5B', 520),
    own('paranormal-investigator', '5C', 530),
    own('robber', '6', 600),
    own('witch', '6B', 620),
    own('troublemaker', '7', 700),
    own('village-idiot', '7B', 720),
    auraSeer,
    doppelAfter(auraSeer, '7Ca'),
    own('drunk', '8', 800),
    insomniac,
    doppelAfter(insomniac, '9a'),
    squire,
    doppelAfter(squire, '9Ca'),
    beholder,
    doppelAfter(beholder, '9Za'),
    revealer,
    doppelAfter(revealer, '10a'),
    curator,
    doppelAfter(curator, '11a'),
  ] satisfies StepDef[]
).sort((a, b) => a.order - b.order);

export type StepId = string;

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));
export const stepDef = (id: StepId): StepDef => {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown night step ${id}`);
  return def;
};

/** The night's steps for these selected roles, in wake order. */
export function buildNightPlan(roles: readonly RoleId[]): StepId[] {
  const selected = new Set(roles);
  return STEPS.filter((s) => s.when(selected)).map((s) => s.id);
}

/** How long a step lasts, as a multiple of the step length (complex roles get double). */
export function stepFactor(id: StepId): number {
  const def = stepDef(id);
  return ROLES[def.role].complex || (def.role === 'doppelganger' && !def.doppel) ? 2 : 1;
}

/** Length of every step in ms, in plan order. */
export const stepDurations = (plan: readonly StepId[], stepSeconds: number) =>
  plan.map((id) => stepFactor(id) * stepSeconds * 1000);

// ---- Narration ----

/**
 * The narration of a step, as keys into the manifest's `narration` map (key → clip paths). Keys
 * follow `<step>:<phase>[:<variant>]`: `seer:wake`, `seer:close`, `doppelganger:insomniac:wake`,
 * `werewolf:wake:dream-wolf`… The wake lines play as the step starts, the close lines just
 * before it ends. The UI shows matching text whether or not there is audio.
 */
export interface StepLines {
  open: string[];
  close: string[];
}

/** Roles whose "thumbs away" line follows the Doppelgänger's re-wake when she is in the game. */
const THUMBS_AWAY = new Set<RoleId>(['apprentice-tanner', 'squire', 'aura-seer', 'beholder']);

export function stepLines(
  id: StepId,
  roles: readonly RoleId[],
  opts: { loneWolf: boolean },
): StepLines {
  const selected = new Set(roles);
  const def = stepDef(id);
  const key = id === 'werewolves' ? 'werewolf' : def.doppel ? `doppelganger:${def.role}` : id;
  const beholder =
    def.role !== 'beholder'
      ? ''
      : selected.has('seer') && selected.has('apprentice-seer')
        ? ':both-seers'
        : selected.has('seer')
          ? ''
          : ':apprentice-seer';
  const open = [`${key}:wake${beholder}`];
  const close = [`${key}:close`];
  if (id === 'werewolves') {
    if (selected.has('dream-wolf')) {
      open[0] = 'werewolf:wake:dream-wolf';
      close[0] = 'werewolf:close:dream-wolf';
    }
    if (opts.loneWolf) open.push('werewolf:lone-wolf');
  }
  if (id === 'doppelganger' && selected.has('minion'))
    close.unshift('doppelganger:minion:wake', 'doppelganger:minion:thumbs-away');
  if (id === 'minion') close.unshift('minion:thumbs-away');
  if (THUMBS_AWAY.has(def.role)) {
    const last = selected.has('doppelganger') ? def.doppel === true : !def.doppel;
    if (last) close.push(`${def.role}:thumbs-away${beholder}`);
  }
  return { open, close };
}

/** Lines outside the steps. */
export const FRAME_LINES = {
  nightStart: 'night:start',
  nightEnd: 'night:end',
  dayStart: 'day:start',
  oneMinute: 'day:1-minute-left',
  thirtySeconds: 'day:30-seconds-left',
  vote: 'vote:start',
} as const;
