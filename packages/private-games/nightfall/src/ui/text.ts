import { FRAME_LINES } from '../logic/plan.ts';
import { ROLES, type RoleId, isRoleId } from '../logic/roles.ts';
import type {
  NightfallView,
  NoteBody,
  Prompt,
  Slot,
  TeamResultId,
  TimelineEntry,
} from '../logic/types.ts';
import type { Deck } from './assets.ts';

export type NameOf = (id: string | null | undefined) => string;

export const nameOfView =
  (view: NightfallView): NameOf =>
  (id) =>
    view.table?.find((p) => p.id === id)?.name ??
    view.seats.find((s) => s.id === id)?.name ??
    'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export const centreName = (i: number, kinds?: readonly string[]) =>
  kinds?.[i] === 'wolf' ? 'the centre werewolf card' : `centre card ${i + 1}`;

export const TEAM_LABEL: Record<TeamResultId, string> = {
  village: 'Village',
  werewolf: 'Werewolves',
  vampire: 'Vampires',
  tanner: 'Tanner',
};

// ---- Narration text ----

/** What each role is told when it wakes, in our own words. */
const WAKE: Partial<Record<RoleId, string>> = {
  doppelganger: 'look at another player’s card. You are now that role; if it acts now, do it now.',
  sentinel: 'you may put a shield on another player’s card.',
  'alpha-wolf': 'swap the centre werewolf card with a non-werewolf player’s card.',
  'mystic-wolf': 'you may look at another player’s card.',
  minion: 'werewolves, show your thumbs so the Minion can see you.',
  'apprentice-tanner': 'Tanner, show your thumb.',
  mason: 'look for the other Masons.',
  thing: 'tap the neighbour on your left or your right.',
  seer: 'you may look at another player’s card, or two centre cards.',
  'apprentice-seer': 'you may look at one centre card.',
  'paranormal-investigator':
    'you may look at up to two other cards, one at a time. If one isn’t village, stop: you are now that role.',
  robber: 'you may swap your card with another player’s, then look at your new card.',
  witch: 'you may look at a centre card; if you do, swap it with any player’s card.',
  troublemaker: 'you may swap the cards of two other players.',
  'village-idiot': 'you may move everyone else’s card one seat left or right.',
  'aura-seer': 'anyone who has looked at or moved a card, show your thumb.',
  drunk: 'swap your card with a centre card, without looking.',
  insomniac: 'look at your own card.',
  squire: 'werewolves, show your thumbs; Squire, you may look at their cards.',
  beholder: 'seers, show your thumbs; Beholder, you may look at their cards.',
  revealer: 'you may turn another player’s card face up. If it isn’t village, turn it back.',
  curator: 'you may place an artifact on any player’s card.',
};

const sentence = (s: string | undefined) => (s ? s[0]!.toUpperCase() + s.slice(1) : '');

/** The words for a narration line key, in our own neutral text with the cards' names. */
export function lineText(key: string, deck: Deck): string {
  const n = (r: RoleId) => deck.name(r).toUpperCase();
  switch (key) {
    case FRAME_LINES.nightStart:
      return 'Everyone, close your eyes.';
    case FRAME_LINES.nightEnd:
      return 'Everyone, keep your eyes closed and touch your card.';
    case FRAME_LINES.dayStart:
      return 'Everyone, wake up!';
    case FRAME_LINES.oneMinute:
      return 'One minute left.';
    case FRAME_LINES.thirtySeconds:
      return 'Thirty seconds left.';
    case FRAME_LINES.vote:
      return 'Time’s up. Three, two, one… vote!';
    case 'werewolf:wake':
      return 'WEREWOLVES, wake up and look for each other.';
    case 'werewolf:wake:dream-wolf':
      return `WEREWOLVES, except the ${n('dream-wolf')}, wake up and look for each other. ${n('dream-wolf')}, show your thumb.`;
    case 'werewolf:lone-wolf':
      return 'If you are the only werewolf, you may look at a centre card.';
    case 'werewolf:close':
    case 'werewolf:close:dream-wolf':
      return 'WEREWOLVES, close your eyes.';
    case 'doppelganger:minion:wake':
      return `If you are now the ${deck.name('minion')}, keep your eyes open: werewolves, show your thumbs.`;
  }
  const parts = key.split(':');
  if (parts.includes('thumbs-away')) return 'Thumbs away.';
  if (parts[0] === 'doppelganger' && parts[1] && isRoleId(parts[1])) {
    return parts[2] === 'wake'
      ? `${n('doppelganger')}, if you copied the ${deck.name(parts[1])}, wake up. ${sentence(WAKE[parts[1]])}`.trim()
      : `${n('doppelganger')}, close your eyes.`;
  }
  const role = parts[0]!;
  if (!isRoleId(role)) return '';
  if (parts[1] === 'close') return `${n(role)}, close your eyes.`;
  return `${n(role)}, wake up. ${sentence(WAKE[role])}`.trim();
}

// ---- What players learn ----

export function slotName(slot: Slot, nameOf: NameOf, kinds?: readonly string[], me?: string) {
  if ('player' in slot) return slot.player === me ? 'your card' : `${nameOf(slot.player)}’s card`;
  return centreName(slot.center, kinds);
}

/** A note, from the point of view of the player it belongs to. */
export function describeNote(
  note: NoteBody,
  nameOf: NameOf,
  deck: Deck,
  kinds?: readonly string[],
  me?: string,
): string {
  const r = (role: RoleId) => deck.name(role);
  const who = (ids: string[]) => listNames(ids.map((id) => (id === me ? 'you' : nameOf(id))));
  switch (note.kind) {
    case 'copied':
      return `You looked at ${nameOf(note.target)}’s card: ${r(note.role)}. You are now the ${r(note.role)}.`;
    case 'saw':
      return `You saw ${slotName(note.slot, nameOf, kinds, me)}: ${r(note.role)}.`;
    case 'saw-own':
      return `Your card is now: ${r(note.role)}.`;
    case 'group': {
      const others = note.players.filter((p) => p !== me);
      const base =
        note.group === 'werewolves'
          ? others.length
            ? `Your fellow werewolves: ${who(others)}.`
            : 'No other werewolf woke up.'
          : others.length
            ? `The other Masons: ${who(others)}.`
            : 'No other Mason woke up.';
      const thumbs = note.thumbs?.filter((p) => p !== me) ?? [];
      return thumbs.length ? `${base} Showing a werewolf thumb: ${who(thumbs)}.` : base;
    }
    case 'thumbs': {
      const of = {
        werewolves: 'The werewolves',
        tanner: 'The Tanner',
        seers: 'The seers',
        touched: 'Looked at or moved a card',
      }[note.of];
      return `${of}: ${note.players.length ? who(note.players) : 'nobody'}.`;
    }
    case 'robbed':
      return `You swapped cards with ${nameOf(note.target)}. Your card is now: ${r(note.role)}.`;
    case 'swapped':
      return `You swapped ${slotName(note.a, nameOf, kinds, me)} and ${slotName(note.b, nameOf, kinds, me)}.`;
    case 'took-center':
      return `You swapped your card with ${centreName(note.center, kinds)}, without looking.`;
    case 'witched':
      return `You gave ${centreName(note.center, kinds)} to ${note.target === me ? 'yourself' : nameOf(note.target)}.`;
    case 'shielded':
      return `You put a shield on ${nameOf(note.target)}’s card.`;
    case 'tapped':
      return `You tapped ${nameOf(note.target)} on the shoulder.`;
    case 'was-tapped':
      return `Someone tapped you on the ${note.side} shoulder: the player on your ${note.side}.`;
    case 'moved-all':
      return `You moved everyone else’s card one seat to the ${note.side}.`;
    case 'revealed':
      return note.stayed
        ? `You turned ${nameOf(note.target)}’s card face up: ${r(note.role)}. It stays up.`
        : `You turned ${nameOf(note.target)}’s card: ${r(note.role)}. It went back face down.`;
    case 'artifact-placed':
      return `You placed an artifact on ${note.target === me ? 'your own' : `${nameOf(note.target)}’s`} card.`;
    case 'became':
      return `You stopped: you are now the ${r(note.role)}.`;
    case 'blocked':
      return note.reason === 'shielded'
        ? 'Your card is shielded, so you couldn’t act.'
        : 'There was nobody you could choose.';
    case 'passed':
      return 'You did nothing.';
    case 'artifact':
      return `There is an artifact on your card: ${deck.artifactName(note.artifact)}. ${deck.artifactText(note.artifact)}`;
  }
}

/** A timeline entry, in the third person, for the reveal. */
export function describeEntry(
  entry: TimelineEntry,
  nameOf: NameOf,
  deck: Deck,
  kinds?: readonly string[],
): string {
  if (entry.note.kind === 'nobody') return 'Nobody at the table had this card.';
  const by = nameOf(entry.by);
  const text = describeNote(entry.note, nameOf, deck, kinds, entry.by ?? undefined)
    .replace(/^You /, `${by} `)
    .replace(/ your card/g, ` ${by}’s card`)
    .replace(/^Your card/, `${by}’s card`)
    .replace(/ You are now/g, ` ${by} is now`)
    .replace(/\byou\b/g, by);
  const moved = entry.moved?.length
    ? ` (${entry.moved.map((m) => `${slotName(m.slot, nameOf, kinds)} was ${deck.name(m.role)}`).join('; ')})`
    : '';
  return `${text}${moved}${entry.auto ? ' (chosen when time ran out)' : ''}`;
}

/** What to do now, for the acting player. */
export function promptText(p: Prompt, deck: Deck): string {
  const r = (role: RoleId) => deck.name(role);
  switch (p.stage) {
    case 'copy':
      return 'Tap another player to look at their card and become that role.';
    case 'shield':
      return 'Tap another player to put a shield on their card, or skip.';
    case 'give-wolf':
      return 'Tap a player who isn’t a werewolf: they get the centre werewolf card.';
    case 'view':
      if (p.players && p.center) return 'Tap one player, or two centre cards, to look at them.';
      if (p.center) return 'Tap a centre card to look at it.';
      return p.as === 'paranormal-investigator'
        ? 'Tap a player to look at their card.'
        : 'Tap another player to look at their card.';
    case 'view-again':
      return 'That card is village: you may look at one more.';
    case 'rob':
      return 'Tap a player to swap cards with them, or skip.';
    case 'swap':
      return p.as === 'witch'
        ? 'Now give that centre card to a player (you may choose yourself).'
        : 'Tap two other players to swap their cards, or skip.';
    case 'move-all':
      return 'Move everyone else’s card one seat to the left or to the right, or skip.';
    case 'tap':
      return 'Tap the neighbour on your left or your right, or skip.';
    case 'take':
      return 'Tap a centre card to swap with yours. You won’t see it.';
    case 'reveal':
      return 'Tap another player to turn their card face up, or skip.';
    case 'place':
      return 'Tap a player to place an artifact on their card, or skip.';
    case 'lone-wolf':
      return 'You are the only werewolf: you may look at one centre card.';
    case 'view-thumbs':
      return `You may look at the cards of the players who showed a thumb (${r(p.as)}).`;
    default:
      return 'Make your choice.';
  }
}

export const winText = (role: RoleId) => ROLES[role].win;
