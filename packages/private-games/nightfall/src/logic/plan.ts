import { MARK_ROLES, ROLES, type RoleId, hostileGroupsIn, marksInUse } from './roles.ts';
import { TABLE_OF, ripplesIn } from './tables.ts';

/**
 * The night's steps. Each step is called when its role is *selected*, whether or not a player
 * holds that card, and lasts the same time either way, so the clock never tells anyone where
 * the cards are. The plan is a pure function of the selected roles, so every device can work it
 * out from the public settings: `view()` never needs to say which step is running.
 *
 * `order` sorts the steps; it follows the narrator's wake codes (the code is kept for reference).
 * Gaps leave room for later sets' steps (aliens, villains) to slot in between. Negative orders are
 * the dusk (the Vampire set's evening, before anyone sees their Mark): Fear doesn't reach them.
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
  /** A fixed length factor (the dusk's Mark look and the lovers aren't anybody's role). */
  factor?: number;
  /** Skipped in a time loop (the Oracle, the Blob's announcement, the ripple itself). */
  noLoop?: boolean;
  /** A ripple's "repeat your night action": the role's step again, after the ripple. */
  repeat?: boolean;
}

/** Steps before this order are the dusk: a Mark of Fear doesn't stop anyone acting in them. */
export const NIGHT_ORDER = 0;

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
const count = own('the-count', '-6B', -580);
const renfield = own('renfield', '-6D', -560);
const priest = own('priest', '-2', -200);
const assassin = own('assassin', '-1', -100);
const apprentice = own('apprentice-assassin', '-1B', -90);
const marksman = own('marksman', '5D', 540);
const bodySnatcher = own('body-snatcher', '1F', 160);
const leader = own('leader', '3C', 330);
const nostradamus = own('nostradamus', '5E', 550);
const psychic = own('psychic', '5G', 570);
const rascal = own('rascal', '7F', 760);
const exposer = own('exposer', '10B', 1020);
const empath = own('empath', '10E', 1040);
const mortician = own('mortician', '13A', 1320);

/** The roles that wake in the aliens' step (and, with any of them, the night ends in a ripple). */
const ALIEN_ROLES: RoleId[] = ['alien', 'synthetic-alien', 'groob', 'zerb', 'body-snatcher'];
const pickpocket = own('pickpocket', '6C', 640);
const gremlin = own('gremlin', '7D', 740);

/** The narrator's dusk plays when any of these is in: everyone then looks at their Mark. */
const DUSK_ROLES: RoleId[] = [
  'vampire',
  'the-master',
  'the-count',
  'diseased',
  'cupid',
  'instigator',
  'priest',
  'assassin',
  'apprentice-assassin',
];

export const STEPS: StepDef[] = (
  [
    { ...own('oracle', '-9', -900), noLoop: true },
    own('copycat', '-8', -800),
    own('doppelganger', '-7', -700),
    {
      id: 'vampires',
      code: '-6',
      order: -600,
      role: 'vampire',
      when: has('vampire', 'the-master', 'the-count'),
    },
    count,
    doppelAfter(count, '-6Ba'),
    renfield,
    doppelAfter(renfield, '-6-Ca'),
    own('diseased', '-5', -500),
    own('cupid', '-4', -400),
    own('instigator', '-3', -300),
    priest,
    doppelAfter(priest, '-2a'),
    assassin,
    // The app's order: Assassin, Apprentice (the Assassin still awake), her copy, then his.
    apprentice,
    doppelAfter(apprentice, '-1-Ba'),
    { ...doppelAfter(assassin, '-1a'), order: -85 },
    { id: 'dusk', code: '-1D', order: -50, role: 'villager', factor: 1, when: has(...DUSK_ROLES) },
    { id: 'lovers', code: '00', order: -40, role: 'cupid', factor: 1, when: has('cupid') },
    own('sentinel', '0B', 20),
    // The Cow puts out her fist inside this step (and the Doppelgänger's copy of her).
    { id: 'aliens', code: '1A', order: 100, role: 'alien', factor: 2, when: has(...ALIEN_ROLES) },
    { id: 'groob-zerb', code: '1D', order: 130, role: 'groob', when: all('groob', 'zerb') },
    bodySnatcher,
    doppelAfter(bodySnatcher, '1Fa'),
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
    leader,
    doppelAfter(leader, '3Ca'),
    { ...own('mason', '4', 400) },
    own('thing', '4B', 420),
    own('seer', '5', 500),
    own('apprentice-seer', '5B', 520),
    own('paranormal-investigator', '5C', 530),
    marksman,
    doppelAfter(marksman, '5Da'),
    nostradamus,
    doppelAfter(nostradamus, '5Ea'),
    psychic,
    doppelAfter(psychic, '5Ga'),
    own('robber', '6', 600),
    own('witch', '6B', 620),
    pickpocket,
    doppelAfter(pickpocket, '6Ca'),
    own('troublemaker', '7', 700),
    own('village-idiot', '7B', 720),
    auraSeer,
    doppelAfter(auraSeer, '7Ca'),
    gremlin,
    doppelAfter(gremlin, '7Da'),
    rascal,
    doppelAfter(rascal, '7Fa'),
    own('drunk', '8', 800),
    insomniac,
    doppelAfter(insomniac, '9a'),
    squire,
    doppelAfter(squire, '9Ca'),
    beholder,
    doppelAfter(beholder, '9Za'),
    revealer,
    doppelAfter(revealer, '10a'),
    exposer,
    doppelAfter(exposer, '10Ba'),
    empath,
    doppelAfter(empath, '10Ea'),
    curator,
    doppelAfter(curator, '11a'),
    // The Blob doesn't wake: the narrator announces its members (a Doppelgänger copy, if any,
    // is a Blob of the same shape round her own card).
    { ...own('blob', '13', 1300), factor: 1, noLoop: true },
    mortician,
    doppelAfter(mortician, '13Aa'),
    {
      id: 'ripple',
      code: '20',
      order: 2000,
      role: 'alien',
      factor: 2,
      noLoop: true,
      when: (sel) => ripplesIn([...sel]),
    },
  ] satisfies StepDef[]
).sort((a, b) => a.order - b.order);

export type StepId = string;

const BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/** A ripple's "repeat your night action": `repeat:<step id>`. */
export const REPEAT = 'repeat:';
/** The step a role repeats in a ripple (the Alien repeats the aliens' step). */
export const repeatStepOf = (role: RoleId): StepId => (role === 'alien' ? 'aliens' : role);

export const stepDef = (id: StepId): StepDef => {
  if (id.startsWith(REPEAT)) {
    const base = stepDef(id.slice(REPEAT.length));
    // Same role and time as its step (Fear stops even a dusk role's repeat: the Mark is seen by then).
    return { ...base, id, code: '20R', repeat: true, noLoop: true, when: () => false };
  }
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown night step ${id}`);
  return def;
};

/**
 * The night's steps for these selected roles, in wake order. In a time loop (`loop`), the
 * Oracle, the Blob's announcement and the ripple don't come round again.
 */
export function buildNightPlan(roles: readonly RoleId[], opts: { loop?: boolean } = {}): StepId[] {
  const selected = new Set(roles);
  return STEPS.filter((s) => s.when(selected) && !(opts.loop && s.noLoop)).map((s) => s.id);
}

/**
 * Tonight's steps as every device can work them out: the cards' steps, then whatever the ripple
 * added (a time loop round the night again, or one role's repeat). The engine's plan grows the
 * same way when the ripple is announced.
 */
export function publicPlan(
  roles: readonly RoleId[],
  announcements: readonly { kind: string; ripple?: { key: string; role?: RoleId } }[] = [],
): StepId[] {
  const plan = buildNightPlan(roles);
  const ripple = announcements.find((a) => a.kind === 'ripple')?.ripple;
  if (ripple?.key === 'repeat-night' || ripple?.key === 'repeat-observer')
    plan.push(...buildNightPlan(roles, { loop: true }));
  if (ripple?.key === 'repeat-role' && ripple.role)
    plan.push(`${REPEAT}${repeatStepOf(ripple.role)}`);
  return plan;
}

/**
 * The role whose table a step's random instruction is drawn from (the Alien set), or null when
 * the narrator has none for it. A ripple's repeat reuses its step's instruction.
 */
export function pickRoleOf(id: StepId): RoleId | null {
  const def = stepDef(id);
  const role = def.id === 'aliens' || (def.repeat && def.role === 'alien') ? 'alien' : def.role;
  if (!TABLE_OF[role] || (role === 'oracle' && def.doppel)) return null;
  return role;
}

/** How long a step lasts, as a multiple of the step length (complex roles get double). */
export function stepFactor(id: StepId): number {
  const def = stepDef(id);
  if (def.factor) return def.factor;
  return ROLES[def.role].complex || (def.role === 'doppelganger' && !def.doppel) ? 2 : 1;
}

/** Whether a step is in the dusk, before the Marks are seen (Fear doesn't apply). */
export const isDusk = (id: StepId) => stepDef(id).order < NIGHT_ORDER;

/** How long a step lasts in ms. The Village Idiot always gets at least 5 s extra. */
export function stepMs(id: StepId, stepSeconds: number): number {
  const ms = stepFactor(id) * stepSeconds * 1000;
  return stepDef(id).role === 'village-idiot' ? Math.max(ms, (stepSeconds + 5) * 1000) : ms;
}

/** Length of every step in ms, in plan order. */
export const stepDurations = (plan: readonly StepId[], stepSeconds: number) =>
  plan.map((id) => stepMs(id, stepSeconds));

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
  // Steps the narrator has no lines of its own for: a ripple's repeat (the ripple said it), the
  // Blob and the ripple (their lines are announcements, made as they happen).
  if (def.repeat || id === 'blob' || id === 'ripple') return { open: [], close: [] };
  const key =
    id === 'werewolves'
      ? 'werewolf'
      : id === 'vampires'
        ? 'vampire'
        : id === 'aliens'
          ? 'alien'
          : def.doppel
            ? `doppelganger:${def.role}`
            : id;
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
  if (id === 'vampires' && selected.has('renfield')) close[0] = 'vampire:close:renfield';
  if (def.role === 'aura-seer' && marksInUse(roles)) open[0] = `${key}:wake:marks`;
  // The Assassin stays awake while the Apprentice Assassin (and her copy) look for him.
  const withAssassin = selected.has('assassin');
  if (id === 'assassin' && selected.has('apprentice-assassin')) close.length = 0;
  if (def.role === 'apprentice-assassin' && withAssassin) {
    open[0] = `${key}:wake:with-assassin`;
    const last = selected.has('doppelganger') ? def.doppel === true : !def.doppel;
    if (last) {
      if (def.doppel) close.push('assassin:close');
      else close[0] = 'assassin:close:with-apprentice';
    }
  }
  if (def.role === 'renfield' && hostileGroupsIn(roles).includes('vampire')) {
    const last = selected.has('doppelganger') ? def.doppel === true : !def.doppel;
    if (last) close.push('renfield:hands-away');
  }
  // The Cow (and the Doppelgänger's copy of her) puts out a fist while the aliens are awake.
  if (id === 'aliens' && selected.has('cow')) {
    const dg = selected.has('doppelganger');
    open.push('cow:wake', ...(dg ? ['doppelganger:cow:wake'] : []));
    close.unshift('cow:close', ...(dg ? ['doppelganger:cow:close'] : []));
  }
  if (def.role === 'leader') {
    const gz = selected.has('groob') && selected.has('zerb');
    close.unshift(
      'leader:thumbs-away',
      ...(gz ? [`${key}:groob-zerb`, 'leader:groob-zerb:thumbs-away'] : []),
    );
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
  epicBattle: 'night:epic-battle',
  nightStart: 'night:start',
  nightEnd: 'night:end',
  nightEndMarks: 'night:end:marks',
  dayStart: 'day:start',
  oneMinute: 'day:1-minute-left',
  thirtySeconds: 'day:30-seconds-left',
  vote: 'vote:start',
} as const;

/** Whether these roles make Marks part of the game (every player gets a Mark of Clarity). */
export const usesMarks = marksInUse;

/** More than one evil team can be at the table: the narrator announces an epic battle. */
export const epicPossible = (roles: readonly RoleId[]) => hostileGroupsIn(roles).length >= 2;

export { MARK_ROLES };
