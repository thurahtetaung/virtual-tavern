import type { GameFigure } from '@vt/protocol';

// Game insight events are reduced to additive daily counters (`f.*`, or `max.f.*` for maxima) so
// figures survive raw-event pruning, and a rolled-up day reads exactly like its raw events. The
// event shapes read here are the games' `insights()` output:
//   codenames  clue {count, team}, guess {kind, correct}, outcome {winner, winReason}
//   enigma     decode {success}, intercept {success}, outcome {winner, round}
//   echo       card {outcome: right|wrong|pass}, match {a, b, word}, outcome {score, deckSize}
//   reverie    story {allOrNone}, vote {found}, outcome {target}
//   hoodwink   lie {fooled, authors, auto}, vote {foundTruth}, round {…}, outcome {rounds}

type Props = Record<string, unknown>;
type Counters = [metric: string, value: number][];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.length <= 40 ? v : null);

const hasWord = (props: Props, kind: string) =>
  Array.isArray(props.words) &&
  props.words.some((w) => (w as { kind?: unknown } | null)?.kind === kind);

/** A Codenames guess that hit the assassin. */
export const isAssassinGuess = (props: Props) =>
  props.kind === 'assassin' || hasWord(props, 'assassin');

/** Echo games that scored every card. */
export const isPerfectEcho = (props: Props) => {
  const score = num(props.score);
  const deck = num(props.deckSize);
  return score !== null && deck !== null && deck > 0 && score >= deck;
};

/** Daily counters for one insight event. */
export function figureCounters(gameId: string, type: string, props: Props): Counters {
  const out: Counters = [];
  const flag = (metric: string, v: unknown) => {
    out.push([`f.${metric}`, 1]);
    if (v === true) out.push([`f.${metric}_yes`, 1]);
  };
  const winner = str(props.winner);
  switch (`${gameId}:${type}`) {
    case 'codenames:clue':
      out.push(['f.clues', 1], ['f.clue_sum', num(props.count) ?? 0]);
      break;
    case 'codenames:guess':
      flag('guesses', props.correct);
      if (isAssassinGuess(props)) out.push(['f.assassin_hits', 1]);
      break;
    case 'codenames:outcome':
      out.push(['f.games', 1]);
      if (winner) out.push([`f.win.${winner}`, 1]);
      if (props.winReason === 'assassin') out.push(['f.assassin_ends', 1]);
      break;
    case 'enigma:decode':
      flag('decodes', props.success);
      break;
    case 'enigma:intercept':
      flag('intercepts', props.success);
      break;
    case 'enigma:outcome':
      out.push(['f.games', 1], ['f.round_sum', num(props.round) ?? 0]);
      if (winner) out.push([`f.win.${winner}`, 1]);
      break;
    case 'echo:card': {
      out.push(['f.cards', 1]);
      const outcome = str(props.outcome);
      if (outcome) out.push([`f.card.${outcome}`, 1]);
      break;
    }
    case 'echo:outcome': {
      const score = num(props.score);
      out.push(['f.games', 1]);
      if (score !== null) {
        out.push([`f.score.${Math.round(score)}`, 1], ['max.f.best', score]);
        out.push(['f.score_sum', score]);
      }
      if (isPerfectEcho(props)) out.push(['f.perfect', 1]);
      break;
    }
    case 'reverie:story':
      flag('stories', props.allOrNone);
      break;
    case 'reverie:vote':
      flag('votes', props.found);
      break;
    case 'reverie:outcome':
      out.push(['f.games', 1], ['f.target_sum', num(props.target) ?? 0]);
      break;
    case 'hoodwink:lie': {
      const fooled = num(props.fooled) ?? 0;
      out.push(['f.lies', 1], ['f.fooled_sum', fooled]);
      if (fooled > 0) out.push(['f.lies_fooling', 1]);
      break;
    }
    case 'hoodwink:vote':
      flag('votes', props.foundTruth);
      break;
    case 'hoodwink:outcome':
      out.push(['f.games', 1], ['f.round_sum', num(props.rounds) ?? 0]);
      break;
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** Percent (0–100, one decimal) of `part` in `whole`; 0 when there is nothing to divide. */
export const pct = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : 0);
const avg = (sum: number, n: number) => (n > 0 ? round1(sum / n) : 0);

/** A game's figures from its summed counters (`get` returns 0 for missing ones). */
export function buildFigures(
  gameId: string,
  get: (metric: string) => number,
  metrics: Iterable<string>,
): GameFigure[] {
  const games = get('f.games');
  const teams = (draw: boolean): GameFigure => ({
    id: 'wins',
    label: 'Wins by team',
    kind: 'split',
    parts: [
      { label: 'Red', value: get('f.win.red') },
      { label: 'Blue', value: get('f.win.blue') },
      ...(draw ? [{ label: 'Draw', value: get('f.win.draw') }] : []),
    ],
  });
  switch (gameId) {
    case 'codenames':
      return [
        teams(false),
        {
          id: 'assassin-rate',
          label: 'Games ended by the assassin',
          kind: 'percent',
          value: pct(get('f.assassin_ends'), games),
        },
        {
          id: 'average-clue',
          label: 'Average clue number',
          kind: 'number',
          value: avg(get('f.clue_sum'), get('f.clues')),
        },
        {
          id: 'guess-accuracy',
          label: 'Guesses that found their own agent',
          kind: 'percent',
          value: pct(get('f.guesses_yes'), get('f.guesses')),
        },
      ];
    case 'enigma':
      return [
        teams(true),
        {
          id: 'decode-rate',
          label: 'Codes decoded by their own team',
          kind: 'percent',
          value: pct(get('f.decodes_yes'), get('f.decodes')),
        },
        {
          id: 'intercept-rate',
          label: 'Interception attempts that worked',
          kind: 'percent',
          value: pct(get('f.intercepts_yes'), get('f.intercepts')),
        },
        {
          id: 'rounds-per-game',
          label: 'Rounds per game',
          kind: 'number',
          value: avg(get('f.round_sum'), games),
        },
      ];
    case 'echo': {
      const scores = [...metrics]
        .filter((m) => m.startsWith('f.score.'))
        .map((m) => Number(m.slice(8)))
        .filter((n) => Number.isInteger(n) && n >= 0);
      const top = scores.length ? Math.max(...scores) : 0;
      return [
        {
          id: 'scores',
          label: 'Scores',
          kind: 'histogram',
          bins: scores.length
            ? Array.from({ length: top + 1 }, (_, n) => ({
                label: String(n),
                value: get(`f.score.${n}`),
              }))
            : [],
        },
        { id: 'best-score', label: 'Best score', kind: 'number', value: get('max.f.best') },
        {
          id: 'average-score',
          label: 'Average score',
          kind: 'number',
          value: avg(get('f.score_sum'), games),
        },
        { id: 'perfect-games', label: 'Perfect games', kind: 'number', value: get('f.perfect') },
        {
          id: 'right-rate',
          label: 'Cards guessed right',
          kind: 'percent',
          value: pct(get('f.card.right'), get('f.cards')),
        },
        {
          id: 'pass-rate',
          label: 'Cards passed',
          kind: 'percent',
          value: pct(get('f.card.pass'), get('f.cards')),
        },
      ];
    }
    case 'reverie':
      return [
        {
          id: 'all-or-none',
          label: 'Stories everyone or nobody found',
          kind: 'percent',
          value: pct(get('f.stories_yes'), get('f.stories')),
        },
        {
          id: 'found-rate',
          label: "Votes that found the storyteller's card",
          kind: 'percent',
          value: pct(get('f.votes_yes'), get('f.votes')),
        },
        {
          id: 'average-target',
          label: 'Average target score',
          kind: 'number',
          value: avg(get('f.target_sum'), games),
        },
      ];
    case 'hoodwink':
      return [
        {
          id: 'truth-rate',
          label: 'Votes that found the truth',
          kind: 'percent',
          value: pct(get('f.votes_yes'), get('f.votes')),
        },
        {
          id: 'fooling-rate',
          label: 'Lies that fooled someone',
          kind: 'percent',
          value: pct(get('f.lies_fooling'), get('f.lies')),
        },
        {
          id: 'fooled-per-lie',
          label: 'Players fooled per lie',
          kind: 'number',
          value: avg(get('f.fooled_sum'), get('f.lies')),
        },
      ];
    default:
      return [];
  }
}
