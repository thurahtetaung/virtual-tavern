import { FRAME_LINES } from '../logic/plan.ts';
import { type MarkId, ROLES, type RoleId, isRoleId } from '../logic/roles.ts';
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

/**
 * The centre slots for these cards: three centre cards, then the centre werewolf when the Alpha
 * Wolf is in. Public: it follows from the cards the host picked.
 */
export const centreKinds = (roles: readonly RoleId[]): ('center' | 'wolf')[] => [
  'center',
  'center',
  'center',
  ...(roles.includes('alpha-wolf') ? (['wolf'] as const) : []),
];

export const TEAM_LABEL: Record<TeamResultId, string> = {
  village: 'Village',
  werewolf: 'Werewolves',
  vampire: 'Vampires',
  tanner: 'Tanner',
  assassin: 'Assassin',
  'apprentice-assassin': 'Apprentice Assassin',
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
  copycat: 'look at one of the centre cards. You are now that role: wake up when it is called.',
  'the-count': 'give the Mark of Fear to a player who isn’t a vampire.',
  renfield: 'look for the vampires and the player they point at, then take the Mark of the Bat.',
  diseased: 'give the Mark of Disease to the player on your left or your right.',
  cupid: 'you may give the Mark of Love to any two players.',
  instigator: 'you may give the Mark of the Traitor to any player.',
  priest: 'take a Mark of Clarity. You may also give one to another player.',
  assassin: 'give the Mark of the Assassin to any player.',
  'apprentice-assassin': 'if no Assassin is awake, give the Mark of the Assassin to any player.',
  marksman: 'you may look at one player’s Mark and another player’s card.',
  pickpocket: 'you may swap your Mark with another player’s, then look at your new Mark.',
  gremlin: 'you may swap the Marks, or the cards, of any two players.',
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
    case FRAME_LINES.nightEndMarks:
      return 'Everyone, keep your eyes closed and touch your card and your Mark.';
    case FRAME_LINES.epicBattle:
      return 'Werewolves and vampires tonight: prepare for an epic battle!';
    case 'vampire:wake':
      return 'VAMPIRES, wake up and look for each other. Give the Mark of the Vampire to a player who isn’t one.';
    case 'vampire:close':
      return 'VAMPIRES, close your eyes.';
    case 'vampire:close:renfield':
      return 'VAMPIRES, point at the player with the Mark of the Vampire, and close your eyes.';
    case 'renfield:hands-away':
      return 'VAMPIRES, put your hands away.';
    case 'assassin:close:with-apprentice':
      return `${deck.name('assassin').toUpperCase()} and ${deck.name('apprentice-assassin').toUpperCase()}, close your eyes.`;
    case 'apprentice-assassin:wake:with-assassin':
      return `${deck.name('apprentice-assassin').toUpperCase()}, wake up and look for the ${deck.name('assassin')}. If there is none, give the Mark of the Assassin to any player.`;
    case 'doppelganger:apprentice-assassin:wake:with-assassin':
      return `${deck.name('doppelganger').toUpperCase()}, if you copied the ${deck.name('apprentice-assassin')}, wake up and look for the ${deck.name('assassin')}. If there is none, give the Mark of the Assassin to any player.`;
    case 'dusk:wake':
      return 'EVERYONE, wake up and secretly look at your Mark.';
    case 'dusk:close':
      return 'Everyone, close your eyes.';
    case 'lovers:wake':
      return 'If you are in love, wake up and look for your love.';
    case 'lovers:close':
      return 'LOVERS, close your eyes.';
    case 'aura-seer:wake:marks':
      return `${deck.name('aura-seer').toUpperCase()}, wake up. Anyone who has moved or looked at a card or a Mark, show your thumb.`;
    case 'doppelganger:aura-seer:wake:marks':
      return `${deck.name('doppelganger').toUpperCase()}, if you copied the ${deck.name('aura-seer')}, wake up. Anyone who has moved or looked at a card or a Mark, show your thumb.`;
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

/** Groups the narrator calls together, for the third-person lines. */
const GROUP_SUBJECT: Record<string, string> = {
  werewolf: 'The werewolves',
  vampire: 'The vampires',
  lovers: 'The lovers',
  dusk: 'Everyone',
};

/**
 * The narration as text for a screen. The narrator's own words speak to the players who are
 * awake, so only a player woken in this step reads them; everyone else reads who is awake, in
 * the third person ("The Seer is awake."). When the vote opens because everyone was ready, it
 * doesn't say time ran out.
 */
export function narrationText(
  key: string,
  deck: Deck,
  opts: { awake: boolean; readyEarly?: boolean },
): string {
  if (key === FRAME_LINES.vote)
    return opts.readyEarly ? 'Everyone’s ready. Three, two, one… vote!' : lineText(key, deck);
  if (opts.awake) return lineText(key, deck);
  switch (key) {
    case FRAME_LINES.nightStart:
    case 'dusk:close':
      return 'Everyone closes their eyes.';
    case FRAME_LINES.nightEnd:
    case FRAME_LINES.nightEndMarks:
      return 'The night is ending.';
    case FRAME_LINES.dayStart:
      return 'Everyone wakes up!';
    case FRAME_LINES.epicBattle:
    case FRAME_LINES.oneMinute:
    case FRAME_LINES.thirtySeconds:
      return lineText(key, deck);
    case 'dusk:wake':
      return 'Everyone is awake, looking at their own Mark.';
    case 'werewolf:lone-wolf':
      return 'A lone werewolf may look at a centre card.';
    case 'renfield:hands-away':
      return 'The vampires put their hands away.';
    case 'assassin:close:with-apprentice':
      return `The ${deck.name('assassin')} and the ${deck.name('apprentice-assassin')} go back to sleep.`;
  }
  const parts = key.split(':');
  if (parts.includes('thumbs-away')) return 'Thumbs away.';
  let subject = GROUP_SUBJECT[parts[0]!];
  let plural = subject !== undefined && subject !== 'Everyone';
  if (!subject && parts[0] === 'doppelganger' && parts[1] && isRoleId(parts[1])) {
    subject = `The ${deck.name('doppelganger')} (if she copied the ${deck.name(parts[1])})`;
    plural = false;
  } else if (!subject && isRoleId(parts[0]!)) {
    subject = `The ${deck.name(parts[0])}`;
  }
  if (!subject) return '';
  if (parts.includes('close')) return `${subject} ${plural ? 'go' : 'goes'} back to sleep.`;
  return `${subject} ${plural ? 'are' : 'is'} awake.`;
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
      return note.blind
        ? `You looked at ${nameOf(note.target)}’s card: ${r(note.role)}. You are now whatever it copied, without knowing what, and won’t wake for it.`
        : `You looked at ${nameOf(note.target)}’s card: ${r(note.role)}. You are now the ${r(note.role)}.`;
    case 'copied-centre':
      return `You looked at ${centreName(note.center, kinds)}: ${r(note.role)}. You are now the ${r(note.role)}.`;
    case 'saw':
      return `You saw ${slotName(note.slot, nameOf, kinds, me)}: ${r(note.role)}.`;
    case 'saw-own':
      return `Your card is now: ${r(note.role)}.`;
    case 'group': {
      const others = note.players.filter((p) => p !== me);
      const GROUP: Record<typeof note.group, [string, string]> = {
        werewolves: ['Your fellow werewolves', 'No other werewolf woke up.'],
        masons: ['The other Masons', 'No other Mason woke up.'],
        vampires: ['Your fellow vampires', 'No other vampire woke up.'],
        lovers: ['Your love', 'Nobody else is in love: the Mark of Love does nothing.'],
        assassins: [`The ${r('assassin')}`, `No ${r('assassin')} woke up.`],
        apprentices: [`The ${r('apprentice-assassin')}`, `No ${r('apprentice-assassin')} woke up.`],
      };
      const [some, none] = GROUP[note.group];
      const base = others.length ? `${some}: ${who(others)}.` : none;
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
    case 'marked': {
      const to = note.targets.map((t) => (t === me ? 'yourself' : nameOf(t)));
      return `You gave the ${deck.markName(note.mark)} to ${listNames(to)}.`;
    }
    case 'saw-vampires': {
      const vampires = note.players.length ? who(note.players) : 'nobody';
      const pointed = note.target
        ? ` They point at ${note.target === me ? 'you' : nameOf(note.target)}.`
        : '';
      return `You took the ${deck.markName('bat')}. The vampires: ${vampires}.${pointed}`;
    }
    case 'mark':
      return `Your Mark: ${deck.markName(note.mark)}${note.doppel ? ' (the Doppelgänger’s)' : ''}.`;
    case 'saw-mark':
      return `You saw ${nameOf(note.target)}’s Mark: ${deck.markName(note.mark)}.`;
    case 'pickpocketed':
      return `You swapped Marks with ${nameOf(note.target)}. Your Mark is now: ${deck.markName(note.mark)}.`;
    case 'swapped-marks':
      return `You swapped the Marks of ${note.a === me ? 'yourself' : nameOf(note.a)} and ${note.b === me ? 'yourself' : nameOf(note.b)}.`;
  }
}

/** The Marks a note names, so they can be tapped. */
export function marksIn(n: NoteBody): MarkId[] {
  switch (n.kind) {
    case 'marked':
    case 'mark':
    case 'saw-mark':
    case 'pickpocketed':
      return [n.mark];
    case 'saw-vampires':
      return ['bat'];
    default:
      return [];
  }
}

/** A note, in the third person, about the player `by` it belongs to (for the replay). */
export function describeNoteAbout(
  note: NoteBody,
  byId: string | null,
  nameOf: NameOf,
  deck: Deck,
  kinds?: readonly string[],
): string {
  const r = (role: RoleId) => deck.name(role);
  const by = nameOf(byId);
  const who = (id: string) => (id === byId ? 'themselves' : nameOf(id));
  const list = (ids: readonly string[]) => listNames(ids.map(who));
  const slot = (s: Slot) =>
    'player' in s
      ? s.player === byId
        ? `${by}’s own card`
        : `${nameOf(s.player)}’s card`
      : centreName(s.center, kinds);
  switch (note.kind) {
    case 'copied':
      return note.blind
        ? `${by} looked at ${nameOf(note.target)}’s card: ${r(note.role)}. ${by} became whatever it copied, without knowing what.`
        : `${by} looked at ${nameOf(note.target)}’s card: ${r(note.role)}, and became the ${r(note.role)}.`;
    case 'copied-centre':
      return `${by} looked at ${centreName(note.center, kinds)}: ${r(note.role)}, and became the ${r(note.role)}.`;
    case 'saw':
      return `${by} saw ${slot(note.slot)}: ${r(note.role)}.`;
    case 'saw-own':
      return `${by} looked at their own card: ${r(note.role)}.`;
    case 'group': {
      const others = note.players.filter((p) => p !== byId);
      const GROUP: Record<typeof note.group, [string, string]> = {
        werewolves: [`${by} saw the other werewolves`, `${by} was the only werewolf awake.`],
        masons: [`${by} saw the other Masons`, `${by} was the only Mason awake.`],
        vampires: [`${by} saw the other vampires`, `${by} was the only vampire awake.`],
        lovers: [
          `${by} saw their love`,
          `${by} was the only one in love: the Mark of Love did nothing.`,
        ],
        assassins: [`${by} saw the ${r('assassin')}`, `${by} saw no ${r('assassin')} awake.`],
        apprentices: [
          `${by} saw the ${r('apprentice-assassin')}`,
          `${by} saw no ${r('apprentice-assassin')} awake.`,
        ],
      };
      const [some, none] = GROUP[note.group];
      const base = others.length ? `${some}: ${list(others)}.` : none;
      const thumbs = note.thumbs?.filter((p) => p !== byId) ?? [];
      return thumbs.length ? `${base} Showing a werewolf thumb: ${list(thumbs)}.` : base;
    }
    case 'thumbs': {
      const of = {
        werewolves: 'the werewolves’ thumbs',
        tanner: 'the Tanner’s thumb',
        seers: 'the seers’ thumbs',
        touched: 'who had looked at or moved a card',
      }[note.of];
      return `${by} saw ${of}: ${note.players.length ? list(note.players) : 'nobody'}.`;
    }
    case 'robbed':
      return `${by} swapped cards with ${nameOf(note.target)}, and took the ${r(note.role)}.`;
    case 'swapped':
      return `${by} swapped ${slot(note.a)} and ${slot(note.b)}.`;
    case 'took-center':
      return `${by} swapped their card with ${centreName(note.center, kinds)}, without looking.`;
    case 'witched':
      return `${by} gave ${centreName(note.center, kinds)} to ${who(note.target)}.`;
    case 'shielded':
      return `${by} put a shield on ${nameOf(note.target)}’s card.`;
    case 'tapped':
      return `${by} tapped ${nameOf(note.target)} on the shoulder.`;
    case 'was-tapped':
      return `${by} was tapped on the ${note.side} shoulder.`;
    case 'moved-all':
      return `${by} moved everyone else’s card one seat to the ${note.side}.`;
    case 'revealed':
      return note.stayed
        ? `${by} turned ${nameOf(note.target)}’s card face up: ${r(note.role)}. It stayed up.`
        : `${by} turned ${nameOf(note.target)}’s card: ${r(note.role)}. It went back face down.`;
    case 'artifact-placed':
      return `${by} placed an artifact on ${note.target === byId ? 'their own' : `${nameOf(note.target)}’s`} card.`;
    case 'became':
      return `${by} stopped, and became the ${r(note.role)}.`;
    case 'blocked':
      return note.reason === 'shielded'
        ? `${by}’s card was shielded, so they couldn’t act.`
        : `${by} had nobody to choose.`;
    case 'passed':
      return `${by} did nothing.`;
    case 'artifact':
      return `${by}’s card carried an artifact: ${deck.artifactName(note.artifact)}.`;
    case 'marked':
      return `${by} gave the ${deck.markName(note.mark)} to ${list(note.targets)}.`;
    case 'saw-vampires': {
      const vampires = note.players.length ? list(note.players) : 'nobody';
      const pointed = note.target ? ` They pointed at ${who(note.target)}.` : '';
      return `${by} took the ${deck.markName('bat')}. The vampires: ${vampires}.${pointed}`;
    }
    case 'mark':
      return `${by}’s Mark: ${deck.markName(note.mark)}${note.doppel ? ' (the Doppelgänger’s)' : ''}.`;
    case 'saw-mark':
      return `${by} saw ${nameOf(note.target)}’s Mark: ${deck.markName(note.mark)}.`;
    case 'pickpocketed':
      return `${by} swapped Marks with ${nameOf(note.target)}, and got the ${deck.markName(note.mark)}.`;
    case 'swapped-marks':
      return `${by} swapped the Marks of ${who(note.a)} and ${who(note.b)}.`;
  }
}

/** A timeline entry, in the third person, for the reveal (everyone sees the same words). */
export function describeEntry(
  entry: TimelineEntry,
  nameOf: NameOf,
  deck: Deck,
  kinds?: readonly string[],
): string {
  if (entry.note.kind === 'nobody') return 'Nobody at the table had this card.';
  const text = describeNoteAbout(entry.note, entry.by, nameOf, deck, kinds);
  const moved = entry.moved?.length
    ? ` (${entry.moved.map((m) => `${slotName(m.slot, nameOf, kinds)} was ${deck.name(m.role)}`).join('; ')})`
    : '';
  // Marks moved: who held what just before (a Mark given replaces one that goes back unseen).
  const marks =
    entry.marks?.length && entry.note.kind !== 'marked'
      ? ` (${entry.marks.map((m) => `${nameOf(m.player)} had ${m.mark ? deck.markName(m.mark) : 'no Mark'}`).join('; ')})`
      : '';
  return `${text}${moved}${marks}${entry.auto ? ' (chosen when time ran out)' : ''}`;
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
        : p.as === 'marksman'
          ? 'Now tap another player to look at their card, or skip.'
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
    case 'copy-centre':
      return 'Tap a centre card: you become that role, and wake when it is called.';
    case 'give-vampire':
      return 'Together, choose a player who isn’t a vampire: they get the Mark of the Vampire. The first choice counts for all of you.';
    case 'give-fear':
      return 'Tap a player who isn’t a vampire to give them the Mark of Fear.';
    case 'give-disease':
      return 'Give the Mark of Disease to your left or right neighbour.';
    case 'give-love':
      return 'Tap two players (you may be one) to give them the Mark of Love, or skip.';
    case 'give-traitor':
      return 'Tap a player (you may choose yourself) to give them the Mark of the Traitor, or skip.';
    case 'give-clarity':
      return 'You took a Mark of Clarity. Tap another player to give them one too, or skip.';
    case 'give-assassin':
      return 'Tap a player (you may choose yourself) to give them the Mark of the Assassin.';
    case 'view-mark':
      return 'Tap another player to look at their Mark, or skip to look at a card.';
    case 'pickpocket':
      return 'Tap a player to swap Marks with them, or skip.';
    case 'gremlin':
      return 'Swap the Marks or the cards of two players (you may be one), or skip.';
    case 'swap-marks':
      return 'Tap two players to swap their Marks.';
    case 'swap-cards':
      return 'Tap two players to swap their cards.';
    default:
      return 'Make your choice.';
  }
}

export const winText = (role: RoleId) => ROLES[role].win;
