import {
  EDITIONS,
  type Edition,
  type LogEntry,
  type Note,
  type Role,
  type RoyalPostView,
} from '../logic/types.ts';

export const ROLE_EMOJI: Record<Role, string> = {
  spy: '🕶️',
  guard: '🛡️',
  priest: '📿',
  baron: '⚖️',
  handmaid: '🌸',
  prince: '🤴',
  chancellor: '📜',
  king: '👑',
  countess: '💃',
  princess: '👸',
};

/** What each card does, in a sentence. */
export function cardText(role: Role, edition: Edition): string {
  switch (role) {
    case 'spy':
      return 'No effect. At the end of the round, if you are the only player still in who played or discarded a Spy, you gain a token.';
    case 'guard':
      return `Choose another player and name a card other than the Guard${edition === '2019' ? ' (the Spy counts)' : ''}. If they hold it, they are out.`;
    case 'priest':
      return 'Choose another player and secretly look at their hand.';
    case 'baron':
      return 'Choose another player and secretly compare hands. The lower card is out; a tie does nothing.';
    case 'handmaid':
      return 'Until your next turn, other players’ cards can’t choose you.';
    case 'prince':
      return 'Choose any player, yourself included. They discard their hand and draw a new card. Discarding the Princess knocks them out.';
    case 'chancellor':
      return 'Draw two cards. Keep one of your three and put the other two on the bottom of the deck in any order.';
    case 'king':
      return 'Choose another player and trade hands with them.';
    case 'countess':
      return 'No effect, but you must play her if your other card is the King or a Prince.';
    case 'princess':
      return 'If you play or discard her, you are out of the round.';
  }
}

export const nameOf = (view: RoyalPostView, id: string | null | undefined) =>
  view.round?.players.find((p) => p.id === id)?.name ??
  view.seats.find((s) => s.id === id)?.name ??
  'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A line of text in which card names are kept apart, so the screen can make them tappable. */
export type Segment = string | { card: Role };
export type Line = Segment[];

/** Builds a line from a template: `line\`${who} played ${c('guard')}\``. */
const line = (strings: TemplateStringsArray, ...parts: Segment[]): Line => {
  const out: Line = [];
  strings.forEach((s, i) => {
    if (s) out.push(s);
    if (i < parts.length) out.push(parts[i]!);
  });
  return out;
};
const c = (card: Role): Segment => ({ card });

/** "Guard", "Guard and Spy", "Guard, Spy and King", as segments. */
function listCards(cards: readonly Role[]): Line {
  return cards.flatMap((card, i) => [
    ...(i === 0 ? [] : [i === cards.length - 1 ? ' and ' : ', ']),
    c(card),
  ]);
}

/** A line as plain words, with each card named by `name`. */
export const plainText = (l: Line, name: (role: Role) => string) =>
  l.map((s) => (typeof s === 'string' ? s : name(s.card))).join('');

/** One public log line, from the viewer's point of view. */
export function describeLog(view: RoyalPostView, entry: LogEntry): Line {
  const who = (id: string | null) => (id === view.me?.id ? 'you' : nameOf(view, id));
  const Who = (id: string | null) => (id === view.me?.id ? 'You' : nameOf(view, id));
  if (entry.kind === 'round-end') {
    const won = entry.winners.length
      ? `${listNames(entry.winners.map(Who))} won the round`
      : 'Nobody won the round';
    const spy = entry.spy ? line` ${Who(entry.spy)} gained a token for the ${c('spy')}.` : [];
    return [`${won}${entry.reason === 'deck-empty' ? ' with the highest card' : ''}.`, ...spy];
  }
  if (entry.kind === 'out') {
    const cards = entry.cards.length ? [', holding ', ...listCards(entry.cards)] : [];
    const are = entry.player === view.me?.id ? 'are' : 'is';
    if (entry.cause === 'left')
      return [`${Who(entry.player)} left and ${are} out of the round`, ...cards, '.'];
    const by = entry.by && entry.by !== entry.player ? entry.by : null;
    const whose = (id: string) => (id === view.me?.id ? 'your' : `${nameOf(view, id)}’s`);
    const reason: Line =
      entry.cause === 'guard' && by
        ? line` (${whose(by)} ${c('guard')} named it)`
        : entry.cause === 'baron' && by
          ? line` (${who(by)} won the ${c('baron')} comparison)`
          : entry.cause === 'prince'
            ? line` (the ${c('prince')} made ${entry.player === view.me?.id ? 'you' : 'them'} discard the ${c('princess')})`
            : entry.cause === 'princess'
              ? line` (the ${c('princess')} left ${entry.player === view.me?.id ? 'your' : 'their'} hand)`
              : [];
    return [`${Who(entry.player)} ${are} out of the round`, ...cards, ...reason, '.'];
  }
  const timedOut = entry.timedOut
    ? [`⏱ Time ran out, so a card was played for ${who(entry.by)}: `]
    : [];
  const played = [
    ...timedOut,
    ...line`${entry.timedOut ? who(entry.by) : Who(entry.by)} played ${c(entry.card)}`,
  ];
  if (entry.noEffect) return [...played, ', with nobody to choose.'];
  const target =
    entry.target === entry.by
      ? entry.by === view.me?.id
        ? 'yourself'
        : 'themselves'
      : who(entry.target);
  switch (entry.card) {
    case 'guard':
      return [
        ...played,
        ...line` on ${target}, naming ${c(entry.guess!)}: ${entry.hit ? 'right!' : 'wrong.'}`,
      ];
    case 'priest':
      return [...played, ` and looked at ${target === 'you' ? 'your' : `${target}’s`} hand.`];
    case 'baron':
      return [...played, ` to compare hands with ${target}${entry.tie ? ': a tie.' : '.'}`];
    case 'handmaid':
      return [...played, ` and ${entry.by === view.me?.id ? 'are' : 'is'} protected.`];
    case 'prince':
      // Name who discarded, so it can't be read as the Prince's player discarding.
      return [
        ...played,
        ...line` on ${target}: ${entry.target === view.me?.id ? 'you' : nameOf(view, entry.target)} discarded ${c(entry.discarded!)}${entry.discarded === 'princess' ? '.' : ' and drew a new card.'}`,
      ];
    case 'chancellor':
      return entry.drew
        ? [
            ...played,
            ` and drew ${entry.drew}.`,
            ...(entry.autoKept
              ? [
                  ` ⏱ Time ran out, so a card was kept for ${entry.by === view.me?.id ? 'you' : 'them'}.`,
                ]
              : []),
          ]
        : [...played, '; the deck was empty.'];
    case 'king':
      return [...played, ` and traded hands with ${target}.`];
    default:
      return [...played, '.'];
  }
}

/** One private note, for its owner. */
export function describeNote(view: RoyalPostView, note: Note): Line {
  const body = noteBody(view, note);
  return note.timedOut ? ['⏱ Time ran out, so a card was played for you. ', ...body] : body;
}

/** The other player a note is about. */
export function noteOther(note: Note): string | null {
  switch (note.kind) {
    case 'peek':
      return note.target;
    case 'seen':
      return note.by;
    case 'bottom':
      return null;
    default:
      return note.other;
  }
}

function noteBody(view: RoyalPostView, note: Note): Line {
  const other = nameOf(view, noteOther(note));
  switch (note.kind) {
    case 'peek':
      return line`You saw ${other}’s card: ${c(note.card)}.`;
    case 'seen':
      return line`${other} looked at your card with the ${c('priest')}: they know you hold ${c(note.card)}.`;
    case 'compare': {
      const outcome =
        note.result === 'win'
          ? `Yours is higher: ${other} is out of the round.`
          : note.result === 'lose'
            ? 'Theirs is higher: you are out of the round.'
            : `A tie: nobody is out, and ${other} knows your card too.`;
      return line`You compared hands with ${other}: your ${c(note.mine)} against their ${c(note.theirs)}. ${outcome}`;
    }
    case 'trade':
      return line`You traded hands with ${other}: you gave ${c(note.gave)} and got ${c(note.got)}, so ${other} knows you hold ${c(note.got)}.`;
    case 'bottom':
      return note.cards.length === 1
        ? line`You put ${c(note.cards[0]!)} at the bottom of the deck.`
        : line`You put ${c(note.cards[0]!)}, then ${c(note.cards[1]!)} (the very bottom), at the bottom of the deck.`;
  }
}

/**
 * How many of each card the viewer hasn't seen yet: the edition's count less every discard (out
 * players' hands included), the face-up set-aside cards and the viewer's own hand. These are in
 * other hands, the deck or the face-down set-aside card. `inDeck` counts those the viewer knows
 * are still in the deck, because their Chancellor put them at the bottom.
 */
export function unseenCounts(
  view: RoyalPostView,
): { role: Role; rank: number; total: number; unseen: number; inDeck: number }[] {
  const round = view.round;
  const seen = new Map<Role, number>();
  const add = (r: Role) => seen.set(r, (seen.get(r) ?? 0) + 1);
  if (round) {
    for (const p of round.players) p.discards.forEach(add);
    round.faceUp.forEach(add);
    view.hand.forEach(add);
  }
  const known = view.knownDeck ?? [];
  return EDITIONS[view.settings.edition].cards.map(({ role, rank, count }) => {
    const unseen = Math.max(0, count - (seen.get(role) ?? 0));
    return {
      role,
      rank,
      total: count,
      unseen,
      inDeck: Math.min(unseen, known.filter((r) => r === role).length),
    };
  });
}

/** The round result's Spy line: who gained the bonus, or why nobody did. Null if nobody played one. */
export function spyBonusLine(view: RoyalPostView): Line | null {
  const result = view.round?.result;
  if (!result) return null;
  const Who = (id: string) => (id === view.me?.id ? 'You' : nameOf(view, id));
  if (result.spy) return line`${Who(result.spy)} gained a token for the ${c('spy')}.`;
  const spies = result.spies ?? [];
  if (spies.length < 2) return null;
  const names = listNames(spies.map((id) => (id === view.me?.id ? 'you' : nameOf(view, id))));
  return line`${spies.length === 2 ? 'Both ' : 'All of '}${names} played a ${c('spy')}, so nobody gets the bonus.`;
}

/** Classic ties: the discard totals, and what they settled. Null when there was no tie to settle. */
export function tiebreakLine(view: RoyalPostView): string | null {
  const result = view.round?.result;
  if (!result?.discardTotals) return null;
  const totals = Object.entries(result.discardTotals)
    .map(([id, n]) => `${nameOf(view, id)} ${n}`)
    .join(', ');
  const settled =
    result.winners.length > 1 ? ' Still tied on discards, so each of them wins a token.' : '';
  return `Tied cards were settled on discards: ${totals}.${settled}`;
}

/** Everyone's tokens against the target, most first: "4 tokens to win: Ana 3, Ben 1". */
export function tokensLine(view: RoyalPostView): string {
  const ids = view.round?.players.map((p) => p.id) ?? [];
  const tokens = (id: string) => view.seats.find((s) => s.id === id)?.tokens ?? 0;
  const list = ids
    .filter((id) => view.seats.some((s) => s.id === id))
    .sort((a, b) => tokens(b) - tokens(a))
    .map((id) => `${id === view.me?.id ? 'You' : nameOf(view, id)} ${tokens(id)}`)
    .join(', ');
  const n = view.target;
  return `${n} token${n === 1 ? '' : 's'} to win${list ? `: ${list}` : ''}.`;
}

/** The viewer's notes from the round on the table, and those from earlier rounds. */
export function notesByRound(view: RoyalPostView): { current: Note[]; earlier: Note[] } {
  const number = view.round?.number ?? 0;
  return {
    current: view.notes.filter((n) => n.round === number),
    earlier: view.notes.filter((n) => n.round !== number),
  };
}

/**
 * Notes made by the move that ended the round (a Baron comparison, say): shown in the round
 * result rather than popping up over it.
 */
export function roundEndingNotes(view: RoyalPostView): Note[] {
  const round = view.round;
  if (!round || round.stage !== 'over') return [];
  const lastPlay = view.log.findLast((e) => e.kind === 'play' && e.round === round.number);
  if (!lastPlay) return [];
  return view.notes.filter((n) => n.round === round.number && n.id > lastPlay.id);
}
