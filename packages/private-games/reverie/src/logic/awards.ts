import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  leaders,
  mostBy,
  num,
  pairTally,
  ph,
  plain,
  str,
  strs,
  nums,
  tally,
  topPair,
} from '@vt/game-sdk';

/** One turn as the recap sees it: the story and the votes that followed it. */
interface TurnRecap {
  story: RecapEvent;
  votes: RecapEvent[];
  scores: RecapEvent[];
}

/** Splits a game into turns: each `story` is followed by its votes and scores. */
export function turnsOf(g: GameEvents): TurnRecap[] {
  const turns: TurnRecap[] = [];
  for (const e of g.events) {
    if (e.type === 'story') turns.push({ story: e, votes: [], scores: [] });
    else if (e.type === 'vote') turns.at(-1)?.votes.push(e);
    else if (e.type === 'score') turns.at(-1)?.scores.push(e);
  }
  return turns;
}

const clueOf = (story: RecapEvent) => plain(str(story, 'clue') ?? '');
const found = (story: RecapEvent) => num(story, 'found') ?? 0;
const voters = (story: RecapEvent) => num(story, 'voters') ?? 0;

/** The single story that best fits `pick` (most voters, then the latest); null when none does. */
function oneStory(g: GameEvents, pick: (story: RecapEvent) => boolean): AwardCandidate[] {
  const hits = g.of('story').filter((s) => s.playerId && clueOf(s) && pick(s));
  if (!hits.length) return [];
  const best = hits.reduce((a, b) => (voters(b) >= voters(a) ? b : a));
  const count = hits.filter((s) => s.playerId === best.playerId).length;
  return [{ players: [best.playerId!], value: count, params: { w: clueOf(best) } }];
}

/** A per-player best (or lowest) clue length; only a single leader is named, with the clue. */
function clueLength(stories: readonly RecapEvent[], lowest: boolean): AwardCandidate[] {
  const best = new Map<string, { len: number; clue: string }>();
  for (const s of stories) {
    const clue = clueOf(s);
    if (!s.playerId || !clue) continue;
    const prev = best.get(s.playerId);
    if (!prev || (lowest ? clue.length < prev.len : clue.length > prev.len))
      best.set(s.playerId, { len: clue.length, clue });
  }
  const top = leaders(new Map([...best].map(([id, b]) => [id, b.len])), { lowest });
  if (top.length !== 1 || top[0]!.players.length !== 1) return [];
  const c = top[0]!;
  return [{ ...c, params: { w: best.get(c.players[0]!)!.clue } }];
}

const rules: AwardRule[] = [
  {
    id: 'reverie.sweet-spot',
    emoji: '📖',
    title: 'Sweet-Spot Storyteller',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'storytelling',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} hit the sweet spot {n} times. Annoyingly good',
        '{who} landed {n} stories just right. Show-off',
      ],
      wholesome: [
        '{who} told {n} perfectly balanced stories',
        '{who} found the sweet spot {n} times',
      ],
    },
    compute: (g) =>
      leaders(tally(g.of('story').filter((s) => bool(s, 'allOrNone') === false)), { min: 2 }),
  },
  {
    id: 'reverie.too-cryptic',
    emoji: '🔮',
    title: 'Too Cryptic',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'storytelling',
    minPlayers: 3,
    copy: {
      cheeky: [
        'Nobody got {who}\'s "{w}". Not one soul',
        '{who} said "{w}" and lost the whole room',
      ],
      wholesome: [
        '{who}\'s "{w}" was art. Misunderstood art',
        '{who}\'s "{w}" was a riddle for the ages',
      ],
    },
    compute: (g) => oneStory(g, (s) => voters(s) > 0 && found(s) === 0),
  },
  {
    id: 'reverie.too-obvious',
    emoji: '📢',
    title: 'Too Obvious',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'storytelling',
    minPlayers: 3,
    copy: {
      cheeky: [
        'Everyone got {who}\'s "{w}". Subtle as a trumpet',
        '{who}\'s "{w}" fooled absolutely no one',
      ],
      wholesome: [
        '{who}\'s "{w}" was crystal clear to all',
        '{who}\'s "{w}" spoke to every single one of us',
      ],
    },
    compute: (g) => oneStory(g, (s) => voters(s) >= 2 && found(s) === voters(s)),
  },
  {
    id: 'reverie.mind-reader',
    emoji: '🧠',
    title: 'Mind Reader',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} found the card {n} times. Spooky', '{who} read minds {n} times. Stop it'],
      wholesome: [
        "{who} was on everyone's wavelength, {n} times",
        "{who} found the storyteller's card {n} times",
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('vote').filter((v) => bool(v, 'found') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'reverie.decoy-royalty',
    emoji: '🪤',
    title: 'Decoy Royalty',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'decoys',
    minPlayers: 3,
    copy: {
      cheeky: ["{who}'s cards lured {n} votes. Shameless", '{who} baited {n} votes with decoys'],
      wholesome: [
        '{who} picked irresistible cards: {n} votes',
        "{who}'s cards charmed the table {n} times",
      ],
    },
    compute: (g) => {
      const lured = turnsOf(g).flatMap(({ story, votes }) =>
        votes.flatMap((v) => {
          const owner = str(v, 'owner');
          return owner && owner !== story.playerId && owner !== v.playerId ? [owner] : [];
        }),
      );
      const counts = new Map<string, number>();
      for (const id of lured) counts.set(id, (counts.get(id) ?? 0) + 1);
      return leaders(counts, { min: 3 });
    },
  },
  {
    id: 'reverie.soulmates',
    emoji: '💘',
    title: 'Soulmates',
    valence: 'gentle',
    weight: 4,
    kind: 'pair',
    family: 'decoys',
    minPlayers: 4,
    copy: {
      cheeky: ["{a} fell for {b}'s cards {n} times", "{a} kept picking {b}'s cards: {n} times"],
      wholesome: [
        '{a} and {b} see the world the same way ({n})',
        "{a} loved {b}'s cards, {n} times over",
      ],
    },
    compute: (g) =>
      topPair(
        pairTally(
          turnsOf(g).flatMap(({ story, votes }) =>
            votes.flatMap((v) => {
              const owner = str(v, 'owner');
              return v.playerId && owner && owner !== story.playerId
                ? [[v.playerId, owner] as const]
                : [];
            }),
          ),
          true,
        ),
        2,
      ),
  },
  {
    id: 'reverie.easily-charmed',
    emoji: '🌀',
    title: 'Easily Charmed',
    valence: 'chaos',
    weight: 1,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} picked decoys {n} times', '{who} fell for {n} decoys. Romantic'],
      wholesome: ["{who} loved everyone's cards ({n} decoys)", '{who} saw beauty in {n} decoys'],
    },
    compute: (g) =>
      mostBy(
        g.of('vote').filter((v) => bool(v, 'found') === false),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'reverie.clue-poet',
    emoji: '🎨',
    title: 'Clue Poet',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'wordplay',
    minPlayers: 3,
    copy: {
      cheeky: ["{who}'s clue ran to {n} letters", '{who} wrote a {n}-letter clue. An epic'],
      wholesome: ['{who} wrote poetry: {n} letters of it', '{who} gave us a {n}-letter story'],
    },
    compute: (g) => clueLength(g.of('story'), false).filter((c) => c.value >= 15),
  },
  {
    id: 'reverie.minimalist',
    emoji: '🤏',
    title: 'Minimalist',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'wordplay',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} said "{w}". That\'s it. It worked', '{who} needed just "{w}". Efficient'],
      wholesome: ['{who} said so much with "{w}"', '{who} proved "{w}" was plenty'],
    },
    compute: (g) =>
      clueLength(
        g.of('story').filter((s) => bool(s, 'allOrNone') === false),
        true,
      ).filter((c) => c.value <= 12),
  },
  {
    id: 'reverie.big-payday',
    emoji: '💰',
    title: 'Big Payday',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'scoring',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} grabbed {n} points in one turn', '{who} cashed in {n} points at once'],
      wholesome: ['{who} had a dream turn: +{n}', '{who} scored {n} in a single turn'],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const s of g.of('score')) {
        const p = num(s, 'points');
        if (s.playerId && p !== undefined)
          best.set(s.playerId, Math.max(best.get(s.playerId) ?? 0, p));
      }
      return leaders(best, { min: 5 });
    },
  },
  {
    id: 'reverie.slow-burn',
    emoji: '🐌',
    title: 'Slow Burn',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'scoring',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} came back from last place to finish #{n}',
        '{who} was last at halftime, then #{n}',
      ],
      wholesome: [
        '{who} never gave up and climbed to #{n}',
        '{who} rose from last to #{n}. Inspiring',
      ],
    },
    compute: (g) => {
      const turns = turnsOf(g).filter((t) => t.scores.length);
      if (turns.length < 4) return [];
      const mid = turns[Math.ceil(turns.length / 2) - 1]!;
      const atMid = new Map(
        mid.scores.flatMap((s) =>
          s.playerId ? [[s.playerId, num(s, 'total') ?? 0] as const] : [],
        ),
      );
      const low = leaders(atMid, { lowest: true });
      if (low.length !== 1 || low[0]!.players.length !== 1) return [];
      const id = low[0]!.players[0]!;
      const finals = new Map(
        turns
          .at(-1)!
          .scores.flatMap((s) => (s.playerId ? [[s.playerId, num(s, 'total') ?? 0] as const] : [])),
      );
      const mine = finals.get(id);
      if (mine === undefined) return [];
      const place = 1 + [...finals.values()].filter((v) => v > mine).length;
      return place <= 2 ? [{ players: [id], value: 1, params: { n: place } }] : [];
    },
  },
  {
    id: 'reverie.champion',
    emoji: '🏆',
    title: 'Champion',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'scoring',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} won with {n} points. Take a bow', '{who} took the crown on {n} points'],
      wholesome: ['{who} reached {n} points first', '{who} told the winning tale: {n} points'],
    },
    compute: (g) => {
      const outcome = g.of('outcome').at(-1);
      const scores = nums(outcome, 'scores');
      const ranking = strs(outcome, 'ranking');
      const winners = g.winners.length ? g.winners : strs(outcome, 'winners');
      if (!winners.length || winners.length > 3 || !scores.length) return [];
      const runnerUp = scores.find((_, i) => !winners.includes(ranking[i] ?? ''));
      return [
        {
          players: [...winners].sort(),
          value: scores[0]!,
          ...(runnerUp !== undefined && { runnerUp }),
        },
      ];
    },
  },
  // ---- Moments ----
  {
    id: 'reverie.same-decoy',
    emoji: '🎯',
    title: 'One Card To Fool Them All',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'decoys',
    minPlayers: 4,
    copy: {
      cheeky: ["Every single voter fell for {who}'s card", "{who}'s decoy took all {n} votes"],
      wholesome: ["{who}'s card won over all {n} voters", "All {n} voters loved {who}'s card"],
    },
    compute: (g) =>
      turnsOf(g).flatMap(({ story, votes }) => {
        const owners = new Set(votes.map((v) => str(v, 'owner')));
        const [owner] = owners;
        return votes.length >= 3 && owners.size === 1 && owner && owner !== story.playerId
          ? [{ players: [owner], value: votes.length }]
          : [];
      }),
  },
  {
    id: 'reverie.decoy-magnet',
    emoji: '🧲',
    title: 'Decoy Magnet',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'decoys',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s decoy drew {n} votes in one turn",
        "{n} people fell for {who}'s card at once",
      ],
      wholesome: [
        "{who}'s card drew {n} votes in one turn",
        "{n} voters adored {who}'s card at once",
      ],
    },
    compute: (g) => {
      const out: AwardCandidate[] = [];
      for (const { story, votes } of turnsOf(g)) {
        const per = tally(votes, (v) => {
          const owner = str(v, 'owner');
          return owner && owner !== story.playerId ? owner : null;
        });
        for (const [id, n] of per)
          if (n >= 3 && n < votes.length) out.push({ players: [id], value: n });
      }
      return out.sort((a, b) => b.value - a.value).slice(0, 1);
    },
  },
  {
    id: 'reverie.deciding-all-or-none',
    emoji: '🎲',
    title: 'All or Nothing',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    family: 'storytelling',
    minPlayers: 3,
    copy: {
      cheeky: [
        "{who}'s last story: all or nothing, on turn {r}",
        'Turn {r}: {who} went all-or-none at the end',
      ],
      wholesome: [
        '{who} told a bold final story on turn {r}',
        "Turn {r}: {who}'s last tale kept us guessing",
      ],
    },
    compute: (g) => {
      if (!g.of('outcome').length) return [];
      const last = g.of('story').at(-1);
      return last?.playerId && bool(last, 'allOrNone') === true
        ? [{ players: [last.playerId], value: 1, params: { r: num(last, 'round') ?? 0 } }]
        : [];
    },
  },
];

const allTurns = (games: readonly GameEvents[]) => games.flatMap(turnsOf);

const nuggets: NuggetRule[] = [
  {
    id: 'reverie.turns',
    emoji: '📚',
    interest: 1,
    compute: (games) => {
      const n = allTurns(games).length;
      return n ? { value: n, text: `${n} stories told` } : null;
    },
  },
  {
    id: 'reverie.sweet-spot-rate',
    emoji: '🎯',
    interest: 2,
    compute: (games) => {
      const stories = allTurns(games).map((t) => t.story);
      if (stories.length < 2) return null;
      const pct = Math.round(
        (100 * stories.filter((s) => bool(s, 'allOrNone') === false).length) / stories.length,
      );
      return { value: pct, text: `${pct}% of stories hit the sweet spot` };
    },
  },
  {
    id: 'reverie.decoy-record',
    emoji: '🪤',
    interest: 3,
    compute: (games) => {
      let best = 0;
      for (const { story, votes } of allTurns(games)) {
        const per = tally(votes, (v) => {
          const owner = str(v, 'owner');
          return owner && owner !== story.playerId ? owner : null;
        });
        best = Math.max(best, ...per.values());
      }
      return best >= 2 ? { value: best, text: `Most votes on one decoy: ${best}` } : null;
    },
  },
  {
    id: 'reverie.best-turn',
    emoji: '💰',
    interest: 2,
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('score').map((s) => num(s, 'points') ?? 0)),
      );
      return best ? { value: best, text: `Best single turn: +${best}` } : null;
    },
  },
  {
    id: 'reverie.spread',
    emoji: '📏',
    interest: 1,
    compute: (games) => {
      const scores = nums(games.at(-1)?.of('outcome').at(-1), 'scores');
      if (scores.length < 2) return null;
      const spread = scores[0]! - scores.at(-1)!;
      return { value: spread, text: `Final score spread: ${spread} points` };
    },
  },
];

/** Most turns listed in a game's history; older ones are summarised in one line. */
const HISTORY_LINES = 12;

function history(g: GameEvents): string[] {
  const lines = turnsOf(g).map(({ story }) => {
    const who = story.playerId ? ph.p(story.playerId) : 'Someone';
    const clue = clueOf(story);
    const result =
      voters(story) === 0
        ? 'no votes'
        : bool(story, 'allOrNone')
          ? found(story) === 0
            ? 'nobody found it'
            : 'everyone found it'
          : `${found(story)} of ${voters(story)} found it`;
    return `Turn ${num(story, 'round') ?? '?'}: ${who} told "${clue || '…'}", ${result}`;
  });
  if (lines.length <= HISTORY_LINES) return lines;
  const hidden = lines.length - (HISTORY_LINES - 1);
  return [`${hidden} earlier turns`, ...lines.slice(-(HISTORY_LINES - 1))];
}

/** Reverie's awards for the night recap, read from its own `insights` events. */
export const reverieAwards: AwardModule = { rules, nuggets, history };
