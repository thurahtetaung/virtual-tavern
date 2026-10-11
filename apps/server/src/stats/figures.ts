import type { GameFigure } from '@vt/protocol';

// Game insight events are reduced to additive daily counters (`f.*`, or `max.f.*` for maxima) so
// figures survive raw-event pruning, and a rolled-up day reads exactly like its raw events. The
// event shapes read here are the games' `insights()` output (the night recap's award rules read
// the same events, plus the props marked "recap"):
//   codenames  clue {count, team}, guess {kind, correct; recap: clueWord, clueCount, guessNo},
//              end-turn {reason, team; recap: stage, playerId on passes},
//              outcome {winner, winReason; recap: startingTeam, redLeft, blueLeft, spymasters}
//   enigma     decode {success; recap: encryptor, voters, guess},
//              intercept {success; recap: encryptor, voters}, outcome {winner, round; recap:
//              redIntercepts, redMisses, blueIntercepts, blueMisses, reason}
//   echo       card {outcome: right|wrong|pass; recap: survivors, survivorWords, givers, auto},
//              match {a, b, word}, outcome {score, deckSize}
//   reverie    story {allOrNone}, vote {found; recap: owner}, outcome {target; recap: ranking,
//              scores}; recap: score {round, points, votesReceived, total, storyteller}
//   hoodwink   lie {fooled, authors, auto; recap: autoAuthors}, vote {foundTruth; recap: authors,
//              house}, round {…; recap: double, pointsTo, points}, outcome {rounds; recap:
//              ranking, scores, fooled, truths}
//   royal-post play {card; recap: target, tie, auto}, guard {hit}, elimination {cause,
//              lostPrincess; recap: cards}, spy {}, round {recap: survivors, finalCards,
//              tokensTo}, outcome {edition, rounds; recap: ranking, tokens}
//   masquerade (and masquerade-originals) round {location, spyWon; recap: named, starter,
//              pointsTo, points}, spy {outcome, votes; recap: round}, vote {hit, target; recap:
//              round}, outcome {rounds; recap: ranking, scores}
//   nightfall  outcome {players, teams, teamsWon, ending, nightMs, dayMs, moves, chain,
//              movedRoles, setup, epic, loveDeaths, vampireMark}, player {dealt, won, voted,
//              votedWolf, votedRole, vampire, heartbreaks, plague, hitman, …; recap:
//              votesReceived, deathCause, deathPlace, converted, autoActions}, look {role, right}

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

const id = (v: unknown) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.map(id).filter((x) => x !== null) : []);

/** Nightfall's teams and how its games end, in display order. */
const NIGHTFALL_TEAMS: [string, string][] = [
  ['village', 'Village'],
  ['werewolf', 'Werewolves'],
  ['tanner', 'Tanner'],
  ['vampire', 'Vampires'],
  ['assassin', 'Assassin'],
  ['apprentice-assassin', 'Apprentice Assassin'],
];
/** Teams that only show once they have played (the later sets). */
const NIGHTFALL_LATER_TEAMS = new Set(['vampire', 'assassin', 'apprentice-assassin']);
const NIGHTFALL_ENDINGS: [string, string][] = [
  ['werewolf-caught', 'A werewolf was caught'],
  ['wolves-survived', 'The werewolves got away'],
  ['tanner', 'The Tanner died'],
  ['nobody-died', 'Nobody died'],
  ['hunter', 'The Hunter took someone along'],
  ['heartbreak', 'A lover took another along'],
  ['vampire-caught', 'A vampire was caught'],
  ['vampires-survived', 'The vampires got away'],
  ['wrong-player', 'Only the innocent died'],
];
/** What became of the Mark of the Vampire. */
const VAMPIRE_MARK_FATES = ['kept', 'moved', 'cleansed'];

function nightfallCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      const n = num(props.players);
      out.push(['f.games', 1]);
      if (n !== null) out.push([`f.n.${n}`, 1]);
      for (const t of ids(props.teams)) {
        out.push([`f.team.${t}`, 1]);
        if (n !== null) out.push([`f.team.${t}.n${n}`, 1]);
      }
      const won = ids(props.teamsWon);
      for (const t of won) {
        out.push([`f.win.${t}`, 1]);
        if (n !== null) out.push([`f.win.${t}.n${n}`, 1]);
      }
      if (!won.length) out.push(['f.win.nobody', 1]);
      const ending = id(props.ending);
      if (ending) out.push([`f.ending.${ending}`, 1]);
      const night = num(props.nightMs);
      if (night !== null) out.push(['f.night_ms', night], ['f.night_n', 1]);
      const day = num(props.dayMs);
      if (day !== null) out.push(['f.day_ms', day], ['f.day_n', 1]);
      out.push(['f.moves', num(props.moves) ?? 0], ['max.f.chain', num(props.chain) ?? 0]);
      for (const r of ids(props.movedRoles)) out.push([`f.moved.${r}`, 1]);
      for (const r of ids(props.setup)) out.push([`f.setup.${r}`, 1]);
      if (props.epic === true) out.push(['f.epic', 1]);
      const love = num(props.loveDeaths) ?? 0;
      if (love > 0) out.push(['f.love_deaths', love], ['f.love_games', 1]);
      const fate = id(props.vampireMark);
      if (fate && VAMPIRE_MARK_FATES.includes(fate)) out.push([`f.vmark.${fate}`, 1]);
      break;
    }
    case 'player': {
      const dealt = id(props.dealt);
      if (dealt) {
        out.push([`f.dealt.${dealt}`, 1]);
        if (props.won === true) out.push([`f.dealt_win.${dealt}`, 1]);
      }
      if (props.voted === true) {
        out.push(['f.votes', 1]);
        if (props.votedWolf === true) out.push(['f.votes_wolf', 1]);
        const role = id(props.votedRole);
        if (role) out.push([`f.voted.${role}`, 1]);
      }
      break;
    }
    case 'look': {
      const role = id(props.role);
      if (role) {
        out.push([`f.look.${role}`, 1]);
        if (props.right === true) out.push([`f.look_right.${role}`, 1]);
      }
      break;
    }
  }
  return out;
}

/** A role id as a label: "alpha-wolf" → "Alpha wolf" (names are private; ids are not). */
const roleWords = (r: string) => r[0]!.toUpperCase() + r.slice(1).replace(/-/g, ' ');

function nightfallFigures(
  get: (metric: string) => number,
  metrics: Iterable<string>,
): GameFigure[] {
  const list = [...metrics];
  const suffixes = (prefix: string) =>
    [
      ...new Set(list.filter((m) => m.startsWith(prefix)).map((m) => m.slice(prefix.length))),
    ].filter((s) => /^[a-z0-9-]+$/.test(s));
  const games = get('f.games');
  const counts = suffixes('f.n.')
    .map(Number)
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  const teams = NIGHTFALL_TEAMS.filter(([t]) => get(`f.team.${t}`) > 0);
  const byCount = (prefix: string) =>
    suffixes(prefix)
      .map((r) => ({ label: roleWords(r), value: get(`${prefix}${r}`) }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const setup = suffixes('f.setup.').sort(
    (a, b) => get(`f.setup.${b}`) - get(`f.setup.${a}`) || a.localeCompare(b),
  );
  return [
    {
      id: 'wins-by-team',
      label: 'Games won, by team',
      kind: 'split',
      parts: [
        ...NIGHTFALL_TEAMS.filter(
          ([t]) => !NIGHTFALL_LATER_TEAMS.has(t) || get(`f.win.${t}`) > 0,
        ).map(([t, label]) => ({ label, value: get(`f.win.${t}`) })),
        { label: 'Nobody', value: get('f.win.nobody') },
      ],
    },
    ...teams.map(([t, label]): GameFigure => ({
      id: `win-rate-${t}`,
      label: `${label} win rate (games they were in)`,
      kind: 'percent',
      value: pct(get(`f.win.${t}`), get(`f.team.${t}`)),
    })),
    {
      id: 'win-rate-by-players',
      label: 'Win rate by team and table size',
      kind: 'matrix',
      columns: counts.map((n) => `${n} players`),
      units: counts.map(() => 'percent' as const),
      rows: teams.map(([t, label]) => ({
        label,
        values: counts.map((n) => pct(get(`f.win.${t}.n${n}`), get(`f.team.${t}.n${n}`))),
      })),
    },
    {
      id: 'endings',
      label: 'How games end',
      kind: 'split',
      parts: NIGHTFALL_ENDINGS.map(([e, label]) => ({ label, value: get(`f.ending.${e}`) })),
    },
    {
      id: 'roles',
      label: 'Roles: how often they’re in, and how often their holder wins',
      kind: 'matrix',
      columns: ['Games in the setup', 'Dealt to a player', 'Holder won'],
      units: ['count', 'count', 'percent'],
      rows: setup.map((r) => ({
        label: roleWords(r),
        values: [
          get(`f.setup.${r}`),
          get(`f.dealt.${r}`),
          pct(get(`f.dealt_win.${r}`), get(`f.dealt.${r}`)),
        ],
      })),
    },
    {
      id: 'moved-roles',
      label: 'Cards moved most at night',
      kind: 'split',
      parts: byCount('f.moved.'),
    },
    {
      id: 'moves-per-night',
      label: 'Cards moved per night',
      kind: 'number',
      value: avg(get('f.moves'), games),
    },
    {
      id: 'longest-chain',
      label: 'Most moves of a single card in one night',
      kind: 'number',
      value: get('max.f.chain'),
    },
    {
      id: 'seer-accuracy',
      label: 'Seer looks still true at dawn',
      kind: 'percent',
      value: pct(get('f.look_right.seer'), get('f.look.seer')),
    },
    {
      id: 'pi-accuracy',
      label: 'P.I. looks still true at dawn',
      kind: 'percent',
      value: pct(
        get('f.look_right.paranormal-investigator'),
        get('f.look.paranormal-investigator'),
      ),
    },
    {
      id: 'voted-roles',
      label: 'Who the votes landed on (role at dawn)',
      kind: 'split',
      parts: byCount('f.voted.'),
    },
    {
      id: 'vote-accuracy',
      label: 'Votes on a real werewolf',
      kind: 'percent',
      value: pct(get('f.votes_wolf'), get('f.votes')),
    },
    {
      id: 'epic-battles',
      label: 'Epic battles (werewolves and vampires at the same table)',
      kind: 'number',
      value: get('f.epic'),
    },
    {
      id: 'vampire-mark-passed',
      label: 'Mark of the Vampire passed on to someone else at night',
      kind: 'percent',
      value: pct(
        get('f.vmark.moved'),
        VAMPIRE_MARK_FATES.reduce((n, f) => n + get(`f.vmark.${f}`), 0),
      ),
    },
    {
      id: 'vampire-mark-fate',
      label: 'What became of the Mark of the Vampire',
      kind: 'split',
      parts: [
        { label: 'Stayed where the vampires put it', value: get('f.vmark.kept') },
        { label: 'Moved by the Pickpocket or Gremlin', value: get('f.vmark.moved') },
        { label: 'Wiped out (Priest or Renfield)', value: get('f.vmark.cleansed') },
      ],
    },
    {
      id: 'love-deaths',
      label: 'Lovers who died of a broken heart',
      kind: 'number',
      value: get('f.love_deaths'),
    },
    {
      id: 'night-length',
      label: 'Average night',
      kind: 'number',
      value: avg(get('f.night_ms') / 1000, get('f.night_n')),
      unit: 's',
    },
    {
      id: 'day-used',
      label: 'Average day before the vote',
      kind: 'number',
      value: avg(get('f.day_ms') / 1000, get('f.day_n')),
      unit: 's',
    },
  ];
}

/** Daily counters for one insight event. */
export function figureCounters(gameId: string, type: string, props: Props): Counters {
  if (gameId === 'nightfall') return nightfallCounters(type, props);
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
    case 'nightfall':
      return nightfallFigures(get, metrics);
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
