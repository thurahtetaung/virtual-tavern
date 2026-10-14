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
} from '@vt/game-sdk';
import { countText } from './clue.ts';

/**
 * Codenames awards, read from its `insights` events: `clue` {word, count, team},
 * `guess` {word, kind, correct, team, clueWord?, clueCount?, guessNo?}, `end-turn`
 * {reason, team, stage?} (a pass names who pressed it), and `outcome` {winner, winReason,
 * startingTeam?, redLeft?, blueLeft?, spymasters?}.
 */

const TEAM_NAME: Record<string, string> = { red: 'Red', blue: 'Blue' };
const teamName = (t: string | undefined) => (t ? (TEAM_NAME[t] ?? plain(t)) : '');
const other = (t: string | undefined) => (t === 'red' ? 'blue' : t === 'blue' ? 'red' : undefined);

const guesses = (g: GameEvents) => g.of('guess');
const isCorrect = (e: RecapEvent) => bool(e, 'correct') ?? str(e, 'kind') === str(e, 'team');

/** One clue and the guesses its team made on it, up to the turn's end. */
interface ClueRun {
  clue: RecapEvent;
  team: string | undefined;
  giver: string | null;
  count: number;
  guesses: RecapEvent[];
}

/** Splits the game into clues and what followed each one, in order. */
export function clueRuns(g: GameEvents): ClueRun[] {
  const runs: ClueRun[] = [];
  let open: ClueRun | null = null;
  for (const e of g.events) {
    if (e.type === 'clue') {
      open = {
        clue: e,
        team: str(e, 'team'),
        giver: e.playerId,
        count: num(e, 'count') ?? 0,
        guesses: [],
      };
      runs.push(open);
    } else if (e.type === 'guess' && open && str(e, 'team') === open.team) {
      open.guesses.push(e);
    } else if (e.type === 'end-turn' || e.type === 'outcome') {
      open = null;
    }
  }
  return runs;
}

const correctIn = (run: ClueRun) => run.guesses.filter(isCorrect).length;
const cashed = (run: ClueRun) => run.count > 0 && correctIn(run) >= run.count;
const outcome = (g: GameEvents) => g.of('outcome').at(-1);

/** The last guess of a game that ended with every agent found. */
function lastAgentGuess(g: GameEvents): RecapEvent | undefined {
  const o = outcome(g);
  if (str(o, 'winReason') !== 'all-agents') return undefined;
  return guesses(g).at(-1);
}

/** The largest deficit (cards left minus the rivals' cards left) the winners faced. */
export function deepestHole(g: GameEvents): number | null {
  const o = outcome(g);
  const start = str(o, 'startingTeam');
  const winner = str(o, 'winner');
  if (!start || !winner || !other(winner)) return null;
  const left: Record<string, number> = { [start]: 9, [other(start)!]: 8 };
  let worst = left[winner]! - left[other(winner)!]!;
  for (const e of guesses(g)) {
    const kind = str(e, 'kind');
    if (kind && kind in left) left[kind]! -= 1;
    worst = Math.max(worst, left[winner]! - left[other(winner)!]!);
  }
  return worst;
}

const rules: AwardRule[] = [
  {
    id: 'codenames.assassin-magnet',
    emoji: '💀',
    title: 'Assassin Magnet',
    wholesomeTitle: 'Brave Scout',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'blunder',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} shook hands with the assassin',
        '{who} found the assassin {n|time}. On purpose? Unclear',
      ],
      wholesome: [
        '{who} bravely checked the black card so nobody else had to',
        '{who} took one for the team and met the assassin',
      ],
    },
    compute: (g) =>
      mostBy(
        guesses(g).filter((e) => str(e, 'kind') === 'assassin'),
        undefined,
        { among: g.players },
      ),
  },
  {
    id: 'codenames.sharpshooter',
    emoji: '🎯',
    title: 'Sharpshooter',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'accuracy',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} found {n} agents. Suspiciously psychic', '{who} found {n} agents. Peeking?'],
      wholesome: ['{who} found {n} agents for the team', '{who} tracked down {n} agents'],
    },
    compute: (g) => mostBy(guesses(g).filter(isCorrect), undefined, { min: 3 }),
  },
  {
    id: 'codenames.galaxy-brain',
    emoji: '🧠',
    title: 'Galaxy Brain',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who}\'s "{w} {n}" cashed in every single one',
        '{who}\'s "{w} {n}" landed all {n}. Show-off',
      ],
      wholesome: [
        '{who}\'s clue "{w} {n}" linked {n} words beautifully',
        '{who} tied {n} words together with "{w}"',
      ],
    },
    compute: (g) => {
      const best = clueRuns(g)
        .filter((r) => r.count >= 3 && r.giver && cashed(r))
        .sort((a, b) => b.count - a.count);
      const top = best[0];
      if (!top) return [];
      return [
        {
          players: [top.giver!],
          value: top.count,
          runnerUp: best[1]?.count ?? 0,
          params: { w: plain(str(top.clue, 'word')).toUpperCase() },
        },
      ];
    },
  },
  {
    id: 'codenames.bonus-round',
    emoji: '🎰',
    title: 'Bonus Round',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} used the sneaky extra guess, and it hit',
        '{who} cashed the bonus guess {n|time}. Greedy, but right',
      ],
      wholesome: [
        '{who} remembered an old clue and scored the bonus',
        '{who} made the extra guess count {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        guesses(g).filter((e) => {
          const no = num(e, 'guessNo');
          // A clue for 0 or unlimited has no bonus guess.
          const count = num(e, 'clueCount');
          return (
            isCorrect(e) && no !== undefined && count !== undefined && count > 0 && no === count + 1
          );
        }),
      ),
  },
  {
    id: 'codenames.friendly-fire',
    emoji: '🤝',
    title: 'Friendly Fire',
    wholesomeTitle: 'Generous Spirit',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'blunder',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} found {n} agents… for the other team',
        '{who} handed the rivals {n} agents. Double agent?',
      ],
      wholesome: [
        '{who} generously shared {n} agents with the rivals',
        '{who} helped both teams: {n} agents for the rivals',
      ],
    },
    compute: (g) => mostBy(guesses(g).filter((e) => str(e, 'kind') === other(str(e, 'team')))),
  },
  {
    id: 'codenames.bystander-tour',
    emoji: '😶',
    title: 'Bystander Tour',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'blunder',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} met {n} innocent bystanders', '{who} toured {n} bystanders. Sightseeing'],
      wholesome: ['{who} said hello to {n} bystanders', '{who} made {n} new bystander friends'],
    },
    compute: (g) =>
      mostBy(
        guesses(g).filter((e) => str(e, 'kind') === 'bystander'),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'codenames.quick-draw',
    emoji: '⚡',
    title: 'Quick Draw',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'speed',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} guessed in {s} s. Did they even read it?',
        '{who} guessed in {s} s flat. Trigger happy',
      ],
      wholesome: [
        '{who} guessed in {s} s on average',
        '{who} was quick on the draw: {s} s a guess',
      ],
    },
    compute: (g) =>
      withSeconds(
        leaders(
          meanBy(guesses(g), (e) => num(e, 'actMs'), 3),
          { lowest: true },
        ),
      ),
  },
  {
    id: 'codenames.deep-thinker',
    emoji: '🐢',
    title: 'Deep Thinker',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'speed',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} took {s} s per clue. We aged', '{who} spent {s} s on each clue. Worth it?'],
      wholesome: [
        '{who} crafted every clue with care ({s} s each)',
        '{who} gave each clue {s} s of thought',
      ],
    },
    compute: (g) => withSeconds(leaders(meanBy(g.of('clue'), (e) => num(e, 'actMs'), 2))),
  },
  {
    id: 'codenames.the-closer',
    emoji: '🏁',
    title: 'The Closer',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'clutch',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} flipped the winning agent', '{who} found the last agent and took a bow'],
      wholesome: ['{who} found the final agent', '{who} sealed the win with the last agent'],
    },
    compute: (g) => {
      const last = lastAgentGuess(g);
      return last?.playerId && isCorrect(last) ? [{ players: [last.playerId], value: 1 }] : [];
    },
  },
  {
    id: 'codenames.own-goal-victory',
    emoji: '🎁',
    title: 'Own-Goal Victory',
    valence: 'chaos',
    weight: 5,
    kind: 'moment',
    family: 'clutch',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who} flipped the rivals' last agent and handed them the win",
        "{who} flipped the rivals' final agent. Game over, for them",
      ],
      wholesome: [
        '{who} helped finish the game. For the other side',
        '{who} gave the rivals their final agent, a true sport',
      ],
    },
    compute: (g) => {
      const last = lastAgentGuess(g);
      const kind = str(last, 'kind');
      return last?.playerId && kind === other(str(last, 'team'))
        ? [{ players: [last.playerId], value: 1 }]
        : [];
    },
  },
  {
    id: 'codenames.speedrun',
    emoji: '⏱️',
    title: 'Speedrun',
    valence: 'chaos',
    weight: 5,
    kind: 'moment',
    family: 'blunder',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} found the assassin on the very first guess',
        '{who} ended the game on guess one. A record, probably',
      ],
      wholesome: [
        '{who} made it a lightning-fast game: assassin, guess one',
        '{who} opened with the assassin. Quick rematch, then',
      ],
    },
    compute: (g) => {
      const first = guesses(g)[0];
      return first?.playerId && str(first, 'kind') === 'assassin'
        ? [{ players: [first.playerId], value: 1 }]
        : [];
    },
  },
  {
    id: 'codenames.comeback',
    emoji: '📈',
    title: 'Comeback',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'clutch',
    minPlayers: 4,
    copy: {
      cheeky: [
        'Team {team} trailed by {n} agents and won anyway',
        'Team {team} was {n} agents behind. Then it was not',
      ],
      wholesome: [
        'Team {team} came back from {n} agents behind',
        'Team {team} never gave up, {n} agents down',
      ],
    },
    compute: (g) => {
      const hole = deepestHole(g);
      const winner = str(outcome(g), 'winner');
      if (hole === null || hole < 4 || !winner) return [];
      return [{ players: [...g.winners].sort(), value: hole, params: { team: teamName(winner) } }];
    },
  },
  {
    id: 'codenames.perfect-cash',
    emoji: '💰',
    title: 'Perfect Cash',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: ['{who}\'s "{w} {n}" found all {n}. Frame it', 'All {n} from {who}\'s "{w}". Clean'],
      wholesome: [
        '{who}\'s "{w}" found all {n} agents in one go',
        'One clue, {n} agents: {who}\'s "{w}"',
      ],
    },
    compute: (g) => {
      const top = clueRuns(g)
        .filter((r) => r.count >= 4 && r.giver && cashed(r))
        .sort((a, b) => b.count - a.count)[0];
      return top
        ? [
            {
              players: [top.giver!],
              value: top.count,
              params: { w: plain(str(top.clue, 'word')).toUpperCase() },
            },
          ]
        : [];
    },
  },
  {
    id: 'codenames.big-swing',
    emoji: '🧨',
    title: 'Big Swing',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} went for a {n}-word clue. Bold', '{who} called a {n}. Ambition: unlimited'],
      wholesome: ['{who} aimed high with a {n}-word clue', '{who} dreamed big: a clue for {n}'],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const e of g.of('clue')) {
        const n = num(e, 'count') ?? 0;
        if (e.playerId) best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, n));
      }
      return leaders(best, { min: 4 });
    },
  },
  {
    id: 'codenames.spotless-spymaster',
    emoji: '🛡️',
    title: 'Spotless Spymaster',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clue',
    minPlayers: 4,
    copy: {
      cheeky: [
        "{who}'s team never hit a wrong card off their clues",
        '{who} gave {n} clues and zero wrong turns. Smug',
      ],
      wholesome: [
        '{who} gave {n} clues without a single mishap',
        "{who}'s {n} clues kept the team on track",
      ],
    },
    compute: (g) => {
      const per = new Map<string, { clues: number; clean: boolean }>();
      for (const run of clueRuns(g)) {
        if (!run.giver) continue;
        const s = per.get(run.giver) ?? { clues: 0, clean: true };
        s.clues += 1;
        if (run.guesses.some((e) => !isCorrect(e))) s.clean = false;
        per.set(run.giver, s);
      }
      const clean = new Map(
        [...per].filter(([, s]) => s.clean && s.clues >= 3).map(([id, s]) => [id, s.clues]),
      );
      return leaders(clean, { min: 3 });
    },
  },
  {
    id: 'codenames.hot-streak',
    emoji: '🔥',
    title: 'Hot Streak',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'accuracy',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} went {n} for {n}. Unstoppable', '{who} hit {n} in a row. Save some for us'],
      wholesome: ['{who} found {n} in a row', '{who} was on a roll: {n} straight agents'],
    },
    compute: (g) => {
      const run = new Map<string, number>();
      const best = new Map<string, number>();
      for (const e of guesses(g)) {
        if (!e.playerId) continue;
        const n = isCorrect(e) ? (run.get(e.playerId) ?? 0) + 1 : 0;
        run.set(e.playerId, n);
        best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, n));
      }
      return leaders(best, { min: 4 });
    },
  },
  {
    id: 'codenames.pass-master',
    emoji: '🙅',
    title: 'Pass Master',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'caution',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} passed {n} times. Cautious', '{who} hit "end turn" {n} times. Wise? Maybe'],
      wholesome: ['{who} knew when to stop, {n} times', '{who} played it safe {n} times'],
    },
    compute: (g) =>
      mostBy(
        g.of('end-turn').filter((e) => str(e, 'reason') === 'passed'),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'codenames.clue-collector',
    emoji: '🎓',
    title: 'Clue Collector',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'volume',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} gave {n} clues. Chatty', '{who} handed out {n} clues like flyers'],
      wholesome: ['{who} led the team with {n} clues', '{who} guided the team through {n} clues'],
    },
    compute: (g) => mostBy(g.of('clue'), undefined, { min: 4 }),
  },
];

/** Adds `{s}` (seconds) to timing candidates. */
function withSeconds(cands: AwardCandidate[]): AwardCandidate[] {
  return cands.map((c) => ({ ...c, params: { ...c.params, s: seconds(c.value) } }));
}

const all = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

const nuggets: NuggetRule[] = [
  {
    id: 'codenames.clues',
    emoji: '💬',
    interest: 2,
    compute: (games) => {
      const clues = all(games, 'clue');
      if (!clues.length) return null;
      const mean = clues.reduce((s, e) => s + (num(e, 'count') ?? 0), 0) / clues.length;
      return {
        value: clues.length,
        text: `${count(clues.length, 'clue')}, ${mean.toFixed(1)} words each`,
      };
    },
  },
  {
    id: 'codenames.accuracy',
    emoji: '🎯',
    interest: 3,
    compute: (games) => {
      const gs = all(games, 'guess');
      if (gs.length < 3) return null;
      const right = pct(gs.filter(isCorrect).length, gs.length);
      return { value: right, text: `${count(gs.length, 'guess', 'guesses')} · ${right}% right` };
    },
  },
  {
    id: 'codenames.assassins',
    emoji: '💀',
    interest: 3,
    compute: (games) => {
      const n = all(games, 'guess').filter((e) => str(e, 'kind') === 'assassin').length;
      return n ? { value: n, text: `${n} assassin${n === 1 ? '' : 's'} found` } : null;
    },
  },
  {
    id: 'codenames.biggest-cash',
    emoji: '💰',
    interest: 4,
    record: 'max',
    compute: (games) => {
      const best = games
        .flatMap(clueRuns)
        .filter(cashed)
        .sort((a, b) => b.count - a.count)[0];
      if (!best || best.count < 2) return null;
      const w = plain(str(best.clue, 'word')).toUpperCase();
      return { value: best.count, text: `Biggest clue cashed: "${w} ${best.count}"` };
    },
  },
  {
    id: 'codenames.fastest-guess',
    emoji: '⚡',
    interest: 2,
    record: 'min',
    compute: (games) => {
      const times = all(games, 'guess')
        .map((e) => num(e, 'actMs'))
        .filter((v): v is number => v !== undefined && v > 0);
      if (!times.length) return null;
      const s = seconds(Math.min(...times));
      return { value: s, text: `Fastest guess: ${s} s` };
    },
  },
  {
    id: 'codenames.length',
    emoji: '⏱️',
    interest: 1,
    compute: (games) => {
      if (!games.length) return null;
      const mins = Math.round(
        games.reduce((s, g) => s + Math.max(0, g.endedAt - g.startedAt), 0) / games.length / 60_000,
      );
      return mins ? { value: mins, text: `${mins} min a game` } : null;
    },
  },
  {
    id: 'codenames.team-wins',
    emoji: '🏆',
    interest: 2,
    compute: (games) => {
      const wins = tally(all(games, 'outcome'), (e) => str(e, 'winner'));
      const red = wins.get('red') ?? 0;
      const blue = wins.get('blue') ?? 0;
      return red + blue >= 2 ? { value: red + blue, text: `Red ${red} · Blue ${blue}` } : null;
    },
  },
];

/** One line per clue (the most recent ones if the game ran long). */
function history(g: GameEvents): string[] {
  const runs = clueRuns(g);
  const lines = runs.map((r) => {
    const word = plain(str(r.clue, 'word')).toUpperCase();
    const found = correctIn(r);
    const assassin = r.guesses.some((e) => str(e, 'kind') === 'assassin');
    const who = r.giver ? ph.p(r.giver) : 'Someone';
    const said = countText(num(r.clue, 'count') ?? null);
    return `${teamName(r.team)}: ${who} gave "${word} ${said}", ${found} found${assassin ? ', then the assassin' : ''}`;
  });
  if (lines.length <= 12) return lines;
  return [`${lines.length - 12} earlier clues…`, ...lines.slice(-11)];
}

export const codenamesAwards: AwardModule = { rules, nuggets, history };
