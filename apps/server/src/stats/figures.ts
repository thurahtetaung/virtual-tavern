import type { GameFigure } from '@vt/protocol';

// Game insight events are reduced to additive daily counters (`f.*`, or `max.f.*` for maxima) so
// figures survive raw-event pruning, and a rolled-up day reads exactly like its raw events. The
// event shapes read here are the games' `insights()` output:
//   codenames  clue {count, team}, guess {kind, correct}, outcome {winner, winReason}
//   enigma     decode {success}, intercept {success}, outcome {winner, round}
//   echo       card {outcome: right|wrong|pass}, match {a, b, word}, outcome {score, deckSize}
//   reverie    story {allOrNone}, vote {found}, outcome {target}
//   hoodwink   lie {fooled, authors, auto}, vote {foundTruth}, round {…}, outcome {rounds}
//   royal-post play {card}, guard {hit}, elimination {cause, lostPrincess}, spy {},
//              outcome {edition, rounds}
//   masquerade (and masquerade-originals) round {location, spyWon}, spy {outcome, votes},
//              vote {hit, target}, outcome {rounds}

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

/** Royal Post's cards, in rank order: the causes a knock-out can be credited to. */
const ROYAL_POST_CARDS = [
  'spy',
  'guard',
  'priest',
  'baron',
  'handmaid',
  'prince',
  'chancellor',
  'king',
  'countess',
  'princess',
];

/** A Royal Post knock-out that cost the player the Princess. */
export const lostPrincess = (props: Props) => props.lostPrincess === true;

/** Both Masquerade editions report the same events. */
export const isMasquerade = (gameId: string) =>
  gameId === 'masquerade' || gameId === 'masquerade-originals';

/** How a Masquerade round ended for one spy. */
const SPY_OUTCOMES = ['escaped', 'stole', 'caught'];

/** Daily counters for one insight event. */
export function figureCounters(gameId: string, type: string, props: Props): Counters {
  const out: Counters = [];
  const flag = (metric: string, v: unknown) => {
    out.push([`f.${metric}`, 1]);
    if (v === true) out.push([`f.${metric}_yes`, 1]);
  };
  const winner = str(props.winner);
  if (isMasquerade(gameId)) {
    switch (type) {
      case 'round':
        out.push(['f.rounds', 1]);
        if (props.spyWon === true) out.push(['f.spy_rounds', 1]);
        break;
      case 'spy': {
        const outcome = str(props.outcome);
        out.push(['f.spies', 1]);
        if (outcome && SPY_OUTCOMES.includes(outcome)) out.push([`f.spy.${outcome}`, 1]);
        break;
      }
      case 'vote':
        flag('votes', props.hit);
        break;
      case 'outcome':
        out.push(['f.games', 1], ['f.round_sum', num(props.rounds) ?? 0]);
        break;
    }
    return out;
  }
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
    case 'royal-post:guard':
      flag('guards', props.hit);
      break;
    case 'royal-post:elimination': {
      const cause = str(props.cause);
      out.push(['f.knockouts', 1]);
      if (cause && ROYAL_POST_CARDS.includes(cause)) out.push([`f.kill.${cause}`, 1]);
      break;
    }
    case 'royal-post:spy':
      out.push(['f.spy_bonus', 1]);
      break;
    case 'royal-post:outcome': {
      out.push(['f.games', 1], ['f.round_sum', num(props.rounds) ?? 0]);
      const edition = str(props.edition);
      const won = Array.isArray(props.winners) && props.winners.length > 0;
      if (won && (edition === 'classic' || edition === '2019')) out.push([`f.win.${edition}`, 1]);
      break;
    }
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
  if (isMasquerade(gameId)) {
    return [
      {
        id: 'round-outcomes',
        label: 'How spies ended their rounds',
        kind: 'split',
        parts: [
          { label: 'Escaped the vote', value: get('f.spy.escaped') },
          { label: 'Caught, then stole it', value: get('f.spy.stole') },
          { label: 'Caught for good', value: get('f.spy.caught') },
        ],
      },
      {
        id: 'spy-win-rate',
        label: 'Spies who won their round',
        kind: 'percent',
        value: pct(get('f.spy.escaped') + get('f.spy.stole'), get('f.spies')),
      },
      {
        id: 'vote-accuracy',
        label: 'Votes that found a spy',
        kind: 'percent',
        value: pct(get('f.votes_yes'), get('f.votes')),
      },
      {
        id: 'rounds-per-game',
        label: 'Rounds per game',
        kind: 'number',
        value: avg(get('f.round_sum'), games),
      },
    ];
  }
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
    case 'royal-post':
      return [
        {
          id: 'wins-by-edition',
          label: 'Wins by edition',
          kind: 'split',
          parts: [
            { label: 'Classic', value: get('f.win.classic') },
            { label: '2019', value: get('f.win.2019') },
          ],
        },
        {
          id: 'rounds-per-game',
          label: 'Rounds per game',
          kind: 'number',
          value: avg(get('f.round_sum'), games),
        },
        {
          id: 'knockouts-by-card',
          label: 'Knock-outs by card (most lethal first)',
          kind: 'split',
          parts: ROYAL_POST_CARDS.map((card) => ({
            label: card[0]!.toUpperCase() + card.slice(1),
            value: get(`f.kill.${card}`),
          }))
            .filter((p) => p.value > 0)
            .sort((a, b) => b.value - a.value),
        },
        {
          id: 'guard-accuracy',
          label: 'Guard guesses that were right',
          kind: 'percent',
          value: pct(get('f.guards_yes'), get('f.guards')),
        },
        { id: 'spy-bonuses', label: 'Spy bonus tokens', kind: 'number', value: get('f.spy_bonus') },
      ];
    default:
      return [];
  }
}
