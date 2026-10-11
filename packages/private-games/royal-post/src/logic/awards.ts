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
  ph,
  str,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Royal Post, read from its `insights` events (`play`, `guard`,
 * `elimination`, `round`, `spy`, `outcome`). Cards are only ever ids here: copy uses `{role}`,
 * which the browser names from the private manifest.
 */

const rounds = (g: GameEvents) => g.of('round');

/** Who held the fewest tokens after each round, replayed from the round results. */
function tokenReplay(g: GameEvents): { totals: Map<string, number>; lastAt: Set<string>[] } {
  const totals = new Map<string, number>(g.players.map((id) => [id, 0]));
  const lastAt: Set<string>[] = [];
  for (const r of rounds(g)) {
    const to = strs(r, 'tokensTo');
    const gained = to.length
      ? to
      : [...strs(r, 'roundWinners'), ...(str(r, 'spy') ? [str(r, 'spy')!] : [])];
    for (const id of gained) if (totals.has(id)) totals.set(id, totals.get(id)! + 1);
    const low = Math.min(...totals.values());
    const high = Math.max(...totals.values());
    lastAt.push(
      high > low ? new Set([...totals].filter(([, v]) => v === low).map(([id]) => id)) : new Set(),
    );
  }
  return { totals, lastAt };
}

/** Each flagged player gets the award (shared by up to three). */
const flagged = (players: string[], value = 1): AwardCandidate[] => {
  const ids = [...new Set(players)].sort();
  return ids.length && ids.length <= 3 ? [{ players: ids, value }] : [];
};

const rules: AwardRule[] = [
  {
    id: 'rp.royal-favourite',
    emoji: '💌',
    title: 'Royal Favourite',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'wins',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} won {n} rounds. The court is smitten',
        '{who} took {n} rounds and the palace gossip',
      ],
      wholesome: ['{who} won the court’s heart {n} times', '{who} charmed the court in {n} rounds'],
    },
    compute: (g) => mostBy(rounds(g), (e) => strs(e, 'roundWinners'), { min: 2 }),
  },
  {
    id: 'rp.lucky-guard',
    emoji: '🛡️',
    title: 'Lucky Guard',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'guess',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} named the right card {n|time}. Psychic or peeking?',
        '{who} guessed hands {n|time}. We are checking sleeves',
      ],
      wholesome: [
        '{who} read the room perfectly, {n|time}',
        '{who} named the hidden card {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('guard').filter((e) => bool(e, 'hit') === true),
        undefined,
      ),
  },
  {
    id: 'rp.princess-fumbler',
    emoji: '👸',
    title: 'Princess Fumbler',
    wholesomeTitle: 'Loyal Guardian',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'knockout',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} was knocked out holding the {role}',
        '{who} lost the {role} {n|time}. Royal oops',
      ],
      wholesome: [
        '{who} protected the {role} until the end',
        '{who} stood by the {role} to the last, {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g
          .of('elimination')
          .filter((e) => bool(e, 'lostPrincess') === true && str(e, 'cause') !== 'princess'),
      ).map((c) => ({ ...c, params: { role: 'princess' } })),
  },
  {
    id: 'rp.royal-self-own',
    emoji: '🤦',
    title: 'Royal Self-Own',
    wholesomeTitle: 'Selfless Sacrifice',
    valence: 'chaos',
    weight: 5,
    kind: 'moment',
    family: 'knockout',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} discarded the {role} themselves',
        '{who} threw away the {role}. On purpose? Unclear',
      ],
      wholesome: [
        '{who} made a selfless sacrifice of the {role}',
        '{who} let the {role} go with great dignity',
      ],
    },
    compute: (g) =>
      flagged(
        g
          .of('elimination')
          .filter(
            (e) =>
              str(e, 'cause') === 'princess' &&
              e.playerId !== null &&
              (str(e, 'by') ?? e.playerId) === e.playerId,
          )
          .map((e) => e.playerId!),
      ).map((c) => ({ ...c, params: { role: 'princess' } })),
  },
  {
    id: 'rp.duelist',
    emoji: '⚔️',
    title: 'Duelist',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'knockout',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} won {n} duels. Pistols at dawn', '{who} out-ranked rivals {n|time} in duels'],
      wholesome: ['{who} won {n} duels with grace', '{who} came out on top in {n} duels'],
    },
    compute: (g) =>
      mostBy(
        g.of('elimination').filter((e) => str(e, 'cause') === 'baron'),
        (e) => {
          const by = str(e, 'by');
          return by && by !== e.playerId ? by : null;
        },
      ),
  },
  {
    id: 'rp.most-wanted',
    emoji: '🎯',
    title: 'Most Wanted',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'attention',
    minPlayers: 3,
    copy: {
      cheeky: ['Everyone aimed at {who}: {n} times', '{who} was targeted {n} times. Popular!'],
      wholesome: [
        '{who} was the centre of attention, {n} times',
        'All eyes were on {who}: {n} cards',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('play'),
        (e) => {
          const t = str(e, 'target');
          return t && t !== e.playerId ? t : null;
        },
        { min: 3 },
      ),
  },
  {
    id: 'rp.spy-bonus',
    emoji: '🕵️',
    title: 'Spy Bonus',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'spy',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} pocketed the {role} bonus {n|time}',
        '{who} slipped a {role} past us {n|time}',
      ],
      wholesome: [
        '{who} played the {role} perfectly, {n|time}',
        '{who} earned the {role} bonus {n|time}',
      ],
    },
    compute: (g) => mostBy(g.of('spy')).map((c) => ({ ...c, params: { role: 'spy' } })),
  },
  {
    id: 'rp.last-one-standing',
    emoji: '🧍',
    title: 'Last One Standing',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'wins',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} outlasted everyone {n|time}',
        '{who} was the last one in, {n|time}. Stubborn',
      ],
      wholesome: [
        '{who} kept going to the end, {n|time}',
        '{who} stood firm while others fell, {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        rounds(g).filter((e) => str(e, 'reason') === 'last-standing'),
        (e) => strs(e, 'roundWinners'),
      ),
  },
  {
    id: 'rp.swing-and-a-miss',
    emoji: '🤡',
    title: 'Swing and a Miss',
    wholesomeTitle: 'Keeping Them Guessing',
    valence: 'chaos',
    weight: 1,
    kind: 'award',
    family: 'guess',
    minPlayers: 2,
    copy: {
      cheeky: ['{who}’s {role} missed {n} times', '{who} guessed wrong {n} times with the {role}'],
      wholesome: [
        '{who} kept the others guessing, {n} times',
        '{who} tried the {role} {n} times, bravely',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('guard').filter((e) => bool(e, 'hit') === false),
        undefined,
        { min: 3 },
      ).map((c) => ({ ...c, params: { role: 'guard' } })),
  },
  {
    id: 'rp.comeback-courtier',
    emoji: '👑',
    title: 'Comeback Courtier',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'wins',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} came back from last place to win',
        '{who} was dead last, then took the crown',
      ],
      wholesome: [
        '{who} never stopped believing, and won',
        '{who} climbed from last place to first',
      ],
    },
    compute: (g) => {
      if (rounds(g).length < 3) return [];
      const { lastAt } = tokenReplay(g);
      // Last at some point before the final round, and the game's winner.
      const wasLast = new Set(lastAt.slice(0, -1).flatMap((s) => [...s]));
      return flagged(g.winners.filter((id) => wasLast.has(id)));
    },
  },
  {
    id: 'rp.hide-and-seek',
    emoji: '🏰',
    title: 'Hide and Seek',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'cards',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} played the {role} {n} times. Hiding?',
        '{who} ducked behind the {role} {n} times',
      ],
      wholesome: [
        '{who} played it safe and smart, {n} times',
        '{who} sheltered with the {role} {n} times',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('play').filter((e) => str(e, 'card') === 'handmaid'),
        undefined,
        { min: 2 },
      ).map((c) => ({ ...c, params: { role: 'handmaid' } })),
  },
  {
    id: 'rp.autopilot',
    emoji: '😴',
    title: 'Autopilot',
    wholesomeTitle: 'Deep Thinker',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'time',
    minPlayers: 2,
    stripOnly: true,
    copy: {
      cheeky: [
        '{who} took their time: the timer played {n} cards',
        '{who} took their time, {n|time}',
      ],
      wholesome: ['{who} thought deeply, {n|time}', '{who} let fate decide {n|time}'],
    },
    compute: (g) => mostBy(g.of('play').filter((e) => bool(e, 'auto') === true)),
  },
  // ---- Moments ----
  {
    id: 'rp.opening-strike',
    emoji: '⚡',
    title: 'Opening Strike',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'guess',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} guessed a hand with the round’s first card',
        '{who} struck on the very first play',
      ],
      wholesome: [
        '{who} read a hand on the very first play',
        '{who} opened the round with a perfect guess',
      ],
    },
    compute: (g) => {
      const hits: string[] = [];
      let first = true;
      for (const e of g.events) {
        if (e.type === 'round') first = true;
        else if (e.type === 'play') {
          if (first && str(e, 'card') === 'guard') {
            const guard = g.events[g.events.indexOf(e) + 1];
            if (guard?.type === 'guard' && bool(guard, 'hit') && e.playerId) hits.push(e.playerId);
          }
          first = false;
        }
      }
      return flagged(hits);
    },
  },
  {
    id: 'rp.princess-down',
    emoji: '💥',
    title: 'Princess Down',
    valence: 'chaos',
    weight: 4,
    kind: 'moment',
    family: 'knockout',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} lost the {role} to a {role2}', '{who} was made to drop the {role}. Ouch'],
      wholesome: [
        '{who} parted with the {role} by royal decree',
        '{who} let the {role} go when asked',
      ],
    },
    compute: (g) =>
      flagged(
        g
          .of('elimination')
          .filter((e) => str(e, 'cause') === 'prince' && bool(e, 'lostPrincess') === true)
          .flatMap((e) => (e.playerId ? [e.playerId] : [])),
      ).map((c) => ({ ...c, params: { role: 'princess', role2: 'prince' } })),
  },
  {
    id: 'rp.dead-heat',
    emoji: '🤝',
    title: 'Dead Heat',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    family: 'duel',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} drew a duel. Pistols jammed', '{who} tied a {role} duel. Nobody blinked'],
      wholesome: ['{who} met an equal in a {role} duel', '{who} found a perfect match in a duel'],
    },
    compute: (g) =>
      flagged(
        g
          .of('play')
          .filter((e) => str(e, 'card') === 'baron' && bool(e, 'tie') === true)
          .flatMap((e) => (e.playerId ? [e.playerId] : [])),
      ).map((c) => ({ ...c, params: { role: 'baron' } })),
  },
  {
    id: 'rp.spy-decider',
    emoji: '🎩',
    title: 'Spy Decides It',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'spy',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} won the game on a {role} bonus. Sneaky',
        '{who} sealed it with the {role} bonus',
      ],
      wholesome: ['{who} won with a perfectly timed {role}', '{who} let the {role} bring it home'],
    },
    compute: (g) => {
      const last = rounds(g).at(-1);
      const spy = str(last, 'spy');
      return spy && g.winners.includes(spy)
        ? [{ players: [spy], value: 1, params: { role: 'spy' } }]
        : [];
    },
  },
];

const allGames = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));

const nuggets: NuggetRule[] = [
  {
    id: 'rp.rounds',
    emoji: '💌',
    interest: 1,
    compute: (games) => {
      const n = allGames(games, 'round').length;
      return n ? { value: n, text: `${n} rounds of courtship` } : null;
    },
  },
  {
    id: 'rp.knockouts',
    emoji: '🗡️',
    interest: 2,
    compute: (games) => {
      const outs = allGames(games, 'elimination');
      const top = leaders(tally(outs, (e) => str(e, 'cause') ?? null))[0];
      if (!outs.length || !top || top.players.length !== 1) return null;
      return {
        value: outs.length,
        text: `${outs.length} knock-outs, most by ${ph.role(top.players[0]!)}`,
      };
    },
  },
  {
    id: 'rp.guard-rate',
    emoji: '🎯',
    interest: 3,
    compute: (games) => {
      const guesses = allGames(games, 'guard');
      if (guesses.length < 3) return null;
      const hit = guesses.filter((e) => bool(e, 'hit')).length;
      const pct = Math.round((hit / guesses.length) * 100);
      return { value: pct, text: `${pct}% of guesses named the card` };
    },
  },
  {
    id: 'rp.most-played',
    emoji: '🃏',
    interest: 2,
    compute: (games) => {
      const top = leaders(tally(allGames(games, 'play'), (e) => str(e, 'card') ?? null))[0];
      if (!top || top.players.length !== 1) return null;
      return { value: top.value, text: `${ph.role(top.players[0]!)} played ${top.value} times` };
    },
  },
  {
    id: 'rp.token-spread',
    emoji: '🏅',
    interest: 2,
    compute: (games) => {
      const last = games.at(-1)?.of('outcome').at(-1);
      const tokens = (last?.props.tokens as unknown[] | undefined)?.filter(
        (t): t is number => typeof t === 'number',
      );
      if (!tokens?.length) return null;
      return { value: tokens[0]!, text: `Final tokens: ${tokens.join('–')}` };
    },
  },
];

/** "Round 2: {p:x} won with {role:princess}". */
function history(g: GameEvents): string[] {
  return rounds(g)
    .slice(-12)
    .map((r: RecapEvent, i) => {
      const n = num(r, 'round') ?? i + 1;
      const winners = strs(r, 'roundWinners');
      const survivors = strs(r, 'survivors');
      const cards = strs(r, 'finalCards');
      const spy = str(r, 'spy');
      const spyNote = spy ? ` (${ph.p(spy)} gets the ${ph.role('spy')} bonus)` : '';
      if (!winners.length) return `Round ${n}: a tie, nobody won${spyNote}`;
      const who = winners.map(ph.p).join(' & ');
      if (str(r, 'reason') === 'last-standing')
        return `Round ${n}: ${who} was last standing${spyNote}`;
      const card = winners.length === 1 ? cards[survivors.indexOf(winners[0]!)] : undefined;
      return `Round ${n}: ${who} won${card ? ` with ${ph.role(card)}` : ''}${spyNote}`;
    });
}

export const royalPostAwards: AwardModule = { rules, nuggets, stripSize: 2, history };
