import {
  pairTally,
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  bool,
  count as plural,
  type GameEvents,
  ph,
  plain,
  leaders,
  mostBy,
  type NuggetRule,
  num,
  nums,
  topPair,
  type RecapEvent,
  strs,
} from '@vt/game-sdk';

/** One revealed round: its lies and votes (reported just before it) and the round itself. */
interface RoundRecap {
  number: number;
  round: RecapEvent;
  lies: RecapEvent[];
  votes: RecapEvent[];
}

/** Splits a game into rounds: lies and votes come right before their `round` event. */
export function roundsOf(g: GameEvents): RoundRecap[] {
  const out: RoundRecap[] = [];
  let lies: RecapEvent[] = [];
  let votes: RecapEvent[] = [];
  for (const e of g.events) {
    if (e.type === 'lie') lies.push(e);
    else if (e.type === 'vote') votes.push(e);
    else if (e.type === 'round') {
      out.push({ number: out.length + 1, round: e, lies, votes });
      lies = [];
      votes = [];
    }
  }
  return out;
}

/** The lie's text, as players wrote it (made safe for placeholders). */
export const lieText = (lie: RecapEvent): string => {
  const words = lie.props.words;
  const first = Array.isArray(words) ? (words[0] as { word?: unknown } | undefined) : undefined;
  return plain(typeof first?.word === 'string' ? first.word : '');
};

const fooled = (lie: RecapEvent) => num(lie, 'fooled') ?? 0;
const authorsOf = (e: RecapEvent) => {
  const a = strs(e, 'authors');
  return a.length ? a : e.playerId ? [e.playerId] : [];
};

const count = (ids: readonly string[]) => {
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
};

/** A single leader by text length (longest, or shortest), named with their lie. */
function lieLength(lies: readonly RecapEvent[], lowest: boolean): AwardCandidate[] {
  const best = new Map<string, string>();
  for (const lie of lies) {
    const text = lieText(lie);
    if (!text) continue;
    for (const id of authorsOf(lie)) {
      const prev = best.get(id);
      if (prev === undefined || (lowest ? text.length < prev.length : text.length > prev.length))
        best.set(id, text);
    }
  }
  const top = leaders(new Map([...best].map(([id, t]) => [id, t.length])), { lowest });
  if (top.length !== 1 || top[0]!.players.length !== 1) return [];
  return [{ ...top[0]!, params: { w: best.get(top[0]!.players[0]!)! } }];
}

const rules: AwardRule[] = [
  {
    id: 'hoodwink.best-liar',
    emoji: '🎭',
    title: 'Best Liar',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'deception',
    minPlayers: 3,
    copy: {
      cheeky: [
        "{who}'s lies fooled {n} people. Concerning",
        '{who} fibbed past {n} voters. Smooth',
      ],
      wholesome: ['{who} told {n} wonderful fibs', "{who}'s stories won over {n} voters"],
    },
    compute: (g) =>
      leaders(
        (() => {
          const t = new Map<string, number>();
          for (const lie of g.of('lie'))
            for (const id of authorsOf(lie)) t.set(id, (t.get(id) ?? 0) + fooled(lie));
          return t;
        })(),
        { min: 2 },
      ),
  },
  {
    id: 'hoodwink.truth-seeker',
    emoji: '🔎',
    title: 'Truth Seeker',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} found the truth {n} times. Unfoolable', '{who} sniffed out {n} truths'],
      wholesome: ['{who} had the best nose for facts ({n})', '{who} found the truth {n} times'],
    },
    compute: (g) =>
      mostBy(
        g.of('vote').filter((v) => bool(v, 'foundTruth') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'hoodwink.great-minds',
    emoji: '🪞',
    title: 'Great Minds Lie Alike',
    valence: 'gentle',
    weight: 4,
    kind: 'pair',
    family: 'twins',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} wrote the same lie. Collusion?', '{who} both typed "{w}". Suspicious'],
      wholesome: ['{who} had the exact same idea', '{who} thought of "{w}" at once'],
    },
    compute: (g) =>
      g
        .of('lie')
        .filter((l) => strs(l, 'authors').length >= 2)
        .map((l) => ({
          players: strs(l, 'authors').slice(0, 3),
          value: fooled(l) + 1,
          params: { w: lieText(l) },
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 1),
  },
  {
    id: 'hoodwink.total-con',
    emoji: '💯',
    title: 'Total Con',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'deception',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who}\'s "{w}" fooled every single voter',
        '{who} conned the whole table with "{w}"',
      ],
      wholesome: ['{who}\'s "{w}" convinced the whole table', 'Everyone believed {who}\'s "{w}"'],
    },
    compute: (g) =>
      roundsOf(g).flatMap(({ round, lies, votes }) => {
        if ((num(round, 'truthFound') ?? 1) !== 0) return [];
        return lies.flatMap((lie) => {
          const authors = authorsOf(lie);
          const others = votes.filter((v) => !authors.includes(v.playerId ?? '')).length;
          return others >= 2 && fooled(lie) === others
            ? [{ players: authors.slice(0, 3), value: others, params: { w: lieText(lie) } }]
            : [];
        });
      }),
  },
  {
    id: 'hoodwink.nemesis',
    emoji: '🐍',
    title: 'Nemesis',
    valence: 'gentle',
    weight: 4,
    kind: 'pair',
    family: 'rivalry',
    minPlayers: 4,
    copy: {
      cheeky: ["{a} fell for {b}'s lies {n} times", '{b} fooled {a} {n} times. Personal'],
      wholesome: ['{b} knew exactly how to charm {a} ({n})', "{a} trusted {b}'s stories {n} times"],
    },
    compute: (g) =>
      topPair(
        pairTally(
          g
            .of('vote')
            .flatMap((v) =>
              v.playerId ? strs(v, 'authors').map((a) => [v.playerId!, a] as const) : [],
            ),
          true,
        ),
        2,
      ),
  },
  {
    id: 'hoodwink.fell-for-house',
    emoji: '🏠',
    title: 'Fell for the House',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ["{who} picked the house's fake, {n|time}", '{who} believed the house {n|time}'],
      wholesome: [
        "{who} trusted the house {n|time}. Who wouldn't",
        '{who} gave the house a chance, {n|time}',
      ],
    },
    compute: (g) => mostBy(g.of('vote').filter((v) => bool(v, 'house') === true)),
  },
  {
    id: 'hoodwink.hoodwinked',
    emoji: '🫠',
    title: 'Hoodwinked',
    valence: 'chaos',
    weight: 1,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} was fooled {n} times', '{who} believed {n} lies. Trusting soul'],
      wholesome: [
        '{who} gave every lie a fair chance ({n})',
        '{who} believed the best in {n} fibs',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('vote').filter((v) => bool(v, 'foundTruth') === false),
        undefined,
        { min: 3 },
      ),
  },
  {
    id: 'hoodwink.lie-for-me',
    emoji: '🤖',
    title: 'Lie for Me Enjoyer',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'robot',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} let the robot lie {n} times', '{who} outsourced {n} lies to the machine'],
      wholesome: [
        '{who} trusted the machine {n} times',
        '{who} teamed up with the robot {n} times',
      ],
    },
    compute: (g) => leaders(count(g.of('lie').flatMap((l) => strs(l, 'autoAuthors'))), { min: 2 }),
  },
  {
    id: 'hoodwink.too-weird',
    emoji: '🤯',
    title: 'Too Weird To Be True',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    family: 'truth',
    minPlayers: 3,
    copy: {
      cheeky: ['Round {r}: nobody believed the real answer', 'Round {r}: the truth got zero votes'],
      wholesome: [
        'Round {r}: the truth was stranger than fiction',
        'Round {r}: the real answer fooled us all',
      ],
    },
    compute: (g) =>
      roundsOf(g)
        .filter(({ round, votes }) => votes.length >= 2 && num(round, 'truthFound') === 0)
        .map(({ number, votes }) => ({ players: [], value: votes.length, params: { r: number } }))
        .slice(-1),
  },
  {
    id: 'hoodwink.final-heist',
    emoji: '💥',
    title: 'Final-Round Heist',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'scoring',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} scored {n} on the double round', '{who} robbed the final round of {n}'],
      wholesome: ['{who} saved the best for last: {n}', '{who} shone in the final round: {n}'],
    },
    compute: (g) => {
      const last = roundsOf(g).find(({ round }) => bool(round, 'double') === true);
      if (!last) return [];
      const to = strs(last.round, 'pointsTo');
      const pts = nums(last.round, 'points');
      return leaders(new Map(to.map((id, i) => [id, pts[i] ?? 0])), { min: 500 });
    },
  },
  {
    id: 'hoodwink.novelist',
    emoji: '📜',
    title: 'Novelist',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'wordplay',
    minPlayers: 3,
    copy: {
      cheeky: ["{who}'s lie ran to {n} characters", '{who} wrote a {n}-character fib'],
      wholesome: ['{who} wrote a whole saga: {n} characters', '{who} told a {n}-character tale'],
    },
    compute: (g) => lieLength(g.of('lie'), false).filter((c) => c.value >= 25),
  },
  {
    id: 'hoodwink.haiku',
    emoji: '🪶',
    title: 'Haiku',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'wordplay',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} fooled people with just "{w}"', '{who} needed only "{w}" to fool us'],
      wholesome: ['{who} proved less is more: "{w}"', '{who} charmed us with just "{w}"'],
    },
    compute: (g) =>
      lieLength(
        g.of('lie').filter((l) => fooled(l) > 0),
        true,
      ).filter((c) => c.value <= 12),
  },
  {
    id: 'hoodwink.too-honest',
    emoji: '😇',
    title: 'Too Honest',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'deception',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} fooled nobody in {n} rounds. Bless', '{who}: {n} rounds, zero victims'],
      wholesome: [
        '{who} is simply too honest ({n} rounds)',
        '{who} kept it truthful for {n} rounds',
      ],
    },
    compute: (g) => {
      const rounds = roundsOf(g).length;
      if (rounds < 5) return [];
      const authors = new Set(g.of('lie').flatMap(authorsOf));
      const fooledAny = new Set(
        g
          .of('lie')
          .filter((l) => fooled(l) > 0)
          .flatMap(authorsOf),
      );
      const honest = [...authors].filter((id) => !fooledAny.has(id));
      return leaders(new Map(honest.map((id) => [id, rounds])));
    },
  },
];

const allRounds = (games: readonly GameEvents[]) => games.flatMap(roundsOf);

const nuggets: NuggetRule[] = [
  {
    id: 'hoodwink.rounds',
    emoji: '❓',
    interest: 1,
    compute: (games) => {
      const n = allRounds(games).length;
      return n ? { value: n, text: plural(n, 'strange question') } : null;
    },
  },
  {
    id: 'hoodwink.truth-rate',
    emoji: '🔎',
    interest: 2,
    compute: (games) => {
      const votes = games.flatMap((g) => g.of('vote'));
      if (votes.length < 4) return null;
      const pct = Math.round(
        (100 * votes.filter((v) => bool(v, 'foundTruth') === true).length) / votes.length,
      );
      return { value: pct, text: `${pct}% of votes found the truth` };
    },
  },
  {
    id: 'hoodwink.best-lie',
    emoji: '🎭',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const lies = games.flatMap((g) => g.of('lie')).filter((l) => fooled(l) >= 2 && lieText(l));
      if (!lies.length) return null;
      const best = lies.reduce((a, b) => (fooled(b) > fooled(a) ? b : a));
      return {
        value: fooled(best),
        text: `Best lie: "${lieText(best).slice(0, 24)}" (${fooled(best)})`,
      };
    },
  },
  {
    id: 'hoodwink.fooled-total',
    emoji: '🫠',
    interest: 2,
    compute: (games) => {
      const n = games.flatMap((g) => g.of('lie')).reduce((s, l) => s + fooled(l), 0);
      return n ? { value: n, text: `${plural(n, 'vote')} went to lies` } : null;
    },
  },
  {
    id: 'hoodwink.house',
    emoji: '🏠',
    interest: 1,
    compute: (games) => {
      const n = games.flatMap((g) => g.of('vote')).filter((v) => bool(v, 'house') === true).length;
      return n ? { value: n, text: `House fakes picked: ${n}` } : null;
    },
  },
];

const HISTORY_LINES = 12;

function history(g: GameEvents): string[] {
  const lines = roundsOf(g).map(({ number, round, lies, votes }) => {
    const double = bool(round, 'double') ? ' (double)' : '';
    const truth = num(round, 'truthFound') ?? 0;
    const head = `Round ${number}${double}: truth found by ${truth} of ${votes.length}`;
    const best = lies.filter((l) => fooled(l) > 0 && lieText(l));
    if (!best.length) return head;
    const top = best.reduce((a, b) => (fooled(b) > fooled(a) ? b : a));
    const by = authorsOf(top).map(ph.p).join(' & ');
    return `${head}; ${by}'s "${lieText(top).slice(0, 30)}" fooled ${fooled(top)}`;
  });
  if (lines.length <= HISTORY_LINES) return lines;
  const hidden = lines.length - (HISTORY_LINES - 1);
  return [`${hidden} earlier rounds`, ...lines.slice(-(HISTORY_LINES - 1))];
}

/** Hoodwink's awards for the night recap, read from its own `insights` events. */
export const hoodwinkAwards: AwardModule = { rules, nuggets, history };
