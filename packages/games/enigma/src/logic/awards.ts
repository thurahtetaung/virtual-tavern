import {
  tally,
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  bool,
  count,
  type GameEvents,
  ph,
  plain,
  leaders,
  meanBy,
  mostBy,
  type NuggetRule,
  num,
  type RecapEvent,
  seconds,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Enigma awards, read from its `insights` events: `clues` {clues, team, round} by the Encryptor,
 * `decode` {success, team, round, expired, encryptor?, voters?, guess?} for the sending team,
 * `intercept` {success, team (the intercepting team), round, encryptor?, voters?} from round 2,
 * and `outcome` {winner, round, red/blueIntercepts?, red/blueMisses?, reason?}.
 */

type Team = 'red' | 'blue';
const TEAMS: readonly Team[] = ['red', 'blue'];
const TEAM_NAME: Record<Team, string> = { red: 'Red', blue: 'Blue' };
const isTeam = (t: unknown): t is Team => t === 'red' || t === 'blue';
const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

/** Each team's players, from who sent clues and who voted. */
export function rosters(g: GameEvents): Record<Team, string[]> {
  const out: Record<Team, Set<string>> = { red: new Set(), blue: new Set() };
  for (const e of g.of('clues')) {
    const t = str(e, 'team');
    if (isTeam(t) && e.playerId) out[t].add(e.playerId);
  }
  for (const e of g.of('decode')) {
    const t = str(e, 'team');
    if (!isTeam(t)) continue;
    for (const id of strs(e, 'voters')) out[t].add(id);
    const enc = str(e, 'encryptor');
    if (enc) out[t].add(enc);
  }
  for (const e of g.of('intercept')) {
    const t = str(e, 'team');
    if (isTeam(t)) for (const id of strs(e, 'voters')) out[t].add(id);
  }
  return { red: [...out.red].sort(), blue: [...out.blue].sort() };
}

const rounds = (g: GameEvents) => Math.max(0, ...g.of('decode').map((e) => num(e, 'round') ?? 0));
const outcome = (g: GameEvents) => g.of('outcome').at(-1);
const byEncryptor = (e: RecapEvent) => str(e, 'encryptor');
const decodeFailed = (e: RecapEvent) => bool(e, 'success') === false;

/** A team award for one team: everyone on it, named by its colour. */
function teamCandidate(g: GameEvents, team: Team, value: number, extra = {}): AwardCandidate {
  return { players: rosters(g)[team], value, params: { team: TEAM_NAME[team], ...extra } };
}

/** Whole-word clues, normalised for "used twice". */
const norm = (w: string) => w.trim().toLowerCase();

const rules: AwardRule[] = [
  {
    id: 'enigma.crystal-clear',
    emoji: '📡',
    title: 'Crystal Clear',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s transmissions landed {n} for {n}",
        '{who} sent {n} codes, all received. Smooth operator',
      ],
      wholesome: [
        "{who}'s clues got through every time",
        '{who} sent {n} clear transmissions in a row',
      ],
    },
    compute: (g) => {
      const ok = tally(
        g.of('decode').filter((e) => bool(e, 'success') === true),
        byEncryptor,
      );
      const bad = tally(g.of('decode').filter(decodeFailed), byEncryptor);
      const clean = new Map([...ok].filter(([id, n]) => n >= 2 && !bad.has(id)));
      return leaders(clean, { min: 2 });
    },
  },
  {
    id: 'enigma.open-book',
    emoji: '🕵️',
    title: 'Open Book',
    wholesomeTitle: 'Crowd Pleaser',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'leak',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s clues were intercepted {n|time}. The enemy says thanks",
        "{who}'s codes got cracked {n|time}. Loud whispers",
      ],
      wholesome: [
        "{who}'s clues were so good even the rivals loved them",
        '{who} was so clear the rivals followed along, {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('intercept').filter((e) => bool(e, 'success') === true),
        byEncryptor,
      ),
  },
  {
    id: 'enigma.lost-in-translation',
    emoji: '🌫️',
    title: 'Lost in Translation',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s own team couldn't decode them, {n|time}",
        '{who} lost their own team {n|time}. Too deep',
      ],
      wholesome: [
        '{who} was a little too clever for their team',
        '{who} aimed for subtle, {n|time}. Next time, nearly',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('decode').filter((e) => decodeFailed(e) && bool(e, 'expired') !== true),
        byEncryptor,
      ),
  },
  {
    id: 'enigma.radio-silence',
    emoji: '⌛',
    title: 'Radio Silence',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'speed',
    minPlayers: 4,
    stripOnly: true,
    copy: {
      cheeky: ['{who} took their time; the clock won', '{who} took their time, {n|time}'],
      wholesome: [
        '{who} thought deeply, and the timer ran out',
        '{who} was still polishing when time ran out',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('decode').filter((e) => bool(e, 'expired') === true),
        byEncryptor,
      ),
  },
  {
    id: 'enigma.code-cracker',
    emoji: '🦉',
    title: 'Code Cracker',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'intercept',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} was in on {n} intercepts', '{who} cracked {n} enemy codes. Nosy'],
      wholesome: [
        "{who} helped crack the rivals' code {n|time}",
        '{who} spotted the pattern {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('intercept').filter((e) => bool(e, 'success') === true),
        (e) => strs(e, 'voters'),
      ),
  },
  {
    id: 'enigma.codebreakers',
    emoji: '🔐',
    title: 'Codebreakers',
    valence: 'glory',
    weight: 3,
    kind: 'team',
    family: 'intercept',
    minPlayers: 4,
    copy: {
      cheeky: ['Team {team} read the rivals like a diary', 'Team {team} intercepted {n}. Rude'],
      wholesome: ['Team {team} intercepted {n} codes', 'Team {team} cracked {n} codes together'],
    },
    compute: (g) => {
      const hits = tally(
        g.of('intercept').filter((e) => bool(e, 'success') === true),
        (e) => str(e, 'team'),
      );
      const top = leaders(hits);
      const team = top[0]?.players.length === 1 ? top[0].players[0] : undefined;
      return isTeam(team)
        ? [{ ...teamCandidate(g, team, top[0]!.value), runnerUp: top[0]!.runnerUp ?? 0 }]
        : [];
    },
  },
  {
    id: 'enigma.unbreakable',
    emoji: '🧱',
    title: 'Unbreakable',
    valence: 'glory',
    weight: 4,
    kind: 'team',
    family: 'defence',
    minPlayers: 4,
    copy: {
      cheeky: ['Team {team} was never intercepted. Rude', 'Team {team}: {n} rounds, zero leaks'],
      wholesome: ['Team {team} kept every secret', 'Team {team} kept {n} rounds of codes safe'],
    },
    compute: (g) => {
      const n = rounds(g);
      if (n < 4) return [];
      return TEAMS.filter(
        (t) =>
          !g
            .of('intercept')
            .some((e) => str(e, 'team') === other(t) && bool(e, 'success') === true),
      ).map((t) => teamCandidate(g, t, n));
    },
  },
  {
    id: 'enigma.perfect-record',
    emoji: '🎯',
    title: 'Perfect Record',
    valence: 'glory',
    weight: 4,
    kind: 'team',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        'Team {team} decoded everything. Show-offs',
        'Team {team}: {n} rounds, not one slip',
      ],
      wholesome: ['Team {team} never missed a code', 'Team {team} decoded all {n} rounds'],
    },
    compute: (g) => {
      const n = rounds(g);
      if (n < 4) return [];
      return TEAMS.filter(
        (t) => !g.of('decode').some((e) => str(e, 'team') === t && decodeFailed(e)),
      ).map((t) => teamCandidate(g, t, n));
    },
  },
  {
    id: 'enigma.first-blood',
    emoji: '🩸',
    title: 'First Blood',
    valence: 'glory',
    weight: 2,
    kind: 'team',
    family: 'intercept',
    minPlayers: 4,
    copy: {
      cheeky: ['Team {team} drew first blood in round {n}', 'Team {team} struck first, round {n}'],
      wholesome: [
        'Team {team} made the first interception',
        'Team {team} cracked the first code, round {n}',
      ],
    },
    compute: (g) => {
      const first = g.of('intercept').find((e) => bool(e, 'success') === true);
      const team = str(first, 'team');
      if (!isTeam(team)) return [];
      // Both teams intercepting in the same round is no "first".
      const round = num(first, 'round') ?? 0;
      const tied = g
        .of('intercept')
        .some(
          (e) =>
            bool(e, 'success') === true && str(e, 'team') !== team && num(e, 'round') === round,
        );
      return tied ? [] : [teamCandidate(g, team, round)];
    },
  },
  {
    id: 'enigma.speed-cipher',
    emoji: '⚡',
    title: 'Speed Cipher',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'speed',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} wrote clues in {s} s. Showing off', '{who} encrypted in {s} s flat'],
      wholesome: ['{who} encrypted lightning fast: {s} s', '{who} needed just {s} s per code'],
    },
    compute: (g) =>
      withSeconds(
        leaders(
          meanBy(g.of('clues'), (e) => num(e, 'actMs'), 2),
          { lowest: true },
        ),
      ),
  },
  {
    id: 'enigma.slow-cipher',
    emoji: '🐢',
    title: 'Slow Cipher',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'speed',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} took {s} s per transmission', '{who} spent {s} s per code. Artisanal'],
      wholesome: ['{who} weighed every word ({s} s each)', '{who} gave each code {s} s of care'],
    },
    compute: (g) => withSeconds(leaders(meanBy(g.of('clues'), (e) => num(e, 'actMs'), 2))),
  },
  {
    id: 'enigma.clue-recycler',
    emoji: '♻️',
    title: 'Clue Recycler',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'words',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} used "{w}" twice. Sustainable', '{who} said "{w}" again. Waste not'],
      wholesome: ['{who} found a clue worth repeating: "{w}"', '{who} trusted "{w}" twice'],
    },
    compute: (g) => {
      const seen = new Map<string, Map<string, number>>();
      for (const e of g.of('clues')) {
        if (!e.playerId) continue;
        const mine = seen.get(e.playerId) ?? new Map<string, number>();
        for (const w of strs(e, 'clues')) mine.set(norm(w), (mine.get(norm(w)) ?? 0) + 1);
        seen.set(e.playerId, mine);
      }
      const best = new Map<string, number>();
      const word = new Map<string, string>();
      for (const [id, words] of seen) {
        for (const [w, n] of words) {
          if (n >= 2 && n > (best.get(id) ?? 0)) {
            best.set(id, n);
            word.set(id, w);
          }
        }
      }
      return leaders(best, { min: 2 })
        .filter((c) => c.players.length === 1)
        .map((c) => ({ ...c, params: { w: plain(word.get(c.players[0]!)) } }));
    },
  },
  {
    id: 'enigma.big-words',
    emoji: '📏',
    title: 'Big Words Energy',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'words',
    minPlayers: 4,
    copy: {
      cheeky: ["{who}'s clues averaged {n} letters", '{who} wrote {n}-letter clues. Thesaurus out'],
      wholesome: [
        '{who} brought the vocabulary: {n} letters a clue',
        "{who}'s clues ran {n} letters long",
      ],
    },
    compute: (g) => {
      const means = meanBy(
        g.of('clues'),
        (e) => {
          const ws = strs(e, 'clues');
          return ws.length ? ws.reduce((s, w) => s + w.length, 0) / ws.length : undefined;
        },
        2,
      );
      return leaders(means, { min: 6 }).map((c) => ({
        ...c,
        value: Math.round(c.value * 10) / 10,
      }));
    },
  },
  {
    id: 'enigma.photo-finish',
    emoji: '📸',
    title: 'Photo Finish',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'result',
    minPlayers: 4,
    copy: {
      cheeky: [
        'Decided on the score after round {n}. Nails: bitten',
        'Tokens level, so the score decided it, round {n}',
      ],
      wholesome: ['A beautifully close game, settled in round {n}', 'Neck and neck to round {n}'],
    },
    compute: (g) => {
      const o = outcome(g);
      return str(o, 'reason') === 'score'
        ? [{ players: [...g.winners].sort(), value: num(o, 'round') ?? 0 }]
        : [];
    },
  },
  {
    id: 'enigma.draw',
    emoji: '🤝',
    title: 'Dead Heat',
    valence: 'gentle',
    weight: 4,
    kind: 'moment',
    family: 'result',
    minPlayers: 4,
    copy: {
      cheeky: [
        'A draw after {n} rounds. Nobody gets the crown',
        '{n} rounds, dead level. Rematch!',
      ],
      wholesome: ['A draw after {n} rounds: both teams shone', 'Perfectly matched over {n} rounds'],
    },
    compute: (g) => {
      const o = outcome(g);
      return str(o, 'winner') === 'draw' ? [{ players: [], value: num(o, 'round') ?? 0 }] : [];
    },
  },
  {
    id: 'enigma.double-whammy',
    emoji: '💥',
    title: 'Double Whammy',
    wholesomeTitle: 'Plot Twist',
    valence: 'chaos',
    weight: 4,
    kind: 'moment',
    family: 'leak',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s code: missed by friends, cracked by rivals",
        "{who}'s round {n} code fooled the wrong team",
      ],
      wholesome: [
        "{who}'s round {n} code was a twist for everyone",
        "{who}'s code surprised both teams in round {n}",
      ],
    },
    compute: (g) =>
      g
        .of('decode')
        .filter((d) => {
          const team = str(d, 'team');
          return (
            decodeFailed(d) &&
            isTeam(team) &&
            g
              .of('intercept')
              .some(
                (i) =>
                  bool(i, 'success') === true &&
                  str(i, 'team') === other(team) &&
                  num(i, 'round') === num(d, 'round'),
              )
          );
        })
        .slice(0, 1)
        .map((d) => ({
          players: str(d, 'encryptor') ? [str(d, 'encryptor')!] : [],
          value: num(d, 'round') ?? 0,
        })),
  },
  {
    id: 'enigma.early-intercept',
    emoji: '🎯',
    title: 'Round-Two Snipe',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'intercept',
    minPlayers: 4,
    copy: {
      cheeky: [
        'Team {team} intercepted in round {n}. Already?',
        'Team {team} cracked it by round {n}',
      ],
      wholesome: [
        'Team {team} cracked a code as early as round {n}',
        'Team {team} saw the pattern in round {n}',
      ],
    },
    compute: (g) => {
      const hit = g
        .of('intercept')
        .find((e) => bool(e, 'success') === true && num(e, 'round') === 2);
      const team = str(hit, 'team');
      return isTeam(team) ? [teamCandidate(g, team, 2)] : [];
    },
  },
];

/** Adds `{s}` (seconds) to timing candidates. */
function withSeconds(cands: AwardCandidate[]): AwardCandidate[] {
  return cands.map((c) => ({ ...c, params: { ...c.params, s: seconds(c.value) } }));
}

const all = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));

const nuggets: NuggetRule[] = [
  {
    id: 'enigma.rounds',
    emoji: '🔁',
    interest: 1,
    compute: (games) => {
      const n = games.reduce((s, g) => s + rounds(g), 0);
      return n ? { value: n, text: `${count(n, 'round')} played` } : null;
    },
  },
  {
    id: 'enigma.tokens',
    emoji: '🔐',
    interest: 3,
    compute: (games) => {
      const ints = all(games, 'intercept').filter((e) => bool(e, 'success') === true).length;
      const misses = all(games, 'decode').filter(decodeFailed).length;
      return ints + misses
        ? {
            value: ints + misses,
            text: `${count(ints, 'intercept')} · ${count(misses, 'miss', 'misses')}`,
          }
        : null;
    },
  },
  {
    id: 'enigma.clues-sent',
    emoji: '📡',
    interest: 2,
    compute: (games) => {
      const n = all(games, 'clues').reduce((s, e) => s + strs(e, 'clues').length, 0);
      return n ? { value: n, text: `${count(n, 'clue')} sent` } : null;
    },
  },
  {
    id: 'enigma.top-clue',
    emoji: '♻️',
    interest: 3,
    compute: (games) => {
      const counts = new Map<string, number>();
      for (const e of all(games, 'clues'))
        for (const w of strs(e, 'clues')) counts.set(norm(w), (counts.get(norm(w)) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      return top && top[1] >= 2
        ? { value: top[1], text: `Most used clue: "${plain(top[0])}" ×${top[1]}` }
        : null;
    },
  },
  {
    id: 'enigma.longest-clue',
    emoji: '📏',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const words = all(games, 'clues').flatMap((e) => strs(e, 'clues'));
      const longest = words.sort((a, b) => b.length - a.length)[0];
      return longest && longest.length >= 8
        ? { value: longest.length, text: `Longest clue: "${plain(longest).slice(0, 24)}"` }
        : null;
    },
  },
  {
    id: 'enigma.encrypt-time',
    emoji: '⏱️',
    interest: 1,
    compute: (games) => {
      const times = all(games, 'clues')
        .map((e) => num(e, 'actMs'))
        .filter((v): v is number => v !== undefined);
      if (!times.length) return null;
      const s = seconds(times.reduce((a, b) => a + b, 0) / times.length);
      return { value: s, text: `${s} s to encrypt, on average` };
    },
  },
];

/** One line per round: each team's transmission, and whether it was decoded or intercepted. */
function history(g: GameEvents): string[] {
  const byRound = new Map<number, string[]>();
  for (const d of g.of('decode')) {
    const round = num(d, 'round');
    const team = str(d, 'team');
    if (round === undefined || !isTeam(team)) continue;
    const intercepted = g
      .of('intercept')
      .some(
        (i) =>
          bool(i, 'success') === true &&
          str(i, 'team') === other(team) &&
          num(i, 'round') === round,
      );
    const enc = str(d, 'encryptor');
    const who = enc ? ` (${ph.p(enc)})` : '';
    const result =
      bool(d, 'expired') === true
        ? 'no clues in time'
        : bool(d, 'success') === true
          ? 'decoded'
          : 'missed';
    const parts = byRound.get(round) ?? [];
    parts.push(`${TEAM_NAME[team]}${who} ${result}${intercepted ? ', intercepted' : ''}`);
    byRound.set(round, parts);
  }
  const lines = [...byRound]
    .sort((a, b) => a[0] - b[0])
    .map(([round, parts]) => `Round ${round}: ${parts.join(' · ')}`);
  return lines.length <= 12 ? lines : [`${lines.length - 11} earlier rounds…`, ...lines.slice(-11)];
}

export const enigmaAwards: AwardModule = { rules, nuggets, history };
