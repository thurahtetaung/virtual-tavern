import {
  pairTally,
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  bool,
  count,
  type GameEvents,
  ph,
  plain,
  leaders,
  mostBy,
  type NuggetRule,
  num,
  topPair,
  type RecapEvent,
  seconds,
  str,
  strs,
} from '@vt/game-sdk';

/** Each card with the `match` events that followed it (insights report them together). */
function cardsWithMatches(g: GameEvents): { card: RecapEvent; matches: RecapEvent[] }[] {
  const out: { card: RecapEvent; matches: RecapEvent[] }[] = [];
  for (const e of g.events) {
    if (e.type === 'card') out.push({ card: e, matches: [] });
    else if (e.type === 'match') out.at(-1)?.matches.push(e);
  }
  return out;
}

const outcomeOf = (e: RecapEvent) => str(e, 'outcome');
const right = (g: GameEvents) => g.of('card').filter((e) => outcomeOf(e) === 'right');

const sharedBrainCell: AwardRule = {
  id: 'echo.shared-brain-cell',
  emoji: '🔔',
  title: 'Shared Brain Cell',
  wholesomeTitle: 'In Sync',
  valence: 'gentle',
  weight: 4,
  kind: 'pair',
  family: 'echo',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{a} & {b} share one brain cell. It said "{w}"',
      '{a} & {b} echoed each other {n|time}. Spooky',
    ],
    wholesome: [
      '{a} & {b} were perfectly in sync, {n|time}',
      '{a} & {b} think alike: both wrote "{w}"',
    ],
  },
  compute(g) {
    const matches = g.of('match');
    const pairs = matches.map((m) => [str(m, 'a') ?? '', str(m, 'b') ?? ''] as const);
    const [top] = topPair(pairTally(pairs), 1);
    if (!top) return [];
    const [a, b] = top.players as [string, string];
    const last = matches.findLast((m) => {
      const ids = [str(m, 'a'), str(m, 'b')];
      return ids.includes(a) && ids.includes(b);
    });
    return [{ ...top, params: { w: plain(str(last, 'word') ?? '') } }];
  },
};

const cancelCulture: AwardRule = {
  id: 'echo.cancel-culture',
  emoji: '🧨',
  title: 'Cancel Culture',
  wholesomeTitle: 'Great Minds',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'echo',
  minPlayers: 3,
  copy: {
    cheeky: ["{who}'s clues got cancelled {n} times", '{who} wrote what everyone wrote, {n} times'],
    wholesome: [
      '{who} thought like everyone else, {n} times',
      "{who} was on the table's wavelength {n} times",
    ],
  },
  compute: (g) =>
    mostBy(g.of('match'), (m) => [str(m, 'a'), str(m, 'b')].filter((x): x is string => !!x), {
      min: 2,
    }),
};

const clueMvp: AwardRule = {
  id: 'echo.clue-mvp',
  emoji: '🪄',
  title: 'Clue MVP',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'clues',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} wrote {n} clues that survived and scored',
      '{who} had {n} clues make it through and land',
    ],
    wholesome: [
      "{who}'s clues led to {n} right answers",
      '{who} wrote {n} clues that helped score a card',
    ],
  },
  compute: (g) => mostBy(right(g), (e) => strs(e, 'survivors'), { min: 2 }),
};

const loneSurvivor: AwardRule = {
  id: 'echo.lone-survivor',
  emoji: '🗝️',
  title: 'Lone Survivor',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'clues',
  minPlayers: 3,
  copy: {
    cheeky: [
      "Only {who}'s clue survived, and it worked",
      "{who}'s clue stood alone and still scored",
    ],
    wholesome: ['{who} saved the card single-handed', "{who}'s one surviving clue was all it took"],
  },
  compute: (g) =>
    mostBy(
      right(g).filter((e) => strs(e, 'survivors').length === 1),
      (e) => strs(e, 'survivors')[0],
    ),
};

const bullseye: AwardRule = {
  id: 'echo.bullseye',
  emoji: '🎯',
  title: 'Bullseye',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'guessing',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} guessed {n} right. Show-off', '{who} nailed {n} cards. Mind reader'],
    wholesome: ['{who} read the table perfectly, {n} times', '{who} guessed {n} cards right'],
  },
  compute: (g) => mostBy(right(g), undefined, { min: 2 }),
};

const braveGuesser: AwardRule = {
  id: 'echo.brave-guesser',
  emoji: '🙈',
  title: 'Brave Guesser',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'guessing',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} went for it and missed {n|time}', '{who} guessed boldly and wrongly, {n|time}'],
    wholesome: ['{who} always gave it a shot', '{who} took a brave swing {n|time}'],
  },
  compute: (g) => mostBy(g.of('card').filter((e) => outcomeOf(e) === 'wrong')),
};

const safetyFirst: AwardRule = {
  id: 'echo.safety-first',
  emoji: '🦺',
  title: 'Safety First',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'guessing',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} passed {n} times. Cautious', '{who} said "pass" {n} times. Wise or scared?'],
    wholesome: ['{who} protected the deck {n} times', '{who} knew when to pass, {n} times'],
  },
  // Timer passes are not a choice, so they don't count.
  compute: (g) =>
    mostBy(
      g.of('card').filter((e) => outcomeOf(e) === 'pass' && bool(e, 'auto') !== true),
      undefined,
      { min: 2 },
    ),
};

const quickStudy: AwardRule = {
  id: 'echo.quick-study',
  emoji: '⚡',
  title: 'Quick Study',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'speed',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} got it in {s} s. Did they even look?', '{who} answered in {s} s flat'],
    wholesome: ['{who} cracked it in {s} s', '{who} needed just {s} s for a right answer'],
  },
  compute(g) {
    const best = new Map<string, number>();
    for (const e of right(g)) {
      const ms = num(e, 'actMs');
      if (!e.playerId || ms === undefined || bool(e, 'auto') === true) continue;
      best.set(e.playerId, Math.min(best.get(e.playerId) ?? Infinity, ms));
    }
    return leaders(best, { lowest: true }).map((c) => ({
      ...c,
      params: { s: seconds(c.value) },
    }));
  },
};

const wordsmith: AwardRule = {
  id: 'echo.wordsmith',
  emoji: '📚',
  title: 'Wordsmith',
  valence: 'glory',
  weight: 1,
  kind: 'award',
  family: 'clues',
  minPlayers: 3,
  copy: {
    cheeky: ['{who}\'s "{w}" was the longest clue to survive', '{who} survived with "{w}". Fancy'],
    wholesome: ['{who} found the perfect long word: "{w}"', '{who}\'s "{w}" made it through'],
  },
  compute(g) {
    let best: { id: string; word: string } | null = null;
    let tie = false;
    for (const e of g.of('card')) {
      const ids = strs(e, 'survivors');
      const words = strs(e, 'survivorWords');
      if (ids.length !== words.length) continue;
      ids.forEach((id, i) => {
        const word = words[i]!;
        if (!best || word.length > best.word.length) {
          best = { id, word };
          tie = false;
        } else if (word.length === best.word.length && id !== best.id) tie = true;
      });
    }
    const found = best as { id: string; word: string } | null;
    if (!found || tie || found.word.length < 7) return [];
    return [{ players: [found.id], value: found.word.length, params: { w: plain(found.word) } }];
  },
};

const totalEclipse: AwardRule = {
  id: 'echo.total-eclipse',
  emoji: '🌑',
  title: 'Total Eclipse',
  valence: 'gentle',
  weight: 4,
  kind: 'moment',
  family: 'echo',
  minPlayers: 3,
  copy: {
    cheeky: [
      'All {n} clues cancelled. {who} stared into the void',
      '{n} clues, all cancelled. {who} had nothing. Nothing!',
    ],
    wholesome: [
      'Total eclipse: {who} had nothing to go on',
      'All {n} clues echoed out, and {who} kept going',
    ],
  },
  compute(g) {
    const cards = g
      .of('card')
      .filter(
        (e) => (num(e, 'clueCount') ?? 0) > 0 && num(e, 'clueCount') === num(e, 'cancelledCount'),
      );
    const last = cards.at(-1);
    if (!last?.playerId) return [];
    return [{ players: [last.playerId], value: num(last, 'clueCount')! }];
  },
};

const buzzerBeater: AwardRule = {
  id: 'echo.buzzer-beater',
  emoji: '🏁',
  title: 'Buzzer Beater',
  valence: 'glory',
  weight: 4,
  kind: 'moment',
  family: 'finale',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} nailed the very last card. Showboat', 'Last card, and {who} got it right'],
    wholesome: [
      '{who} got the final card. A happy ending',
      '{who} closed the game with a right answer',
    ],
  },
  compute(g) {
    const last = g.of('card').at(-1);
    if (!last?.playerId || outcomeOf(last) !== 'right' || g.of('outcome').length === 0) return [];
    return [{ players: [last.playerId], value: 1 }];
  },
};

const bigCancel: AwardRule = {
  id: 'echo.big-cancel',
  emoji: '📣',
  title: 'Chorus Line',
  valence: 'gentle',
  weight: 3,
  kind: 'moment',
  family: 'echo',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{n} people wrote "{w}". {who} all cancelled out',
      '{who} all wrote "{w}". A {n}-way cancel',
    ],
    wholesome: ['{who} all had the same idea: "{w}"', '{n} minds, one word: "{w}". Lovely, {who}'],
  },
  compute(g) {
    let best: AwardCandidate | null = null;
    for (const { matches } of cardsWithMatches(g)) {
      const byWord = new Map<string, Set<string>>();
      for (const m of matches) {
        const w = str(m, 'word') ?? '';
        const set = byWord.get(w.toLowerCase()) ?? new Set();
        for (const id of [str(m, 'a'), str(m, 'b')]) if (id) set.add(id);
        byWord.set(w.toLowerCase(), set);
        if (set.size >= 3 && (!best || set.size > best.value))
          best = { players: [...set].sort(), value: set.size, params: { w: plain(w) } };
      }
    }
    return best && best.players.length <= 3 ? [best] : [];
  },
};

const perfectEcho: AwardRule = {
  id: 'echo.perfect-echo',
  emoji: '🌕',
  title: 'Perfect Echo',
  valence: 'glory',
  weight: 5,
  kind: 'team',
  family: 'team',
  minPlayers: 3,
  copy: {
    cheeky: [
      'Every. Single. Card. All {n} of them',
      '{n} cards, {n} right. The table is unbearable',
    ],
    wholesome: ['A perfect game together: {n} for {n}', 'The whole table scored all {n} cards'],
  },
  compute(g) {
    const o = g.of('outcome').at(-1);
    const score = num(o, 'score');
    const deck = num(o, 'deckSize');
    if (score === undefined || deck === undefined || score < deck || deck <= 0) return [];
    return [{ players: [...g.players], value: score }];
  },
};

export const ECHO_RULES: AwardRule[] = [
  sharedBrainCell,
  cancelCulture,
  clueMvp,
  loneSurvivor,
  bullseye,
  braveGuesser,
  safetyFirst,
  quickStudy,
  wordsmith,
  totalEclipse,
  buzzerBeater,
  bigCancel,
  perfectEcho,
];

const allCards = (games: readonly GameEvents[]) => games.flatMap((g) => g.of('card'));

const nuggets: NuggetRule[] = [
  {
    id: 'echo.score',
    emoji: '🃏',
    interest: 3,
    compute(games) {
      let score = 0;
      let deck = 0;
      for (const g of games) {
        const o = g.of('outcome').at(-1);
        score += num(o, 'score') ?? 0;
        deck += num(o, 'deckSize') ?? 0;
      }
      return deck ? { value: score, text: `${score} of ${deck} cards scored` } : null;
    },
  },
  {
    id: 'echo.right-rate',
    emoji: '✅',
    interest: 2,
    compute(games) {
      const cards = allCards(games);
      if (cards.length < 3) return null;
      const pct = Math.round(
        (cards.filter((e) => outcomeOf(e) === 'right').length / cards.length) * 100,
      );
      return { value: pct, text: `${pct}% of guesses right` };
    },
  },
  {
    id: 'echo.cancelled',
    emoji: '🧨',
    interest: 3,
    compute(games) {
      const n = allCards(games).reduce((s, e) => s + (num(e, 'cancelledCount') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'clue')} cancelled` } : null;
    },
  },
  {
    id: 'echo.popular-clue',
    emoji: '🗣️',
    interest: 2,
    compute(games) {
      const counts = new Map<string, { word: string; n: number }>();
      for (const e of allCards(games)) {
        const words = e.props.words;
        if (!Array.isArray(words)) continue;
        for (const w of words as { kind?: unknown; word?: unknown }[]) {
          if (w.kind !== 'clue' || typeof w.word !== 'string') continue;
          const k = w.word.toLowerCase();
          const c = counts.get(k) ?? { word: w.word, n: 0 };
          c.n += 1;
          counts.set(k, c);
        }
      }
      const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      return top && top.n >= 2
        ? { value: top.n, text: `Top clue: "${plain(top.word)}" ×${top.n}` }
        : null;
    },
  },
  {
    id: 'echo.streak',
    emoji: '🔥',
    interest: 3,
    record: 'max',
    compute(games) {
      let best = 0;
      for (const g of games) {
        let run = 0;
        for (const e of g.of('card')) {
          run = outcomeOf(e) === 'right' ? run + 1 : 0;
          best = Math.max(best, run);
        }
      }
      return best >= 3 ? { value: best, text: `Longest run: ${best} right in a row` } : null;
    },
  },
  {
    id: 'echo.fastest',
    emoji: '⏱️',
    interest: 2,
    record: 'min',
    compute(games) {
      const times = allCards(games)
        .filter((e) => outcomeOf(e) === 'right')
        .flatMap((e) => num(e, 'actMs') ?? []);
      if (!times.length) return null;
      const s = seconds(Math.min(...times));
      return { value: s, text: `Fastest right guess: ${s} s` };
    },
  },
];

const OUTCOME_LABEL: Record<string, string> = { right: 'right', wrong: 'wrong', pass: 'passed' };
const MAX_HISTORY_LINES = 12;

/** One line per card: who guessed, the secret word, and how it went. */
function history(g: GameEvents): string[] {
  const lines = g.of('card').map((e, i) => {
    const who = e.playerId ? ph.p(e.playerId) : 'Someone';
    const word = plain(str(e, 'word') ?? '?');
    const outcome = OUTCOME_LABEL[outcomeOf(e) ?? ''] ?? 'done';
    return `Card ${i + 1} · ${who} on "${word}": ${outcome}`;
  });
  if (lines.length <= MAX_HISTORY_LINES) return lines;
  const shown = lines.slice(0, MAX_HISTORY_LINES - 1);
  return [...shown, `…and ${lines.length - shown.length} more cards`];
}

export const echoAwards: AwardModule = { rules: ECHO_RULES, nuggets, history };
