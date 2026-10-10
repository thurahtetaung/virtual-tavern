import type { Edition, LogEntry, Note, Role, RoyalPostView } from '../logic/types.ts';

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

type Name = (role: Role) => string;

/** One public log line, from the viewer's point of view. */
export function describeLog(view: RoyalPostView, entry: LogEntry, card: Name): string {
  const who = (id: string | null) => (id === view.me?.id ? 'you' : nameOf(view, id));
  const Who = (id: string | null) => (id === view.me?.id ? 'You' : nameOf(view, id));
  if (entry.kind === 'round-end') {
    const won = entry.winners.length
      ? `${listNames(entry.winners.map(Who))} won the round`
      : 'Nobody won the round';
    const spy = entry.spy ? ` ${Who(entry.spy)} gained a token for the Spy.` : '';
    return `${won}${entry.reason === 'deck-empty' ? ' with the highest card' : ''}.${spy}`;
  }
  if (entry.kind === 'out') {
    const cards = entry.cards.length ? `, holding ${listNames(entry.cards.map(card))}` : '';
    if (entry.cause === 'left')
      return `${Who(entry.player)} left and ${entry.player === view.me?.id ? 'are' : 'is'} out${cards}.`;
    return `${Who(entry.player)} ${entry.player === view.me?.id ? 'are' : 'is'} out${cards}.`;
  }
  const by = Who(entry.by);
  const played = `${by} played ${card(entry.card)}`;
  if (entry.noEffect) return `${played}, with nobody to choose.`;
  const target =
    entry.target === entry.by
      ? entry.by === view.me?.id
        ? 'yourself'
        : 'themselves'
      : who(entry.target);
  switch (entry.card) {
    case 'guard':
      return `${played} on ${target}, naming ${card(entry.guess!)}: ${entry.hit ? 'right!' : 'wrong.'}`;
    case 'priest':
      return `${played} and looked at ${target === 'you' ? 'your' : `${target}’s`} hand.`;
    case 'baron':
      return `${played} to compare hands with ${target}${entry.tie ? ': a tie.' : '.'}`;
    case 'handmaid':
      return `${played} and ${entry.by === view.me?.id ? 'are' : 'is'} protected.`;
    case 'prince':
      return `${played} on ${target}, discarding ${card(entry.discarded!)}.`;
    case 'chancellor':
      return entry.drew ? `${played} and drew ${entry.drew}.` : `${played}; the deck was empty.`;
    case 'king':
      return `${played} and traded hands with ${target}.`;
    default:
      return `${played}.`;
  }
}

/** One private note, for its owner. */
export function describeNote(view: RoyalPostView, note: Note, card: Name): string {
  const other = nameOf(view, note.kind === 'peek' ? note.target : note.other);
  switch (note.kind) {
    case 'peek':
      return `You saw ${other}’s card: ${card(note.card)}.`;
    case 'compare': {
      const outcome =
        note.result === 'win' ? 'You win.' : note.result === 'lose' ? 'You lose.' : 'A tie.';
      return `You compared hands with ${other}: your ${card(note.mine)} against their ${card(note.theirs)}. ${outcome}`;
    }
    case 'trade':
      return `You traded hands with ${other}: you gave ${card(note.gave)} and got ${card(note.got)}.`;
  }
}
