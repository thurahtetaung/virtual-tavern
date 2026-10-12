import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  count,
  leaders,
  mostBy,
  num,
  nums,
  str,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Award rules for Round Table. They read only what its insights report: votes and teams (public
 * once revealed), quest results as counts, and roles, the assassination and Lady results at the
 * end. Nothing here ever says who played which quest card.
 */

const outcomeOf = (g: GameEvents) => g.of('outcome').at(-1);
const reason = (g: GameEvents) => str(outcomeOf(g), 'reason');
const winner = (g: GameEvents) => str(outcomeOf(g), 'winner');

/** Each seat's role and side, from the outcome (falling back to the `player` events). */
function sides(g: GameEvents): { role: Map<string, string>; side: Map<string, string> } {
  const role = new Map<string, string>();
  const side = new Map<string, string>();
  const o = outcomeOf(g);
  const seats = strs(o, 'seats');
  const roles = strs(o, 'roles');
  const sideList = strs(o, 'sides');
  seats.forEach((id, i) => {
    if (roles[i]) role.set(id, roles[i]);
    if (sideList[i]) side.set(id, sideList[i]);
  });
  for (const e of g.of('player')) {
    if (!e.playerId) continue;
    const r = str(e, 'role');
    const s = str(e, 'side');
    if (r && !role.has(e.playerId)) role.set(e.playerId, r);
    if (s && !side.has(e.playerId)) side.set(e.playerId, s);
  }
  return { role, side };
}

const holderOf = (g: GameEvents, role: string) =>
  [...sides(g).role].flatMap(([id, r]) => (r === role ? [id] : []));

const one = (players: string[]): AwardCandidate[] =>
  players.length ? [{ players: [...players].sort(), value: 1 }] : [];

const hiddenInPlainSight: AwardRule = {
  id: 'round-table.hidden-in-plain-sight',
  emoji: '🧙',
  title: 'Hidden in Plain Sight',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'merlin',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} was Merlin all along. The Assassin had no idea',
      '{who} knew it all and hid it',
    ],
    wholesome: [
      '{who} guided Good as Merlin and stayed hidden',
      '{who} was a wise, well-hidden Merlin',
    ],
  },
  compute: (g) => (reason(g) === 'assassin-missed' ? one(holderOf(g, 'merlin')) : []),
};

const perfectStrike: AwardRule = {
  id: 'round-table.perfect-strike',
  emoji: '🗡️',
  title: 'Perfect Strike',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'merlin',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} named Merlin in one shot. Brutal', '{who} lost the quests and won anyway'],
    wholesome: ['{who} read the table and found Merlin', '{who} turned the game around at the end'],
  },
  compute(g) {
    const hit = g.of('assassination').find((a) => bool(a, 'hit') === true);
    return hit?.playerId ? [{ players: [hit.playerId], value: 1 }] : [];
  },
};

/** Approved proposals whose quest then succeeded. */
function cleanCalls(g: GameEvents): RecapEvent[] {
  const quests = new Map(g.of('quest').map((q) => [num(q, 'round'), bool(q, 'success')]));
  return g
    .of('proposal')
    .filter((p) => bool(p, 'approved') && quests.get(num(p, 'round')) === true);
}

const silverTongue: AwardRule = {
  id: 'round-table.silver-tongue',
  emoji: '🎭',
  title: 'Silver Tongue',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'evil',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} was Evil and still got on {n} clean quests',
      '{who} was trusted {n} times. Oops',
    ],
    wholesome: [
      '{who} played Evil so well they joined {n} quests',
      '{who} won the table’s trust {n} times',
    ],
  },
  compute(g) {
    const { side } = sides(g);
    return mostBy(cleanCalls(g), (p) => strs(p, 'team').filter((id) => side.get(id) === 'evil'), {
      min: 2,
    });
  },
};

const bloodhound: AwardRule = {
  id: 'round-table.bloodhound',
  emoji: '🕵️',
  title: 'Bloodhound',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'voting',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} voted down {n} teams with a traitor aboard', '{who} smelled Evil on {n} teams'],
    wholesome: [
      '{who} spotted Evil on {n} teams and said no',
      '{who} trusted their gut on {n} teams',
    ],
  },
  compute(g) {
    const { side } = sides(g);
    const t = new Map<string, number>();
    for (const p of g.of('proposal')) {
      if (!strs(p, 'team').some((id) => side.get(id) === 'evil')) continue;
      for (const id of strs(p, 'rejecters'))
        if (side.get(id) === 'good') t.set(id, (t.get(id) ?? 0) + 1);
    }
    return leaders(t, { min: 2 });
  },
};

const yesMan: AwardRule = {
  id: 'round-table.yes-man',
  emoji: '👍',
  title: 'Yes-Man',
  wholesomeTitle: 'Eternal Optimist',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'voting',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} approved all {n} teams. Never met a team they disliked',
      '{who} said yes {n} times out of {n}',
    ],
    wholesome: [
      '{who} believed in every team, all {n} of them',
      '{who} gave all {n} teams a chance',
    ],
  },
  compute(g) {
    const proposals = g.of('proposal');
    if (proposals.length < 4) return [];
    const yes = tally(proposals, (p) =>
      strs(p, 'approvers').filter((id) => !strs(p, 'autoVoters').includes(id)),
    );
    return leaders(new Map([...yes].filter(([, n]) => n === proposals.length)), { min: 4 });
  },
};

const contrarian: AwardRule = {
  id: 'round-table.contrarian',
  emoji: '🙅',
  title: 'Contrarian',
  wholesomeTitle: 'Careful Judge',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'voting',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} rejected {n} teams. Nobody was good enough',
      '{who} said no {n} times. Tough crowd',
    ],
    wholesome: [
      '{who} weighed every team: {n} rejections',
      '{who} held out for the right team {n} times',
    ],
  },
  compute: (g) => mostBy(g.of('proposal'), (p) => strs(p, 'rejecters'), { min: 3 }),
};

const kingmaker: AwardRule = {
  id: 'round-table.kingmaker',
  emoji: '👑',
  title: 'Kingmaker',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'leading',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} sent {n} teams that came home clean. Smug', '{who} picked {n} winning teams'],
    wholesome: ['{who} chose {n} teams that succeeded', '{who} led the way on {n} winning quests'],
  },
  compute: (g) => mostBy(cleanCalls(g), undefined, { min: 2 }),
};

const saboteur: AwardRule = {
  id: 'round-table.saboteur',
  emoji: '💣',
  title: 'Saboteur',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'evil',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} was Evil on {n} quests that went up in smoke',
      '{who} was aboard {n} sunk quests',
    ],
    wholesome: [
      '{who} served Evil on {n} quests that sank',
      '{who} played Evil boldly on {n} quests',
    ],
  },
  compute(g) {
    const { side } = sides(g);
    return mostBy(
      g.of('quest').filter((q) => bool(q, 'success') === false),
      (q) => strs(q, 'team').filter((id) => side.get(id) === 'evil'),
      { min: 2 },
    );
  },
};

const ladysFavourite: AwardRule = {
  id: 'round-table.ladys-favourite',
  emoji: '🌊',
  title: 'Lady’s Favourite',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'lady',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} used the Lady and caught Evil {n|time}', '{who} checked a traitor {n|time}'],
    wholesome: ['{who} found Evil with the Lady {n|time}', '{who} made the Lady count {n|time}'],
  },
  compute(g) {
    const o = outcomeOf(g);
    const holders = strs(o, 'ladyHolders');
    const evil = nums(o, 'ladyEvil');
    const t = new Map<string, number>();
    holders.forEach((id, i) => {
      if (evil[i] === 1) t.set(id, (t.get(id) ?? 0) + 1);
    });
    return leaders(t);
  },
};

const onTheHammer: AwardRule = {
  id: 'round-table.on-the-hammer',
  emoji: '🔨',
  title: 'On the Hammer',
  valence: 'gentle',
  weight: 3,
  kind: 'award',
  family: 'leading',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} made a fifth proposal with the game on the line',
      '{who} held the hammer {n|time}',
    ],
    wholesome: [
      '{who} led under pressure: a fifth proposal',
      '{who} stepped up for a last proposal {n|time}',
    ],
  },
  compute: (g) => mostBy(g.of('proposal').filter((p) => num(p, 'attempt') === 5)),
};

const mordredsShadow: AwardRule = {
  id: 'round-table.mordreds-shadow',
  emoji: '🌙',
  title: 'Mordred’s Shadow',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'evil',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} was Mordred and Merlin never saw it coming', '{who} won as Mordred, unseen'],
    wholesome: ['{who} led Evil to victory as Mordred', '{who} played a masterful Mordred'],
  },
  compute: (g) => (winner(g) === 'evil' ? one(holderOf(g, 'mordred')) : []),
};

const oberonAlone: AwardRule = {
  id: 'round-table.oberon-alone',
  emoji: '🤡',
  title: 'Oberon Alone',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'evil',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} was Oberon, knew nobody, and won anyway',
      '{who} played Evil blindfolded and won',
    ],
    wholesome: [
      '{who} won for Evil as Oberon, all alone',
      '{who} found their own way to win as Oberon',
    ],
  },
  compute: (g) => (winner(g) === 'evil' ? one(holderOf(g, 'oberon')) : []),
};

const percivalsGuard: AwardRule = {
  id: 'round-table.percivals-guard',
  emoji: '🛡️',
  title: 'Percival’s Guard',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'merlin',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} was Percival and Merlin walked out alive',
      '{who} kept Merlin safe as Percival',
    ],
    wholesome: ['{who} protected Merlin as Percival', '{who} was a loyal shield for Merlin'],
  },
  compute: (g) => (reason(g) === 'assassin-missed' ? one(holderOf(g, 'percival')) : []),
};

export const ROUND_TABLE_RULES: AwardRule[] = [
  hiddenInPlainSight,
  perfectStrike,
  silverTongue,
  bloodhound,
  yesMan,
  contrarian,
  kingmaker,
  saboteur,
  ladysFavourite,
  onTheHammer,
  mordredsShadow,
  oberonAlone,
  percivalsGuard,
];

const allOf = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));
const finished = (games: readonly GameEvents[]) => games.filter((g) => g.of('outcome').length > 0);

/** "12m 30s" or "45s". */
const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

const nuggets: NuggetRule[] = [
  {
    id: 'round-table.sides',
    emoji: '⚖️',
    interest: 3,
    compute(games) {
      const outcomes = allOf(games, 'outcome');
      if (!outcomes.length) return null;
      const good = outcomes.filter((o) => str(o, 'winner') === 'good').length;
      return {
        value: good,
        text: `${count(outcomes.length, 'game')}: Good won ${good}, Evil ${outcomes.length - good}`,
      };
    },
  },
  {
    id: 'round-table.longest-standoff',
    emoji: '🔨',
    interest: 3,
    record: 'max',
    compute(games) {
      const most = Math.max(0, ...allOf(games, 'outcome').map((o) => num(o, 'streak') ?? 0));
      return most >= 2 ? { value: most, text: `Most rejections in a row: ${most}` } : null;
    },
  },
  {
    id: 'round-table.fewest-proposals',
    emoji: '🤝',
    interest: 2,
    record: 'min',
    compute(games) {
      const counts = allOf(games, 'outcome')
        .map((o) => num(o, 'proposals'))
        .filter((n): n is number => n !== undefined && n > 0);
      if (!counts.length) return null;
      const n = Math.min(...counts);
      return { value: n, text: `Fewest proposals in a game: ${n}` };
    },
  },
  {
    id: 'round-table.assassin-rate',
    emoji: '🗡️',
    interest: 3,
    compute(games) {
      const tries = allOf(games, 'assassination');
      if (!tries.length) return null;
      const hits = tries.filter((a) => bool(a, 'hit')).length;
      return {
        value: hits,
        text: `The Assassin found Merlin ${hits} of ${count(tries.length, 'time')}`,
      };
    },
  },
  {
    id: 'round-table.fails-per-quest',
    emoji: '💣',
    interest: 2,
    compute(games) {
      const quests = allOf(games, 'quest');
      if (quests.length < 2) return null;
      const total = quests.reduce((s, q) => s + (num(q, 'fails') ?? 0), 0);
      const avg = Math.round((total / quests.length) * 10) / 10;
      return { value: avg, text: `Sabotage per quest: ${avg} Fail cards on average` };
    },
  },
  {
    id: 'round-table.quickest-win',
    emoji: '⏱️',
    interest: 2,
    record: 'min',
    compute(games) {
      const lengths = finished(games)
        .map((g) => g.endedAt - g.startedAt)
        .filter((ms) => ms > 0);
      if (!lengths.length) return null;
      const ms = Math.min(...lengths);
      return { value: ms, text: `Quickest win: ${span(ms)}` };
    },
  },
  {
    id: 'round-table.clean-sweeps',
    emoji: '✨',
    interest: 3,
    compute(games) {
      const sweeps = allOf(games, 'outcome').filter(
        (o) =>
          (num(o, 'successes') === 3 && num(o, 'failures') === 0) ||
          (num(o, 'failures') === 3 && num(o, 'successes') === 0),
      ).length;
      return sweeps ? { value: sweeps, text: `Clean sweeps (3–0): ${sweeps}` } : null;
    },
  },
];

const HOW: Record<string, string> = {
  quests: 'three quests',
  'assassin-missed': 'assassin missed',
  fails: 'three quests sunk',
};

/** One line for the game: "Good 3–2 · assassin missed", or "Evil by 5 rejections". */
function history(g: GameEvents): string[] {
  const o = outcomeOf(g);
  const w = str(o, 'winner');
  const r = str(o, 'reason');
  if (!w || !r) return [];
  const side = w === 'good' ? 'Good' : 'Evil';
  if (r === 'rejections') return [`${side} by 5 rejections`];
  const s = num(o, 'successes') ?? 0;
  const f = num(o, 'failures') ?? 0;
  if (r === 'assassin-hit') return [`Evil · Merlin assassinated after Good went ${s}–${f}`];
  const score = w === 'good' ? `${s}–${f}` : `${f}–${s}`;
  return [`${side} ${score} · ${HOW[r] ?? r}`];
}

export const roundTableAwards: AwardModule = { rules: ROUND_TABLE_RULES, nuggets, history };
