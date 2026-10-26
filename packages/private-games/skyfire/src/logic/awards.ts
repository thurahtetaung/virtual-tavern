import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  num,
  str,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Skyfire, read from its `insights` events (`clue`, `play`,
 * `discard`, `outcome`). Moves the table made for someone (`auto`) never earn an award.
 */

const own = (g: GameEvents, type: string) => g.of(type).filter((e) => bool(e, 'auto') !== true);
const plays = (g: GameEvents) => own(g, 'play');
const outcome = (g: GameEvents) => g.of('outcome').at(-1);

const rules: AwardRule[] = [
  {
    id: 'sf.perfect',
    emoji: '🎆',
    title: 'Perfect Show',
    valence: 'glory',
    weight: 5,
    kind: 'team',
    family: 'result',
    copy: {
      cheeky: [
        '{who} lit every firework: {n} points. Show-offs',
        '{who} put on a perfect {n}-point show',
      ],
      wholesome: [
        '{who} gave a flawless {n}-point show',
        '{who} lit every firework for {n} points',
      ],
    },
    compute: (g) => {
      const o = outcome(g);
      const score = num(o, 'score');
      if (bool(o, 'win') !== true || score === undefined || !g.players.length) return [];
      return [{ players: [...g.players].sort(), value: score }];
    },
  },
  {
    id: 'sf.telepath',
    emoji: '🔮',
    title: 'Telepath',
    wholesomeTitle: 'Mind Reader',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clue',
    copy: {
      cheeky: [
        'One clue from {who}, {n} cards played. Spooky',
        '{who} said one word and {n} cards flew',
      ],
      wholesome: ['{who} gave one clue that lit {n} cards', 'One clue from {who} led to {n} plays'],
    },
    compute: (g) => {
      // The plays each clue led to, credited to its giver (their best clue).
      const byClue = new Map<string, { by: string; n: number }>();
      for (const e of plays(g)) {
        const by = str(e, 'clueBy');
        const turn = num(e, 'clueTurn');
        if (bool(e, 'ok') !== true || !by || turn === undefined) continue;
        const k = `${by}:${turn}`;
        byClue.set(k, { by, n: (byClue.get(k)?.n ?? 0) + 1 });
      }
      const best = new Map<string, number>();
      for (const { by, n } of byClue.values()) best.set(by, Math.max(best.get(by) ?? 0, n));
      return leaders(best, { min: 2 });
    },
  },
  {
    id: 'sf.clue-machine',
    emoji: '💡',
    title: 'Clue Machine',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'clue',
    copy: {
      cheeky: [
        '{who} gave {n} clues. Never stops talking',
        '{who} handed out {n} clues like candy',
      ],
      wholesome: ['{who} guided the show with {n} clues', '{who} gave the table {n} clues'],
    },
    compute: (g) => mostBy(own(g, 'clue'), undefined, { min: 5 }),
  },
  {
    id: 'sf.lucky',
    emoji: '🍀',
    title: 'Lucky Guess',
    wholesomeTitle: 'Brave Spark',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'play',
    copy: {
      cheeky: [
        '{who} played {n} cards blind and got away with it',
        '{who} guessed right {n|time}. Pure luck?',
      ],
      wholesome: [
        '{who} trusted their gut {n|time} and lit it',
        '{who} played {n} unclued cards just right',
      ],
    },
    compute: (g) =>
      mostBy(
        plays(g).filter((e) => bool(e, 'ok') === true && bool(e, 'clued') === false),
        undefined,
        { min: 1 },
      ),
  },
  {
    id: 'sf.boom',
    emoji: '💥',
    title: 'Bomb Squad',
    wholesomeTitle: 'Bold Spark',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'blunder',
    copy: {
      cheeky: ['{who} burned {n} fuses. Stand back', '{who} set off {n} misfires. Kaboom'],
      wholesome: ['{who} took {n} brave chances on a card', '{who} lit {n} hopeful sparks'],
    },
    compute: (g) =>
      mostBy(
        plays(g).filter((e) => bool(e, 'ok') === false),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'sf.last-second',
    emoji: '⏳',
    title: 'Last-Second Hero',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'play',
    copy: {
      cheeky: [
        '{who} lit {n} cards in the last round. Cutting it fine',
        '{who} saved {n} plays for the end',
      ],
      wholesome: [
        '{who} lit {n} cards in the final round',
        '{who} came through with {n} last-round plays',
      ],
    },
    compute: (g) =>
      mostBy(
        plays(g).filter((e) => bool(e, 'ok') === true && bool(e, 'lastRound') === true),
        undefined,
        { min: 1 },
      ),
  },
  {
    id: 'sf.finisher',
    emoji: '🎇',
    title: 'Grand Finale',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'play',
    copy: {
      cheeky: ['{who} finished {n} fireworks. Hogging the glory', '{who} capped off {n} fireworks'],
      wholesome: [
        '{who} finished {n} fireworks with a flourish',
        '{who} lit the top of {n} fireworks',
      ],
    },
    compute: (g) =>
      mostBy(
        plays(g).filter((e) => bool(e, 'completed') === true),
        undefined,
        { min: 2 },
      ),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'sf.best-show',
    emoji: '🎆',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(-99, ...games.map((g) => num(outcome(g), 'score') ?? -99));
      return best > 0 ? { value: best, text: `Best show: ${best} points` } : null;
    },
  },
  {
    id: 'sf.cards-lit',
    emoji: '✨',
    interest: 2,
    compute: (games) => {
      const n = games.reduce(
        (sum, g) => sum + g.of('play').filter((e) => bool(e, 'ok') === true).length,
        0,
      );
      return n >= 10 ? { value: n, text: `${n} cards lit` } : null;
    },
  },
  {
    id: 'sf.clues',
    emoji: '💡',
    interest: 1,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('clue').length, 0);
      return n >= 10 ? { value: n, text: `${n} clues given` } : null;
    },
  },
];

const HOW: Record<string, string> = {
  perfect: 'a perfect show',
  deck: 'the deck ran out',
  fuses: 'the third fuse went',
  'lost-card': 'a needed card was lost',
  'no-cards': 'a player ran out of cards',
  ended: 'the host ended it',
};

/** One line for the show: what the fireworks reached and how it ended. */
function history(g: GameEvents): string[] {
  const o = outcome(g);
  const reached = num(o, 'reached');
  const how = HOW[str(o, 'how') ?? ''];
  if (reached === undefined || !how) return [];
  return [`Fireworks reached ${reached}: ${how}`];
}

export const skyfireAwards: AwardModule = { rules, nuggets, history, stripSize: 2 };

/** For tests: a rule's candidates. */
export const candidatesOf = (id: string, g: GameEvents): AwardCandidate[] =>
  rules.find((r) => r.id === id)?.compute?.(g) ?? [];
