import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  count,
  leaders,
  mostBy,
  num,
  nums,
  ph,
  plain,
  seconds,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Iconic, read from its `insights` events (`word`, `outcome`).
 * Icons are only ever numbers here: copy names them with `{card:<n>}`, which the browser fills
 * from the private manifest.
 */

const guessed = (g: GameEvents) => g.of('word').filter((e) => str(e, 'outcome') === 'guessed');

/** The best (or least) value per clue giver over the guessed words. */
function perGiver(
  events: readonly RecapEvent[],
  value: (e: RecapEvent) => number | undefined,
  pick: (a: number, b: number) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const v = value(e);
    if (v === undefined) continue;
    for (const id of strs(e, 'givers')) out.set(id, out.has(id) ? pick(out.get(id)!, v) : v);
  }
  return out;
}

const rules: AwardRule[] = [
  {
    id: 'ic.mind-reader',
    emoji: '🔮',
    title: 'Mind Reader',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} guessed {n} words first. Stop reading minds',
        '{who} cracked {n} boards before anyone else',
      ],
      wholesome: [
        '{who} found {n} words first. Brilliant reading',
        '{who} saw what the icons meant, {n|time}',
      ],
    },
    compute: (g) => mostBy(guessed(g), undefined, { min: 2 }),
  },
  {
    id: 'ic.speed-demon',
    emoji: '⚡',
    title: 'Speed Demon',
    wholesomeTitle: 'Quick Thinker',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'speed',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} got a word in {s} s. Was it rigged?', '{who} needed only {s} s. Show-off'],
      wholesome: ['{who} found a word in just {s} s', '{who} guessed in {s} s flat'],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const e of guessed(g)) {
        const ms = num(e, 'ms');
        if (!e.playerId || ms === undefined || ms > 60_000) continue;
        best.set(e.playerId, Math.min(best.get(e.playerId) ?? Infinity, ms));
      }
      return leaders(best, { lowest: true }).map((c) => ({
        ...c,
        params: { s: seconds(c.value) },
      }));
    },
  },
  {
    id: 'ic.minimalist',
    emoji: '🪶',
    title: 'Minimalist',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clues',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} needed just {pieces}. Smug about it',
        'Only {pieces} from {who}, and it landed',
      ],
      wholesome: [
        '{who} said it all with {pieces}',
        '{who} gave a clean clue: {pieces}, word found',
      ],
    },
    compute: (g) =>
      leaders(
        perGiver(
          guessed(g),
          (e) => {
            const n = num(e, 'pieces');
            return n !== undefined && n >= 1 && n <= 4 ? n : undefined;
          },
          Math.min,
        ),
        { lowest: true },
      ).map((c) => ({ ...c, params: { pieces: count(c.value, 'piece') } })),
  },
  {
    id: 'ic.painter',
    emoji: '🎨',
    title: 'Painter',
    wholesomeTitle: 'Master Builder',
    valence: 'gentle',
    weight: 3,
    kind: 'award',
    family: 'clues',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} used {n} pieces on one word. A masterpiece',
        '{who} piled {n} pieces on the board. Subtle',
      ],
      wholesome: [
        '{who} built a {n}-piece clue and got there',
        '{who} painted the board with {n} pieces',
      ],
    },
    compute: (g) =>
      leaders(
        perGiver(guessed(g), (e) => num(e, 'pieces'), Math.max),
        { min: 10 },
      ),
  },
  {
    id: 'ic.close-call',
    emoji: '🤏',
    title: 'So Close',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} was “close” {n|time}. Never quite', '{who} got {n} “close” marks. Warm…'],
      wholesome: [
        '{who} was on the right track {n|time}',
        '{who} earned {n} “close” marks. Getting warmer',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('word').flatMap((e) => strs(e, 'closeBy').map((id) => ({ ...e, playerId: id }))),
        undefined,
        { min: 2 },
      ),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'ic.fastest',
    emoji: '⏱️',
    interest: 3,
    record: 'min',
    compute: (games) => {
      const times = games.flatMap((g) =>
        guessed(g).flatMap((e) => {
          const ms = num(e, 'ms');
          return ms !== undefined && ms > 0 ? [ms] : [];
        }),
      );
      if (!times.length) return null;
      const best = Math.min(...times);
      return { value: seconds(best), text: `Fastest word guessed: ${seconds(best)} s` };
    },
  },
  {
    id: 'ic.icon-of-night',
    emoji: '🖼️',
    interest: 3,
    compute: (games) => {
      const counts = new Map<number, number>();
      for (const g of games)
        for (const e of g.of('word'))
          for (const icon of nums(e, 'icons')) counts.set(icon, (counts.get(icon) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const [icon, n] = top[0] ?? [0, 0];
      if (n < 3 || top[1]?.[1] === n) return null;
      return { value: n, text: `Icon of the night: ${ph.card(String(icon))}, in ${n} clues` };
    },
  },
  {
    id: 'ic.words',
    emoji: '💡',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + guessed(g).length, 0);
      return n >= 3 ? { value: n, text: `Words guessed: ${n}` } : null;
    },
  },
];

/** One line per word, in order. */
function history(g: GameEvents): string[] {
  return g.of('word').map((e) => {
    const word = `“${plain(str(e, 'word') ?? 'a word')}”`;
    if (str(e, 'outcome') !== 'guessed') return `${word} was abandoned`;
    const by = e.playerId ? ph.p(e.playerId) : 'Someone';
    const ms = num(e, 'ms');
    return ms !== undefined ? `${by} guessed ${word} in ${seconds(ms)} s` : `${by} guessed ${word}`;
  });
}

export const iconicAwards: AwardModule = { rules, nuggets, history, stripSize: 3 };
