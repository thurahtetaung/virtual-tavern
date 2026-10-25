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
//   round-table proposal {approved, approves, rejects, attempt, team; recap: approvers, rejecters,
//              autoVoters, round, slot, size, auto}, quest {fails, success; recap: team, slot,
//              round, size}, lady {target; recap: round}, assassination {target, hit},
//              player {role, side, won}, outcome {winner, reason, players, merlin, proposals,
//              rejected, streak; recap: seats, roles, sides, successes, failures, ladyHolders,
//              ladyTargets, ladyEvil}
//   nightfall  outcome {players, teams, teamsWon, ending, nightMs, dayMs, moves, chain,
//              movedRoles, setup, epic, loveDeaths, vampireMark, aliens, ripple, timeLoop,
//              leaderRule, oracleRule}, player {dealt, won, voted, votedWolf, votedRole, vampire,
//              heartbreaks, plague, hitman, alien, abducted, cow, cowTipped, blobSquad,
//              undertaker, foresaw, synthetic, …; recap:
//              votesReceived, deathCause, deathPlace, converted, autoActions}, look {role, right}
//   inquest    outcome {winner, how, players, solvedRound, solvedFinal, bulletsBeforeSolve, clue, means,
//              allies, labTech, insideMan, protective, perfectCrimes, fsSwitched; recap:
//              solvedBy, solveS, firstTry, fs, murderer, accomplice, witness, witnessFound,
//              bluffers, nearMisses, finalAccusations…}, event {kind}, solve {correct; recap:
//              target, clue, means, round, final}, bullet {recap: tile, item, seq, round, moved} (older events
//              may also carry maxGapS/gapS, which nothing reads any more)
//   seance     outcome {win, how, hour, difficulty, ravens; recap: ghost, players, visions,
//              topLevel…}, vision {cards; recap: to, pillar, hour}, guess {correct, tries; recap:
//              pillar, hour, visions, card}, clairvoyance {hit; recap: target, kind},
//              raven {recap: hour}, finish {recap: hour, level}, vote {recap: group, right}
//   hydra      outcome {winner, how, players, rounds, chaos, vetoes, claimsBlue, liesBlue,
//              claimsRed, liesRed; recap: blue, red, leader, liars, honest, rrrBlue, redBlue,
//              firewall, bloodhound, friendlyFire, executor, ghost, lies, …}, election {passed,
//              tracker; recap: president, chancellor, yes, no, missing, special, zone},
//              session {enacted, vetoed, chaos}, power {kind; recap: target}, claim {kind;
//              recap: blues, cards, team, skipped}, cleared {}, execution {recap: by}
//   tavern-brawl outcome {heroes, winnerHeroes, count, turns, tie, firstWon, dealt, healed;
//              recap: players, knockouts, absorbed, biggestHit, longestChain, finalHp},
//              ko {self, removed; recap: by, card, hero, turn}, play {card, hero; recap: stolen,
//              free, auto}, hit {hp, shield, power; recap: target, self}, heal {amount}, shield,
//              swap, rotate, social {done}, steal {count}
//   short-fuse outcome {players, turns, preset, x1, x4, draws, longestChain, maxOwed, revives; recap:
//              eliminated, maxOwedBy}, play {cards, kind; recap: target}, nope {n},
//              noped {chain, kind, card}, yup {chain}, bomb {kind, saved}, explode {kind, turn,
//              left; recap: placedBy, ghost}, revive {target}, placement {kind, position, of; recap:
//              drawnBy, killed},
//              steal {how, hit; recap: victim, named}, attack {owed; recap: victim}, draw {from},
//              timeout {did, host}
//   starlight  word {round, word, flipped, dark; recap: players, counts}, show {kind, others;
//              recap: round, markers, card, auto}, round {points, dark, fell; recap: round, stars,
//              boxes, marks, total}, outcome {endReason; recap: ranking, scores}
//   thorns     outcome {players, rounds, how; recap: ranking, discs, points}, challenge {success,
//              bid, own; recap: round, total, thornBy, bluffed, flips, points, players},
//              bid {amount; recap: total, opening, auto}, elimination {recap: round, by}
//   iconic     word {level, outcome, how, ms, pieces, helper; recap: word, givers, closeBy, icons,
//              marker, sets, guesses, auto}, outcome {words, rounds; recap: ranking, scores,
//              scoring, length}
//   stampede   round {herdSize, answered, tie, merges, skipped, groups; recap: round, herd,
//              blanks, sizes, scorers, loners, raisedTo}, pink {recap: round, from, how},
//              outcome {rounds, endReason; recap: target, pinkCow, ranking, cows};
//              recap: answer {round, group, herd, alone, with}

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
  ['alien', 'Aliens'],
  ['synthetic', 'Synthetic Alien'],
  ['groob', 'Groob'],
  ['zerb', 'Zerb'],
  ['leader', 'Leader'],
  ['blob', 'Blob'],
  ['mortician', 'Mortician'],
  ['nostradamus', 'Nostradamus'],
];
/** Teams that only show once they have played (the later sets). */
const NIGHTFALL_LATER_TEAMS = new Set([
  'vampire',
  'assassin',
  'apprentice-assassin',
  'alien',
  'synthetic',
  'groob',
  'zerb',
  'leader',
  'blob',
  'mortician',
  'nostradamus',
]);
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
  ['alien-caught', 'An alien was caught'],
  ['aliens-survived', 'The aliens got away'],
  ['synthetic', 'The Synthetic Alien died'],
  ['leader-vote', 'The aliens all voted for the Leader'],
];
/** Endings that only show once they have happened (the later sets). */
const NIGHTFALL_LATER_ENDINGS = new Set([
  'alien-caught',
  'aliens-survived',
  'synthetic',
  'leader-vote',
]);
/** The ripples at the end of an Alien night, by key, with their labels. */
const NIGHTFALL_RIPPLES: Record<string, string> = {
  'one-minute': 'One-minute day',
  'vote-for-app': 'Vote for the app',
  'repeat-role': 'A role repeats',
  'i-am-alien': '“I am an alien”',
  'face-away': 'Face away',
  'two-hand-vote': 'Two-hand vote',
  'no-speak': 'No speaking',
  'view-1': 'View one card',
  'view-2': 'View two cards',
  'dual-view': 'Two players view',
  insomniac: 'Check your own card',
  troublemaker: 'Swap two cards',
  steal: 'Steal a card',
  drunk: 'Blind swap',
  witch: 'Give a centre card',
  reveal: 'Turn a card over',
  shuffle: 'Shuffle two cards',
  'repeat-night': 'Time loop',
  'repeat-observer': 'Time loop, one awake',
};
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
      if (props.aliens === true) out.push(['f.alien_games', 1]);
      const ripple = id(props.ripple);
      if (ripple && ripple in NIGHTFALL_RIPPLES) out.push([`f.ripple.${ripple}`, 1]);
      if (props.timeLoop === true) out.push(['f.time_loop', 1]);
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
      parts: NIGHTFALL_ENDINGS.filter(
        ([e]) => !NIGHTFALL_LATER_ENDINGS.has(e) || get(`f.ending.${e}`) > 0,
      ).map(([e, label]) => ({ label, value: get(`f.ending.${e}`) })),
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
      id: 'ripples',
      label: 'Ripples at the end of an alien night',
      kind: 'split',
      parts: Object.entries(NIGHTFALL_RIPPLES)
        .map(([k, label]) => ({ label, value: get(`f.ripple.${k}`) }))
        .filter((p) => p.value > 0),
    },
    {
      id: 'time-loops',
      label: 'Nights that went round again (a time loop)',
      kind: 'number',
      value: get('f.time_loop'),
    },
    {
      id: 'alien-games',
      label: 'Games with aliens at the table',
      kind: 'number',
      value: get('f.alien_games'),
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

/** Round Table's roles, in lobby order, with their labels (public role names). */
const ROUND_TABLE_ROLES: [string, string][] = [
  ['merlin', 'Merlin'],
  ['percival', 'Percival'],
  ['servant', 'Loyal Servant'],
  ['assassin', 'Assassin'],
  ['morgana', 'Morgana'],
  ['mordred', 'Mordred'],
  ['oberon', 'Oberon'],
  ['minion', 'Minion of Mordred'],
];
const ROUND_TABLE_REASONS = ['quests', 'assassin-missed', 'assassin-hit', 'fails', 'rejections'];

function roundTableCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      const n = num(props.players);
      const side = props.winner === 'good' || props.winner === 'evil' ? props.winner : null;
      out.push(['f.games', 1]);
      if (n !== null) out.push([`f.n.${n}`, 1]);
      if (side) {
        out.push([`f.win.${side}`, 1]);
        if (n !== null) out.push([`f.win.${side}.n${n}`, 1]);
      }
      const reason = id(props.reason);
      if (reason && ROUND_TABLE_REASONS.includes(reason)) out.push([`f.reason.${reason}`, 1]);
      if (typeof props.merlin === 'string' && props.merlin) {
        out.push(['f.merlin_games', 1]);
        if (reason !== 'assassin-hit') out.push(['f.merlin_safe', 1]);
      }
      out.push(['max.f.streak', num(props.streak) ?? 0]);
      break;
    }
    case 'player': {
      const role = id(props.role);
      if (role && ROUND_TABLE_ROLES.some(([r]) => r === role)) {
        out.push([`f.role.${role}`, 1]);
        if (props.won === true) out.push([`f.role_win.${role}`, 1]);
      }
      break;
    }
    case 'proposal':
      out.push(['f.proposals', 1]);
      if (props.approved === true) out.push(['f.proposals_yes', 1]);
      break;
    case 'quest':
      out.push(['f.quests', 1], ['f.fail_sum', num(props.fails) ?? 0]);
      if (props.success === true) out.push(['f.quests_yes', 1]);
      break;
  }
  return out;
}

function roundTableFigures(
  get: (metric: string) => number,
  metrics: Iterable<string>,
): GameFigure[] {
  const games = get('f.games');
  const counts = [
    ...new Set([...metrics].filter((m) => /^f\.n\.\d+$/.test(m)).map((m) => Number(m.slice(4)))),
  ].sort((a, b) => a - b);
  const roles = ROUND_TABLE_ROLES.filter(([r]) => get(`f.role.${r}`) > 0).sort(
    (a, b) => get(`f.role.${b[0]}`) - get(`f.role.${a[0]}`),
  );
  return [
    {
      id: 'wins-by-side',
      label: 'Games won, by side',
      kind: 'split',
      parts: [
        { label: 'Good', value: get('f.win.good') },
        { label: 'Evil', value: get('f.win.evil') },
      ],
    },
    {
      id: 'good-win-rate',
      label: 'Good win rate',
      kind: 'percent',
      value: pct(get('f.win.good'), games),
    },
    {
      id: 'win-rate-by-players',
      label: 'Win rate by side and table size',
      kind: 'matrix',
      columns: counts.map((n) => `${n} players`),
      units: counts.map(() => 'percent' as const),
      rows: (['good', 'evil'] as const).map((side) => ({
        label: side === 'good' ? 'Good' : 'Evil',
        values: counts.map((n) => pct(get(`f.win.${side}.n${n}`), get(`f.n.${n}`))),
      })),
    },
    {
      id: 'evil-wins',
      label: 'How Evil wins',
      kind: 'split',
      parts: [
        { label: 'Three quests sunk', value: get('f.reason.fails') },
        { label: 'Five rejections', value: get('f.reason.rejections') },
        { label: 'Merlin assassinated', value: get('f.reason.assassin-hit') },
      ],
    },
    {
      id: 'merlin-survival',
      label: 'Merlin survived (games with Merlin)',
      kind: 'percent',
      value: pct(get('f.merlin_safe'), get('f.merlin_games')),
    },
    {
      id: 'roles',
      label: 'Roles: how often they’re played, and how often their holder wins',
      kind: 'matrix',
      columns: ['Played', 'Holder won'],
      units: ['count', 'percent'],
      rows: roles.map(([r, label]) => ({
        label,
        values: [get(`f.role.${r}`), pct(get(`f.role_win.${r}`), get(`f.role.${r}`))],
      })),
    },
    {
      id: 'approval-rate',
      label: 'Teams approved',
      kind: 'percent',
      value: pct(get('f.proposals_yes'), get('f.proposals')),
    },
    {
      id: 'quest-success',
      label: 'Quests that succeeded',
      kind: 'percent',
      value: pct(get('f.quests_yes'), get('f.quests')),
    },
    {
      id: 'fails-per-quest',
      label: 'Fail cards per quest',
      kind: 'number',
      value: avg(get('f.fail_sum'), get('f.quests')),
    },
  ];
}

/** Inquest's events, in pile order, with our own names (the tile titles are private). */
const INQUEST_EVENTS: [string, string][] = [
  ['useful-clue', 'Fresh Lead'],
  ['good-twist', 'Second Chance'],
  ['ruled-out', 'Cleared Evidence'],
  ['erroneous', 'Shifted Bullet'],
  ['countdown', 'Last Call'],
  ['testimony', 'Secret Tip'],
  // The Allies expansion's event: only listed once it has come up.
  ['perfect-crime', 'Change of Heart'],
];
/** The Allies expansion's roles, with the side each wins with. */
const INQUEST_ALLIES: [string, string, string][] = [
  ['labTech', 'Lab Technician', 'investigators'],
  ['insideMan', 'Inside Man', 'murderer'],
  ['protective', 'Protective Detail', 'investigators'],
];
/** A card id as Inquest reports it: `clue-17`, `means-4`. */
const inquestCard = (v: unknown, kind: 'clue' | 'means') =>
  typeof v === 'string' && new RegExp(`^${kind}-\\d{1,3}$`).test(v) ? v : null;

function inquestCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      const n = num(props.players);
      out.push(['f.games', 1]);
      if (n !== null) out.push([`f.n.${n}`, 1]);
      if (props.winner === 'murderer') {
        out.push(['f.mwin', 1]);
        if (n !== null) out.push([`f.mwin.n${n}`, 1]);
      }
      const round = num(props.solvedRound);
      if (round !== null) {
        // A right final accusation (the table rule after the last round) has its own bucket.
        const bucket = props.solvedFinal === true ? 'final' : round;
        out.push(['f.solved', 1], [`f.solved_round.${bucket}`, 1]);
        out.push(['f.bullets_before', num(props.bulletsBeforeSolve) ?? 0]);
      }
      if (props.allies === true) {
        out.push(['f.allies', 1]);
        for (const [key, , side] of INQUEST_ALLIES) {
          if (typeof props[key] !== 'string') continue;
          out.push([`f.ally.${key}`, 1]);
          if (props.winner === side) out.push([`f.ally.${key}.win`, 1]);
        }
        const peeks = num(props.perfectCrimes) ?? 0;
        if (peeks) out.push(['f.perfect', peeks]);
        if (props.fsSwitched === true) out.push(['f.perfect.switch', 1]);
      }
      const clue = inquestCard(props.clue, 'clue');
      if (clue) out.push([`f.card.${clue}`, 1]);
      const means = inquestCard(props.means, 'means');
      if (means) out.push([`f.card.${means}`, 1]);
      break;
    }
    case 'event': {
      const kind = str(props.kind);
      if (kind && INQUEST_EVENTS.some(([k]) => k === kind)) out.push([`f.event.${kind}`, 1]);
      break;
    }
    case 'solve':
      out.push(['f.solves', 1]);
      if (props.correct === true) out.push(['f.solves_yes', 1]);
      break;
  }
  return out;
}

function inquestFigures(get: (metric: string) => number, metrics: Iterable<string>): GameFigure[] {
  const list = [...metrics];
  const games = get('f.games');
  const counts = list
    .filter((m) => m.startsWith('f.n.'))
    .map((m) => Number(m.slice(4)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  // Cards go out as `{card:means-4}` placeholders: the stats page names them from the manifest.
  const topCards = (kind: 'clue' | 'means') =>
    list
      .filter((m) => m.startsWith(`f.card.${kind}-`))
      .map((m) => ({ id: m.slice(7), value: get(m) }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
      .slice(0, 8)
      .map((c) => ({ label: `{card:${c.id}}`, value: c.value }));
  const rounds = [1, 2, 3];
  return [
    {
      id: 'solve-rate',
      label: 'Cases solved',
      kind: 'percent',
      value: pct(get('f.solved'), games),
    },
    {
      id: 'murderer-win-rate',
      label: 'Games the Murderer’s side won',
      kind: 'percent',
      value: pct(get('f.mwin'), games),
    },
    {
      id: 'solves-by-round',
      label: 'Cases solved, by round',
      kind: 'split',
      parts: [
        ...rounds.map((r) => ({ label: `Round ${r}`, value: get(`f.solved_round.${r}`) })),
        { label: 'Final accusations', value: get('f.solved_round.final') },
      ],
    },
    {
      id: 'murderer-by-players',
      label: 'Murderer’s side win rate by table size',
      kind: 'matrix',
      columns: counts.map((n) => `${n} players`),
      units: counts.map(() => 'percent' as const),
      rows: [
        {
          label: 'Murderer’s side',
          values: counts.map((n) => pct(get(`f.mwin.n${n}`), get(`f.n.${n}`))),
        },
      ],
    },
    {
      id: 'solve-accuracy',
      label: 'Solve attempts that were right',
      kind: 'percent',
      value: pct(get('f.solves_yes'), get('f.solves')),
    },
    {
      id: 'bullets-before-solve',
      label: 'Bullets placed before the solve',
      kind: 'number',
      value: avg(get('f.bullets_before'), get('f.solved')),
    },
    { id: 'top-means', label: 'Means used most', kind: 'split', parts: topCards('means') },
    { id: 'top-clues', label: 'Key Evidence chosen most', kind: 'split', parts: topCards('clue') },
    {
      id: 'events',
      label: 'Events that came up',
      kind: 'split',
      parts: INQUEST_EVENTS.filter(([k]) => k !== 'perfect-crime' || get(`f.event.${k}`) > 0).map(
        ([k, label]) => ({ label, value: get(`f.event.${k}`) }),
      ),
    },
    // The Allies expansion: only once a game has used it.
    ...(get('f.allies') > 0
      ? ([
          {
            id: 'allies-sides',
            label: 'Allies expansion: how often each role’s side won',
            kind: 'matrix',
            columns: INQUEST_ALLIES.map(([, label]) => label),
            units: INQUEST_ALLIES.map(() => 'percent' as const),
            rows: [
              {
                label: 'Their side won',
                values: INQUEST_ALLIES.map(([key]) =>
                  pct(get(`f.ally.${key}.win`), get(`f.ally.${key}`)),
                ),
              },
            ],
          },
          {
            id: 'perfect-crime-switch',
            label: 'Change of Heart peeks that switched the Forensic Scientist',
            kind: 'percent',
            value: pct(get('f.perfect.switch'), get('f.perfect')),
          },
        ] satisfies GameFigure[])
      : []),
  ];
}

const SEANCE_ENDINGS: [string, string][] = [
  ['culprit', 'Culprit found'],
  ['wrong', 'Wrong group'],
  ['no-votes', 'No votes'],
  ['clock', 'Clock ran out'],
];
const SEANCE_LEVELS = ['easy', 'medium', 'hard'] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function seanceCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      out.push(['f.games', 1]);
      const how = str(props.how);
      if (how && SEANCE_ENDINGS.some(([k]) => k === how)) out.push([`f.how.${how}`, 1]);
      const level = str(props.difficulty);
      const known = SEANCE_LEVELS.find((l) => l === level);
      if (known) out.push([`f.d.${known}`, 1]);
      if (props.win === true) {
        out.push(['f.win', 1]);
        if (known) out.push([`f.win.${known}`, 1]);
      }
      const hour = num(props.hour);
      if (props.win === true && hour !== null && hour >= 1 && hour <= 7)
        out.push([`f.win_hour.${hour}`, 1]);
      out.push(['f.ravens', num(props.ravens) ?? 0]);
      break;
    }
    case 'guess':
      out.push(['f.guesses', 1]);
      if (props.correct === true) {
        out.push(['f.guesses_yes', 1]);
        if (props.tries === 1) out.push(['f.first_try', 1]);
      }
      break;
    case 'vision':
      out.push(['f.sends', 1], ['f.send_cards', num(props.cards) ?? 0]);
      break;
    case 'clairvoyance':
      out.push(['f.tokens', 1]);
      if (props.hit === true) out.push(['f.tokens_hit', 1]);
      break;
  }
  return out;
}

function seanceFigures(get: (metric: string) => number): GameFigure[] {
  const games = get('f.games');
  return [
    {
      id: 'win-rate',
      label: 'Ghosts laid to rest',
      kind: 'percent',
      value: pct(get('f.win'), games),
    },
    {
      id: 'win-by-difficulty',
      label: 'Win rate by difficulty',
      kind: 'matrix',
      columns: ['Easy', 'Medium', 'Hard'],
      units: ['percent', 'percent', 'percent'],
      rows: [
        {
          label: 'Won',
          values: SEANCE_LEVELS.map((l) => pct(get(`f.win.${l}`), get(`f.d.${l}`))),
        },
      ],
    },
    {
      id: 'endings',
      label: 'How séances ended',
      kind: 'split',
      parts: SEANCE_ENDINGS.map(([k, label]) => ({ label, value: get(`f.how.${k}`) })),
    },
    {
      id: 'win-hour',
      label: 'Wins, by the hour the last card was found',
      kind: 'split',
      parts: ROMAN.map((label, i) => ({
        label: `Hour ${label}`,
        value: get(`f.win_hour.${i + 1}`),
      })),
    },
    {
      id: 'guess-accuracy',
      label: 'Guesses that were right',
      kind: 'percent',
      value: pct(get('f.guesses_yes'), get('f.guesses')),
    },
    {
      id: 'first-try',
      label: 'Cards found on the first try',
      kind: 'percent',
      value: pct(get('f.first_try'), get('f.guesses_yes')),
    },
    {
      id: 'clairvoyance-accuracy',
      label: 'Clairvoyance tokens that scored',
      kind: 'percent',
      value: pct(get('f.tokens_hit'), get('f.tokens')),
    },
    {
      id: 'cards-per-vision',
      label: 'Cards per vision',
      kind: 'number',
      value: avg(get('f.send_cards'), get('f.sends')),
    },
    { id: 'ravens', label: 'Ravens per game', kind: 'number', value: avg(get('f.ravens'), games) },
  ];
}

// Short Fuse names its cards in its manifest, so card labels are `{card:…}` placeholders.
const SHORT_FUSE_CARDS = [
  'attack',
  'skip',
  'favor',
  'shuffle',
  'peek3',
  'nope',
  'aim',
  'reverse',
  'bottom',
  'alter3',
  'superskip',
  'peek5',
  'alter5',
  'swap',
  'recycle',
  'stack',
  'mark',
  'blind',
  'mine',
  'bury',
  'self3',
  'potluck',
  'share3',
  'alter3now',
  'dig',
  'ghostattack',
  'feed',
  'copy',
  'robber',
  'shufflenow',
] as const;
const SHORT_FUSE_PRESETS: [string, string][] = [
  ['classic', 'Classic deck'],
  ['adult', 'Adult deck'],
  ['party', 'Party deck'],
  ['zombie', 'Ghosts deck'],
  ['chaos', 'Chaos (everything)'],
];
const SHORT_FUSE_SPOTS: [string, string][] = [
  ['top', 'On top'],
  ['2', '2nd'],
  ['3', '3rd'],
  ['mid', 'Further down'],
  ['bottom', 'At the bottom'],
];

const STARLIGHT_SHOWS = [
  ['spark', 'Sparks'],
  ['super', 'Super-Sparks'],
  ['fall', 'Falls'],
] as const;

function shortFuseCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      out.push(['f.games', 1]);
      const preset = str(props.preset);
      if (preset && SHORT_FUSE_PRESETS.some(([k]) => k === preset))
        out.push([`f.preset.${preset}`, 1]);
      if (props.x1 === true) out.push(['f.x1', 1]);
      if (props.x4 === true) out.push(['f.x4', 1]);
      out.push(
        ['f.turn_sum', num(props.turns) ?? 0],
        ['max.f.chain', num(props.longestChain) ?? 0],
      );
      out.push(['max.f.owed', num(props.maxOwed) ?? 0]);
      break;
    }
    case 'play': {
      out.push(['f.plays', 1]);
      const cards = Array.isArray(props.cards) ? props.cards : [];
      const card = str(cards[0]);
      if (props.kind === 'card' && card && (SHORT_FUSE_CARDS as readonly string[]).includes(card))
        out.push([`f.card.${card}`, 1]);
      if (props.kind === 'pair' || props.kind === 'triple') out.push(['f.combos', 1]);
      break;
    }
    case 'noped':
      out.push(['f.noped', 1]);
      break;
    case 'nope':
      out.push(['f.nopes', 1]);
      break;
    case 'bomb':
      if (props.saved === 'defuse' || props.saved === 'revive') out.push(['f.defused', 1]);
      if (props.kind === 'bomb') out.push(['f.bomb_draws', 1]);
      break;
    case 'explode':
      out.push(['f.explosions', 1]);
      break;
    case 'revive':
      if (str(props.target)) out.push(['f.revives', 1]);
      break;
    case 'placement': {
      const pos = num(props.position);
      const of = num(props.of);
      if (pos === null || of === null || props.kind !== 'bomb') break;
      const spot =
        pos === 0 ? 'top' : pos === of - 1 ? 'bottom' : pos === 1 ? '2' : pos === 2 ? '3' : 'mid';
      out.push([`f.spot.${spot}`, 1]);
      break;
    }
  }
  return out;
}

function shortFuseFigures(get: (metric: string) => number): GameFigure[] {
  const games = get('f.games');
  return [
    {
      id: 'decks',
      label: 'Decks played',
      kind: 'split',
      parts: SHORT_FUSE_PRESETS.map(([k, label]) => ({ label, value: get(`f.preset.${k}`) })),
    },
    {
      id: 'explosions',
      label: 'Explosions per game',
      kind: 'number',
      value: avg(get('f.explosions'), games),
    },
    {
      id: 'defused',
      label: 'Drawn {card:bomb} cards that were defused',
      kind: 'percent',
      value: pct(get('f.defused'), get('f.bomb_draws')),
    },
    {
      id: 'noped',
      label: 'Plays cancelled by {card:nope}',
      kind: 'percent',
      value: pct(get('f.noped'), get('f.plays')),
    },
    {
      id: 'cards',
      label: 'Most-played cards',
      kind: 'split',
      parts: SHORT_FUSE_CARDS.map((c) => ({
        label: `{card:${c}}`,
        value: get(`f.card.${c}`),
      })).filter((p) => p.value > 0),
    },
    {
      id: 'spots',
      label: 'Where defused {card:bomb} cards were hidden',
      kind: 'histogram',
      bins: SHORT_FUSE_SPOTS.map(([k, label]) => ({ label, value: get(`f.spot.${k}`) })),
    },
    { id: 'turns', label: 'Turns per game', kind: 'number', value: avg(get('f.turn_sum'), games) },
    { id: 'chain', label: 'Longest {card:nope} chain', kind: 'number', value: get('max.f.chain') },
    {
      id: 'revives',
      label: 'Ghosts brought back per game (with {card:revive})',
      kind: 'number',
      value: avg(get('f.revives'), get('f.x4')),
    },
    { id: 'owed', label: 'Most turns owed at once', kind: 'number', value: get('max.f.owed') },
  ];
}

// Hydra and its editions name their cards, offices and powers in their manifests, so these labels
// are `{role:…}` placeholders the stats page fills in from the edition's own words.
const HYDRA_HOWS: [string, string][] = [
  ['blue-policies', '5 {role:blue-policies}'],
  ['leader-executed', '{role:leader} executed'],
  ['red-policies', '6 {role:red-policies}'],
  ['leader-elected', '{role:leader} elected'],
];
const HYDRA_POWERS: [string, string][] = [
  ['investigate', '{role:power-investigate}'],
  ['special', '{role:power-special}'],
  ['peek', '{role:power-peek}'],
  ['execute', '{role:power-execute}'],
];

function hydraCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      const n = num(props.players);
      out.push(['f.games', 1]);
      if (n !== null) out.push([`f.n.${n}`, 1]);
      if (props.winner === 'blue') {
        out.push(['f.bluewin', 1]);
        if (n !== null) out.push([`f.bluewin.n${n}`, 1]);
      }
      const how = str(props.how);
      if (how && HYDRA_HOWS.some(([k]) => k === how)) out.push([`f.how.${how}`, 1]);
      for (const [key, metric] of [
        ['rounds', 'f.round_sum'],
        ['chaos', 'f.chaos'],
        ['vetoes', 'f.vetoes'],
        ['claimsBlue', 'f.claims_blue'],
        ['liesBlue', 'f.lies_blue'],
        ['claimsRed', 'f.claims_red'],
        ['liesRed', 'f.lies_red'],
      ] as const) {
        const v = num(props[key]);
        if (v) out.push([metric, v]);
      }
      break;
    }
    case 'election':
      out.push(['f.elections', 1]);
      if (props.passed === true) out.push(['f.elections_yes', 1]);
      break;
    case 'power': {
      const kind = str(props.kind);
      if (kind && HYDRA_POWERS.some(([k]) => k === kind)) out.push([`f.power.${kind}`, 1]);
      break;
    }
  }
  return out;
}

function hydraFigures(get: (metric: string) => number, metrics: Iterable<string>): GameFigure[] {
  const games = get('f.games');
  const counts = [...metrics]
    .filter((m) => m.startsWith('f.n.'))
    .map((m) => Number(m.slice(4)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
  // Team and Leader names go out as `{role:…}` placeholders: the stats page names them.
  return [
    {
      id: 'sides',
      label: 'Wins by side',
      kind: 'split',
      parts: [
        { label: '{role:blue}', value: get('f.bluewin') },
        { label: '{role:red}', value: games - get('f.bluewin') },
      ],
    },
    {
      id: 'win-paths',
      label: 'How games were won',
      kind: 'split',
      parts: HYDRA_HOWS.map(([k, label]) => ({ label, value: get(`f.how.${k}`) })),
    },
    {
      id: 'blue-by-players',
      label: 'Win rate by table size',
      kind: 'matrix',
      columns: counts.map((n) => `${n} players`),
      units: counts.map(() => 'percent' as const),
      rows: [
        {
          label: '{role:blue}',
          values: counts.map((n) => pct(get(`f.bluewin.n${n}`), get(`f.n.${n}`))),
        },
      ],
    },
    {
      id: 'rounds',
      label: 'Governments per game',
      kind: 'number',
      value: avg(get('f.round_sum'), games),
    },
    {
      id: 'elected',
      label: 'Governments elected',
      kind: 'percent',
      value: pct(get('f.elections_yes'), get('f.elections')),
    },
    {
      id: 'powers',
      label: 'Powers used',
      kind: 'split',
      parts: HYDRA_POWERS.map(([k, label]) => ({ label, value: get(`f.power.${k}`) })),
    },
    {
      id: 'honest-blue',
      label: '{role:blue} claims that were true',
      kind: 'percent',
      value: pct(get('f.claims_blue') - get('f.lies_blue'), get('f.claims_blue')),
    },
    {
      id: 'honest-red',
      label: '{role:red} claims that were true',
      kind: 'percent',
      value: pct(get('f.claims_red') - get('f.lies_red'), get('f.claims_red')),
    },
    {
      id: 'topdecks',
      label: 'Chaos top-decks per game',
      kind: 'number',
      value: avg(get('f.chaos'), games),
    },
    {
      id: 'vetoes',
      label: 'Agendas thrown out ({role:veto})',
      kind: 'number',
      value: get('f.vetoes'),
    },
  ];
}

const TAVERN_BRAWL_HEROES = [
  'brute',
  'mage',
  'knight',
  'thief',
  'ranger',
  'druid',
  'dragon',
  'owl',
  'psychic',
  'slime',
  'eye',
  'mimic',
] as const;

function tavernBrawlCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      out.push(['f.games', 1]);
      const n = num(props.count);
      if (n !== null && n >= 2 && n <= 6) out.push([`f.n.${n}`, 1]);
      if (props.tie === true) out.push(['f.ties', 1]);
      if (props.firstWon === true) out.push(['f.first_won', 1]);
      const turns = num(props.turns);
      if (turns) out.push(['f.turn_sum', turns]);
      const heroes = Array.isArray(props.heroes) ? props.heroes : [];
      const dealt = Array.isArray(props.dealt) ? props.dealt : [];
      const healed = Array.isArray(props.healed) ? props.healed : [];
      heroes.forEach((h, i) => {
        const hero = TAVERN_BRAWL_HEROES.find((x) => x === h);
        if (!hero) return;
        out.push([`f.played.${hero}`, 1]);
        out.push(
          [`f.dealt.${hero}`, num(dealt[i]) ?? 0],
          [`f.healed.${hero}`, num(healed[i]) ?? 0],
        );
      });
      for (const h of Array.isArray(props.winnerHeroes) ? props.winnerHeroes : []) {
        const hero = TAVERN_BRAWL_HEROES.find((x) => x === h);
        if (hero) out.push([`f.win.${hero}`, 1]);
      }
      break;
    }
    case 'ko':
      if (props.removed === true) break;
      out.push(['f.kos', 1]);
      if (props.self === true) out.push(['f.self_kos', 1]);
      break;
  }
  return out;
}

function tavernBrawlFigures(get: (metric: string) => number): GameFigure[] {
  const games = get('f.games');
  return [
    {
      id: 'wins-by-hero',
      label: 'Wins by hero',
      kind: 'split',
      parts: TAVERN_BRAWL_HEROES.map((h) => ({ label: `{role:${h}}`, value: get(`f.win.${h}`) })),
    },
    {
      id: 'hero-win-rate',
      label: 'Hero win rate, damage and healing per game',
      kind: 'matrix',
      columns: ['Won', 'Damage', 'Healed'],
      units: ['percent', 'count', 'count'],
      rows: TAVERN_BRAWL_HEROES.map((h) => ({
        label: `{role:${h}}`,
        values: [
          pct(get(`f.win.${h}`), get(`f.played.${h}`)),
          avg(get(`f.dealt.${h}`), get(`f.played.${h}`)),
          avg(get(`f.healed.${h}`), get(`f.played.${h}`)),
        ],
      })),
    },
    {
      id: 'player-count',
      label: 'Games by table size',
      kind: 'split',
      parts: [2, 3, 4, 5, 6].map((n) => ({ label: `${n} players`, value: get(`f.n.${n}`) })),
    },
    {
      id: 'turns-per-game',
      label: 'Turns per game',
      kind: 'number',
      value: avg(get('f.turn_sum'), games),
    },
    {
      id: 'first-player-wins',
      label: 'Games won by whoever went first',
      kind: 'percent',
      value: pct(get('f.first_won'), games),
    },
    {
      id: 'self-kos',
      label: 'Heroes who knocked themselves out',
      kind: 'number',
      value: get('f.self_kos'),
    },
    {
      id: 'ties',
      label: 'Games where everyone was knocked out',
      kind: 'number',
      value: get('f.ties'),
    },
  ];
}

function thornsCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      out.push(['f.games', 1]);
      const n = num(props.players);
      if (n !== null && n >= 3 && n <= 6) out.push([`f.n.${n}`, 1]);
      if (props.how === 'points' || props.how === 'last') out.push([`f.how.${props.how}`, 1]);
      const rounds = num(props.rounds);
      if (rounds) out.push(['f.round_sum', rounds]);
      break;
    }
    case 'challenge': {
      out.push(['f.challenges', 1]);
      const bid = num(props.bid) ?? 0;
      if (props.success === true) out.push(['f.challenge_won', 1], ['f.won_bid_sum', bid]);
      else if (props.own === true) out.push(['f.own_thorn', 1]);
      else out.push(['f.other_thorn', 1]);
      break;
    }
    case 'bid':
      out.push(['f.bids', 1]);
      break;
  }
  return out;
}

function thornsFigures(get: (metric: string) => number): GameFigure[] {
  const games = get('f.games');
  return [
    {
      id: 'challenge-success',
      label: 'Challenges that found no {card:thorn}',
      kind: 'percent',
      value: pct(get('f.challenge_won'), get('f.challenges')),
    },
    {
      id: 'thorn-stops',
      label: 'Whose {card:thorn} stopped a challenge',
      kind: 'split',
      parts: [
        { label: 'Another player’s', value: get('f.other_thorn') },
        { label: 'The Challenger’s own', value: get('f.own_thorn') },
      ],
    },
    {
      id: 'winning-bid',
      label: 'Average successful bid',
      kind: 'number',
      value: avg(get('f.won_bid_sum'), get('f.challenge_won')),
    },
    {
      id: 'how-games-end',
      label: 'How games were won',
      kind: 'split',
      parts: [
        { label: 'Two points', value: get('f.how.points') },
        { label: 'Last one standing', value: get('f.how.last') },
      ],
    },
    {
      id: 'player-count',
      label: 'Games by table size',
      kind: 'split',
      parts: [3, 4, 5, 6].map((n) => ({ label: `${n} players`, value: get(`f.n.${n}`) })),
    },
    {
      id: 'rounds-per-game',
      label: 'Rounds per game',
      kind: 'number',
      value: avg(get('f.round_sum'), games),
    },
  ];
}

const ICONIC_LEVELS = [
  ['easy', 'Easy'],
  ['hard', 'Hard'],
  ['challenging', 'Challenging'],
] as const;
const ICONIC_DROPS = [
  ['pass', 'Clue givers passed'],
  ['gave-up', 'Everyone gave up'],
  ['timer', 'Time ran out'],
  ['left', 'A clue giver left'],
] as const;
/** Fastest guesses are kept as `max.f.quick` = this minus the seconds (counters only keep maxima). */
const ICONIC_QUICK_CAP = 3600;

function iconicCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'outcome': {
      out.push(['f.games', 1]);
      const rounds = num(props.rounds);
      if (rounds) out.push(['f.round_sum', rounds]);
      break;
    }
    case 'word': {
      out.push(['f.words', 1]);
      const level = ICONIC_LEVELS.find(([k]) => k === props.level)?.[0];
      if (level) out.push([`f.level.${level}`, 1]);
      if (props.helper) out.push(['f.helper', 1]);
      if (props.outcome === 'guessed') {
        const s = Math.round((num(props.ms) ?? 0) / 1000);
        const pieces = num(props.pieces) ?? 0;
        out.push(['f.guessed', 1], ['f.pieces_sum', pieces], ['max.f.pieces', pieces]);
        if (level) out.push([`f.level.${level}_yes`, 1], [`f.level.${level}_s`, s]);
        if (s > 0 && s < ICONIC_QUICK_CAP) out.push(['max.f.quick', ICONIC_QUICK_CAP - s]);
      } else {
        const how = ICONIC_DROPS.find(([k]) => k === props.how)?.[0];
        if (how) out.push([`f.drop.${how}`, 1]);
      }
      break;
    }
  }
  return out;
}

function iconicFigures(get: (metric: string) => number): GameFigure[] {
  const quick = get('max.f.quick');
  return [
    {
      id: 'words-guessed',
      label: 'Words guessed',
      kind: 'percent',
      value: pct(get('f.guessed'), get('f.words')),
    },
    ...ICONIC_LEVELS.map(([k, label]) => ({
      id: `time-${k}`,
      label: `Average seconds to guess a ${label} word`,
      kind: 'number' as const,
      value: avg(get(`f.level.${k}_s`), get(`f.level.${k}_yes`)),
    })),
    {
      id: 'fastest',
      label: 'Fastest guess (seconds)',
      kind: 'number',
      value: quick > 0 ? ICONIC_QUICK_CAP - quick : 0,
    },
    {
      id: 'pieces',
      label: 'Average pieces on a guessed word',
      kind: 'number',
      value: avg(get('f.pieces_sum'), get('f.guessed')),
    },
    {
      id: 'most-pieces',
      label: 'Most pieces on a guessed word',
      kind: 'number',
      value: get('max.f.pieces'),
    },
    {
      id: 'levels',
      label: 'Words chosen by level',
      kind: 'split',
      parts: ICONIC_LEVELS.map(([k, label]) => ({ label, value: get(`f.level.${k}`) })),
    },
    {
      id: 'dropped',
      label: 'How words were dropped',
      kind: 'split',
      parts: ICONIC_DROPS.map(([k, label]) => ({ label, value: get(`f.drop.${k}`) })),
    },
    {
      id: 'helper',
      label: 'Words with a helper',
      kind: 'percent',
      value: pct(get('f.helper'), get('f.words')),
    },
    {
      id: 'words-per-game',
      label: 'Words per game',
      kind: 'number',
      value: avg(get('f.round_sum'), get('f.games')),
    },
  ];
}

function stampedeCounters(type: string, props: Props): Counters {
  const out: Counters = [];
  switch (type) {
    case 'round': {
      out.push(['f.rounds', 1]);
      const herd = num(props.herdSize) ?? 0;
      out.push(['f.answered_sum', num(props.answered) ?? 0]);
      if (herd > 0) out.push(['f.herds', 1], ['f.herd_sum', herd]);
      if (props.tie === true) out.push(['f.ties', 1]);
      if ((num(props.merges) ?? 0) > 0) out.push(['f.merged', 1]);
      if (props.skipped === true) out.push(['f.skips', 1]);
      break;
    }
    case 'pink':
      out.push(['f.pinks', 1]);
      break;
    case 'outcome': {
      out.push(['f.games', 1]);
      if (props.endReason === 'won') {
        out.push(['f.won', 1], ['f.won_round_sum', num(props.rounds) ?? 0]);
      }
      break;
    }
  }
  return out;
}

function stampedeFigures(get: (metric: string) => number): GameFigure[] {
  return [
    {
      id: 'herd-rounds',
      label: 'Rounds with a herd',
      kind: 'percent',
      value: pct(get('f.herds'), get('f.rounds')),
    },
    {
      id: 'herd-share',
      label: 'Answers that were in the herd',
      kind: 'percent',
      value: pct(get('f.herd_sum'), get('f.answered_sum')),
    },
    {
      id: 'tie-rounds',
      label: 'Rounds tied at the top',
      kind: 'percent',
      value: pct(get('f.ties'), get('f.rounds')),
    },
    {
      id: 'merged-rounds',
      label: 'Rounds where the host joined or split answers',
      kind: 'percent',
      value: pct(get('f.merged'), get('f.rounds')),
    },
    {
      id: 'pink-moves',
      label: '{card:pink-cow} moves per game',
      kind: 'number',
      value: avg(get('f.pinks'), get('f.games')),
    },
    {
      id: 'rounds-to-win',
      label: 'Rounds to a winner',
      kind: 'number',
      value: avg(get('f.won_round_sum'), get('f.won')),
    },
  ];
}

/** Daily counters for one insight event. */
export function figureCounters(gameId: string, type: string, props: Props): Counters {
  if (gameId === 'nightfall') return nightfallCounters(type, props);
  if (gameId === 'round-table') return roundTableCounters(type, props);
  if (gameId === 'inquest') return inquestCounters(type, props);
  if (gameId === 'seance') return seanceCounters(type, props);
  if (gameId === 'hydra' || gameId === 'hogwarts') return hydraCounters(type, props);
  if (gameId === 'tavern-brawl') return tavernBrawlCounters(type, props);
  if (gameId === 'short-fuse') return shortFuseCounters(type, props);
  if (gameId === 'thorns') return thornsCounters(type, props);
  if (gameId === 'iconic') return iconicCounters(type, props);
  if (gameId === 'stampede') return stampedeCounters(type, props);
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
    case 'starlight:word':
      out.push(['f.rounds', 1]);
      if (props.flipped === true) out.push(['f.flipped', 1]);
      if (str(props.dark)) out.push(['f.dark_rounds', 1]);
      break;
    case 'starlight:show': {
      const kind = str(props.kind);
      out.push(['f.shows', 1]);
      if (kind && STARLIGHT_SHOWS.some(([k]) => k === kind)) out.push([`f.show.${kind}`, 1]);
      break;
    }
    case 'starlight:round': {
      const points = num(props.points) ?? 0;
      out.push(['f.player_rounds', 1], ['f.points_sum', points], ['max.f.best_round', points]);
      if (props.dark === true) {
        out.push(['f.dark', 1]);
        if (props.fell === true) out.push(['f.dark_fell', 1]);
      }
      break;
    }
    case 'starlight:outcome':
      out.push(['f.games', 1]);
      break;
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
    case 'round-table':
      return roundTableFigures(get, metrics);
    case 'inquest':
      return inquestFigures(get, metrics);
    case 'seance':
      return seanceFigures(get);
    case 'tavern-brawl':
      return tavernBrawlFigures(get);
    case 'hydra':
    case 'hogwarts':
      return hydraFigures(get, metrics);
    case 'short-fuse':
      return shortFuseFigures(get);
    case 'thorns':
      return thornsFigures(get);
    case 'iconic':
      return iconicFigures(get);
    case 'stampede':
      return stampedeFigures(get);
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
    case 'starlight':
      return [
        {
          id: 'shown',
          label: 'Cards shown',
          kind: 'split',
          parts: STARLIGHT_SHOWS.map(([k, label]) => ({ label, value: get(`f.show.${k}`) })),
        },
        {
          id: 'round-score',
          label: 'Average round score',
          kind: 'number',
          value: avg(get('f.points_sum'), get('f.player_rounds')),
        },
        {
          id: 'best-round',
          label: 'Best round score',
          kind: 'number',
          value: get('max.f.best_round'),
        },
        {
          id: 'dark-rounds',
          label: 'Rounds with a player in the Dark',
          kind: 'percent',
          value: pct(get('f.dark_rounds'), get('f.rounds')),
        },
        {
          id: 'dark-fell',
          label: 'Players in the Dark who fell',
          kind: 'percent',
          value: pct(get('f.dark_fell'), get('f.dark')),
        },
        {
          id: 'flipped',
          label: 'Rounds played on the upside-down word',
          kind: 'percent',
          value: pct(get('f.flipped'), get('f.rounds')),
        },
      ];
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
