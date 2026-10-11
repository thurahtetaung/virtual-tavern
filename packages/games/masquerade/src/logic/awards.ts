import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  leaders,
  mostBy,
  num,
  nums,
  ph,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Award rules for Masquerade and its back-room edition (they share `defineMasquerade`, so they
 * share this module). Location values are names in the public game and ids (`e1-07`) in the back
 * room: they always go out as `{loc:…}` placeholders, which the browser names (falling back to
 * the text itself, which is already the name in the public game).
 */

interface RoundEvents {
  round: RecapEvent;
  spies: RecapEvent[];
  votes: RecapEvent[];
}

/** Each revealed round with its spy and vote events (insights report them together). */
export function roundsOf(g: GameEvents): RoundEvents[] {
  const out: RoundEvents[] = [];
  for (const e of g.events) {
    if (e.type === 'round') out.push({ round: e, spies: [], votes: [] });
    else if (e.type === 'spy') out.at(-1)?.spies.push(e);
    else if (e.type === 'vote') out.at(-1)?.votes.push(e);
  }
  return out;
}

const outcome = (e: RecapEvent) => str(e, 'outcome');
const spyIds = (r: RoundEvents) => r.spies.flatMap((s) => (s.playerId ? [s.playerId] : []));
const location = (r: RoundEvents) => str(r.round, 'location');

/** Votes each target drew in a round. */
function received(r: RoundEvents): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of r.votes) {
    const t = str(v, 'target');
    if (t) out.set(t, (out.get(t) ?? 0) + 1);
  }
  return out;
}

/** Back-room location ids look like `e1-07`. */
const ORIGINAL_ID = /^e(\d+)-\d+$/;

const masterOfDisguise: AwardRule = {
  id: 'masquerade.master-of-disguise',
  emoji: '🎭',
  title: 'Master of Disguise',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'spy',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} won {n|time} as the spy. Trust no one', '{who} got away with it {n|time}'],
    wholesome: ['{who} was a brilliant spy, {n|time}', '{who} won {n|time} as the spy'],
  },
  compute: (g) =>
    mostBy(g.of('spy').filter((s) => outcome(s) === 'escaped' || outcome(s) === 'stole')),
};

const ghost: AwardRule = {
  id: 'masquerade.ghost',
  emoji: '🫥',
  title: 'Ghost',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'spy',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} was the spy and got zero votes', '{who} spied in plain sight. 0 votes'],
    wholesome: ['{who} blended in perfectly: no votes at all', '{who} was the spy and nobody knew'],
  },
  compute: (g) =>
    mostBy(g.of('spy').filter((s) => outcome(s) === 'escaped' && num(s, 'votes') === 0)),
};

const thief: AwardRule = {
  id: 'masquerade.last-second-thief',
  emoji: '🦊',
  title: 'Last-Second Thief',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'spy',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} got caught, then named {loc}. Daylight robbery',
      '{who} was caught and stole it anyway',
    ],
    wholesome: ['{who} turned it around: {loc}, first try', '{who} was caught, then guessed {loc}'],
  },
  compute(g) {
    const stole = g.of('spy').filter((s) => outcome(s) === 'stole');
    const [top] = mostBy(stole);
    if (!top) return [];
    const last = stole.findLast((s) => s.playerId === top.players[0]);
    const loc = str(last, 'location');
    return [{ ...top, ...(loc ? { params: { loc } } : {}) }];
  },
};

const bloodhound: AwardRule = {
  id: 'masquerade.bloodhound',
  emoji: '🐕',
  title: 'Bloodhound',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'voting',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} sniffed out the spy {n} times', '{who} smelled a spy {n} times. Good nose'],
    wholesome: ['{who} trusted their gut and was right {n} times', '{who} found the spy {n} times'],
  },
  compute: (g) =>
    mostBy(
      g.of('vote').filter((v) => bool(v, 'hit') === true),
      undefined,
      { min: 2 },
    ),
};

const usualSuspect: AwardRule = {
  id: 'masquerade.usual-suspect',
  emoji: '🙋',
  title: 'Usual Suspect',
  valence: 'gentle',
  weight: 3,
  kind: 'award',
  family: 'suspicion',
  minPlayers: 3,
  copy: {
    cheeky: [
      "{who} got {n} votes and wasn't even the spy",
      '{who} drew {n} votes. Innocent, honest',
    ],
    wholesome: [
      "The table couldn't stop watching {who}: {n} votes",
      '{who} drew {n} votes as a local',
    ],
  },
  compute(g) {
    const tally = new Map<string, number>();
    for (const r of roundsOf(g)) {
      const spies = spyIds(r);
      for (const [t, n] of received(r))
        if (!spies.includes(t)) tally.set(t, (tally.get(t) ?? 0) + n);
    }
    return leaders(tally, { min: 2 });
  },
};

const contrarian: AwardRule = {
  id: 'masquerade.contrarian',
  emoji: '🧭',
  title: 'Contrarian',
  wholesomeTitle: 'Free Thinker',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'voting',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} voted for someone nobody else picked, {n|time}',
      '{who} went it alone {n|time}',
    ],
    wholesome: [
      '{who} always had their own theory, {n|time}',
      '{who} trusted their own read {n|time}',
    ],
  },
  compute(g) {
    const lone: RecapEvent[] = [];
    for (const r of roundsOf(g)) {
      const counts = received(r);
      for (const v of r.votes) if (counts.get(str(v, 'target') ?? '') === 1) lone.push(v);
    }
    return mostBy(lone, undefined, { min: 2 });
  },
};

const goWithTheFlow: AwardRule = {
  id: 'masquerade.go-with-the-flow',
  emoji: '🐑',
  title: 'Go With the Flow',
  wholesomeTitle: 'Team Player',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'voting',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} voted with the crowd all {n} rounds',
      '{who} followed the herd {n} rounds running',
    ],
    wholesome: [
      '{who} was a great team player, {n} rounds',
      '{who} stood with the table all {n} rounds',
    ],
  },
  compute(g) {
    const withCrowd = new Map<string, number>();
    const voted = new Map<string, number>();
    for (const r of roundsOf(g)) {
      const counts = received(r);
      const top = Math.max(0, ...counts.values());
      for (const v of r.votes) {
        if (!v.playerId) continue;
        voted.set(v.playerId, (voted.get(v.playerId) ?? 0) + 1);
        if (top > 1 && counts.get(str(v, 'target') ?? '') === top)
          withCrowd.set(v.playerId, (withCrowd.get(v.playerId) ?? 0) + 1);
      }
    }
    const rounds = roundsOf(g).length;
    const all = new Map(
      [...withCrowd].filter(([id, n]) => n === rounds && voted.get(id) === rounds && n >= 3),
    );
    return leaders(all, { min: 3 });
  },
};

const spyWhisperer: AwardRule = {
  id: 'masquerade.spy-whisperer',
  emoji: '🎯',
  title: 'Spy Whisperer',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'voting',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} hit the spy in all {n} rounds. Suspicious',
      '{who} was right {n} rounds out of {n}',
    ],
    wholesome: [
      '{who} read every spy perfectly, {n} rounds',
      '{who} found the spy every round ({n})',
    ],
  },
  compute(g) {
    const votes = new Map<string, { n: number; hit: number }>();
    for (const v of g.of('vote')) {
      if (!v.playerId) continue;
      const s = votes.get(v.playerId) ?? { n: 0, hit: 0 };
      s.n += 1;
      if (bool(v, 'hit') === true) s.hit += 1;
      votes.set(v.playerId, s);
    }
    const perfect = new Map(
      [...votes].filter(([, s]) => s.n >= 3 && s.hit === s.n).map(([id, s]) => [id, s.n]),
    );
    return leaders(perfect, { min: 3 });
  },
};

const soClose: AwardRule = {
  id: 'masquerade.so-close',
  emoji: '🕳️',
  title: 'So Close',
  wholesomeTitle: 'Valiant Spy',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'spy',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} got caught and the guess missed, {n|time}',
      '{who} was caught red-handed {n|time}',
    ],
    wholesome: ['{who} gave it their all as the spy', '{who} played the spy bravely, {n|time}'],
  },
  compute: (g) => mostBy(g.of('spy').filter((s) => outcome(s) === 'caught')),
};

const partners: AwardRule = {
  id: 'masquerade.partners-in-crime',
  emoji: '🤝',
  title: 'Partners in Crime',
  valence: 'glory',
  weight: 5,
  kind: 'pair',
  family: 'spy',
  minPlayers: 7,
  copy: {
    cheeky: ['{a} & {b}: two spies, zero consequences', '{a} & {b} both got away. Partners'],
    wholesome: ['{a} & {b} made a perfect spy duo', '{a} & {b} both won as spies, together'],
  },
  compute(g) {
    for (const r of roundsOf(g).reverse()) {
      if (r.spies.length === 2 && r.spies.every((s) => outcome(s) !== 'caught'))
        return [{ players: spyIds(r).sort(), value: 1 }];
    }
    return [];
  },
};

const topScorer: AwardRule = {
  id: 'masquerade.top-scorer',
  emoji: '🏆',
  title: 'Top Scorer',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'score',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} ended on {n} points. Smug', '{who} topped the table with {n}'],
    wholesome: ['{who} topped the table with {n} points', '{who} finished first on {n} points'],
  },
  compute(g) {
    const o = g.of('outcome').at(-1);
    const ids = strs(o, 'ranking');
    const scores = nums(o, 'scores');
    if (!ids.length || ids.length !== scores.length) return [];
    return leaders(new Map(ids.map((id, i) => [id, scores[i]!])));
  },
};

const spyMagnet: AwardRule = {
  id: 'masquerade.spy-magnet',
  emoji: '🔁',
  title: 'Spy Magnet',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'fate',
  minPlayers: 3,
  nightOnly: true,
  copy: {
    cheeky: ['The deck made {who} the spy {n} times', '{who} was the spy {n} times. Rigged?'],
    wholesome: ['Fate chose {who} as the spy {n} times', '{who} drew the spy card {n} times'],
  },
  computeNight: (games) =>
    mostBy(
      games.flatMap((g) => g.of('spy')),
      undefined,
      { min: 2 },
    ),
};

/** "2m 10s" or "45s". */
const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

/** How long each round lasted, from the previous reveal (or the start). */
function roundLengths(g: GameEvents): { round: number; ms: number }[] {
  let prev = g.startedAt;
  return g.of('round').map((r, i) => {
    const ms = r.ts - prev;
    prev = r.ts;
    return { round: num(r, 'round') ?? i + 1, ms };
  });
}

const speedRound: AwardRule = {
  id: 'masquerade.speed-round',
  emoji: '⏱️',
  title: 'Speed Round',
  valence: 'gentle',
  weight: 1,
  kind: 'moment',
  family: 'speed',
  minPlayers: 3,
  copy: {
    cheeky: ['Round {r} lasted {t}. Someone cracked', 'Round {r} was over in {t}. Blink and miss'],
    wholesome: ['The quickest round: {t}, round {r}', 'Round {r} wrapped up in just {t}'],
  },
  compute(g) {
    const lengths = roundLengths(g).filter((l) => l.ms > 0);
    if (lengths.length < 2) return [];
    const best = lengths.reduce((a, b) => (b.ms < a.ms ? b : a));
    return [{ players: [], value: 1, params: { r: best.round, t: span(best.ms) } }];
  },
};

const unanimous: AwardRule = {
  id: 'masquerade.unanimous-catch',
  emoji: '🗳️',
  title: 'Unanimous',
  valence: 'gentle',
  weight: 3,
  kind: 'moment',
  family: 'suspicion',
  minPlayers: 4,
  copy: {
    cheeky: ['All {n} locals pointed at {who}. Busted', '{who} was the spy. All {n} votes knew it'],
    wholesome: [
      'All {n} locals agreed: {who} was the spy',
      'A clean read: {n} votes, all on {who}',
    ],
  },
  compute(g) {
    for (const r of roundsOf(g).reverse()) {
      const spies = spyIds(r);
      if (spies.length !== 1) continue;
      const locals = r.votes.filter((v) => !spies.includes(v.playerId ?? ''));
      const players = num(r.round, 'players') ?? 0;
      if (
        locals.length >= 3 &&
        locals.length === players - 1 &&
        locals.every((v) => bool(v, 'hit'))
      )
        return [{ players: spies, value: locals.length }];
    }
    return [];
  },
};

const chaosVote: AwardRule = {
  id: 'masquerade.chaos-vote',
  emoji: '🌪️',
  title: 'Chaos Vote',
  wholesomeTitle: 'Open Minds',
  valence: 'gentle',
  weight: 3,
  kind: 'moment',
  family: 'suspicion',
  minPlayers: 4,
  copy: {
    cheeky: [
      'Round {r}: {n} votes, {n} different suspects',
      'Round {r}: everyone suspected someone else',
    ],
    wholesome: [
      'Round {r}: {n} votes, {n} different theories',
      'Round {r} had everyone thinking differently',
    ],
  },
  compute(g) {
    for (const r of roundsOf(g).reverse()) {
      const counts = received(r);
      if (r.votes.length >= 4 && counts.size === r.votes.length)
        return [{ players: [], value: r.votes.length, params: { r: num(r.round, 'round') ?? 0 } }];
    }
    return [];
  },
};

const grandTour: AwardRule = {
  id: 'masquerade.grand-tour',
  emoji: '🗺️',
  title: 'Grand Tour',
  valence: 'gentle',
  weight: 2,
  kind: 'team',
  family: 'travel',
  minPlayers: 3,
  nightOnly: true,
  copy: {
    cheeky: [
      'The table visited {n} locations tonight. Jet-lagged',
      '{n} locations in one night. Passports full',
    ],
    wholesome: [
      'The table explored {n} places together',
      'A night of travel: {n} locations visited',
    ],
  },
  computeNight(games) {
    const ids = new Set(
      games.flatMap((g) => g.of('round').flatMap((r) => str(r, 'location') ?? [])),
    );
    const originals = [...ids].filter((id) => ORIGINAL_ID.test(id));
    if (originals.length < 5) return [];
    const players = [...new Set(games.flatMap((g) => g.players))].sort();
    return [{ players, value: originals.length }];
  },
};

export const MASQUERADE_RULES: AwardRule[] = [
  masterOfDisguise,
  ghost,
  thief,
  bloodhound,
  usualSuspect,
  contrarian,
  goWithTheFlow,
  spyWhisperer,
  soClose,
  partners,
  topScorer,
  spyMagnet,
  speedRound,
  unanimous,
  chaosVote,
  grandTour,
];

const allOf = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));

const nuggets: NuggetRule[] = [
  {
    id: 'masquerade.rounds',
    emoji: '🎲',
    interest: 2,
    compute(games) {
      const n = allOf(games, 'round').length;
      return n ? { value: n, text: `${n} rounds played` } : null;
    },
  },
  {
    id: 'masquerade.spy-wins',
    emoji: '🕵️',
    interest: 3,
    compute(games) {
      const spies = allOf(games, 'spy');
      if (spies.length < 2) return null;
      const won = spies.filter((s) => outcome(s) !== 'caught').length;
      return { value: won, text: `Spies won ${won} of ${spies.length}` };
    },
  },
  {
    id: 'masquerade.hit-rate',
    emoji: '🎯',
    interest: 2,
    compute(games) {
      const votes = allOf(games, 'vote');
      if (votes.length < 3) return null;
      const pct = Math.round((votes.filter((v) => bool(v, 'hit')).length / votes.length) * 100);
      return { value: pct, text: `${pct}% of votes found a spy` };
    },
  },
  {
    id: 'masquerade.votes',
    emoji: '🗳️',
    interest: 1,
    compute(games) {
      const n = allOf(games, 'vote').length;
      return n ? { value: n, text: `${n} votes cast` } : null;
    },
  },
  {
    id: 'masquerade.top-location',
    emoji: '📍',
    interest: 2,
    compute(games) {
      const counts = new Map<string, number>();
      for (const r of allOf(games, 'round')) {
        const loc = str(r, 'location');
        if (loc) counts.set(loc, (counts.get(loc) ?? 0) + 1);
      }
      const [top] = [...counts].sort((a, b) => b[1] - a[1]);
      return top && top[1] >= 2
        ? { value: top[1], text: `Most visited: ${ph.loc(top[0])} ×${top[1]}` }
        : null;
    },
  },
  {
    id: 'masquerade.quickest',
    emoji: '⏱️',
    interest: 2,
    compute(games) {
      const lengths = games.flatMap((g) => roundLengths(g).map((l) => l.ms)).filter((ms) => ms > 0);
      if (lengths.length < 2) return null;
      const ms = Math.min(...lengths);
      return { value: ms, text: `Quickest round: ${span(ms)}` };
    },
  },
  {
    // Back room only: how many rounds each edition supplied.
    id: 'masquerade.editions',
    emoji: '📚',
    interest: 1,
    compute(games) {
      const per = new Map<string, number>();
      for (const r of allOf(games, 'round')) {
        const m = ORIGINAL_ID.exec(str(r, 'location') ?? '');
        if (m) per.set(m[1]!, (per.get(m[1]!) ?? 0) + 1);
      }
      if (!per.size) return null;
      const parts = [...per].sort().map(([e, n]) => `Edition ${e} ×${n}`);
      return { value: per.size, text: parts.join(' · ') };
    },
  },
];

const FATE: Record<string, string> = { escaped: 'escaped', stole: 'stole it', caught: 'caught' };

/** One line per round: where it was, who spied, and how it went. */
function history(g: GameEvents): string[] {
  const lines = roundsOf(g).map((r, i) => {
    const n = num(r.round, 'round') ?? i + 1;
    const loc = location(r);
    const spies = r.spies.map((s) =>
      `${s.playerId ? ph.p(s.playerId) : 'a spy'} ${FATE[outcome(s) ?? ''] ?? ''}`.trim(),
    );
    const who = spies.length ? spies.join(', ') : 'the spy';
    return `Round ${n}${loc ? ` · ${ph.loc(loc)}` : ''}: spy ${who}`;
  });
  return lines.length > 12
    ? [...lines.slice(0, 11), `…and ${lines.length - 11} more rounds`]
    : lines;
}

export const masqueradeAwards: AwardModule = { rules: MASQUERADE_RULES, nuggets, history };
