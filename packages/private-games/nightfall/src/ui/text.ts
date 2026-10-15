import { FRAME_LINES } from '../logic/plan.ts';
import {
  type HostileGroup,
  type MarkId,
  ROLES,
  type RoleId,
  hostileGroupsIn,
  isRoleId,
} from '../logic/roles.ts';
import type {
  FinalIdentity,
  NightfallView,
  NoteBody,
  Prompt,
  Slot,
  TeamResultId,
  TimelineEntry,
  VoteResult,
} from '../logic/types.ts';
import type { Deck } from './assets.ts';
import {
  type Numbered,
  announcementText,
  nostraTeamWords,
  oracleAbout,
  oracleQuestion,
  oracleReply,
  pickAbout,
  toldText,
} from './alienText.ts';
import type { CuePart } from '../logic/narration.ts';

/** No player numbers known: the narrator's numbers stand alone. */
const NO_NUMBERS: Numbered = { name: () => null };

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
  alien: 'Aliens',
  synthetic: 'Synthetic Alien',
  blob: 'Blob',
  mortician: 'Mortician',
  groob: 'Groob',
  zerb: 'Zerb',
  leader: 'Leader',
  nostradamus: 'Nostradamus',
};

/** "Village wins", "Werewolves win": the verb agrees with the team's label. */
export function teamOutcome(team: TeamResultId, won: boolean): string {
  const plural = team === 'werewolf' || team === 'vampire' || team === 'alien';
  return `${TEAM_LABEL[team]} ${won ? (plural ? 'win' : 'wins') : plural ? 'lose' : 'loses'}`;
}

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
  oracle: 'answer the narrator’s question.',
  leader: 'aliens, show a thumb.',
  psychic: 'look at the cards the narrator names.',
  rascal: 'move cards the way the narrator says.',
  exposer: 'turn centre cards face up, as many as the narrator says.',
  mortician: 'look at cards the way the narrator says.',
  'body-snatcher': 'take a card the way the narrator says: it becomes an Alien card.',
  empath: 'watch the players the narrator names point.',
  nostradamus:
    'you may look at up to three cards, one at a time; stop at one that isn’t village. The last card you see is your team.',
};

const sentence = (s: string | undefined) => (s ? s[0]!.toUpperCase() + s.slice(1) : '');

const SIDE_WORDS: Record<HostileGroup, string> = {
  werewolf: 'werewolves',
  vampire: 'vampires',
  alien: 'aliens',
};

/** "Werewolves and aliens tonight: …": the evil sides the selected cards can bring. */
function epicBattleText(roles: readonly RoleId[]): string {
  const sides = hostileGroupsIn(roles);
  return sides.length >= 2
    ? `${sentence(listNames(sides.map((g) => SIDE_WORDS[g])))} tonight: prepare for an epic battle!`
    : 'Prepare for an epic battle!';
}

/**
 * The words for a narration line key, in our own neutral text with the cards' names. `roles`
 * are the selected cards, for the lines that depend on them (the epic battle names its sides).
 */
export function lineText(key: string, deck: Deck, roles: readonly RoleId[] = []): string {
  const n = (r: RoleId) => deck.name(r).toUpperCase();
  switch (key) {
    case FRAME_LINES.nightStart:
      return 'Everyone, close your eyes.';
    case FRAME_LINES.nightEnd:
      return 'Everyone, keep your eyes closed and touch your card.';
    case FRAME_LINES.nightEndMarks:
      return 'Everyone, keep your eyes closed and touch your card and your Mark.';
    case FRAME_LINES.epicBattle:
      return epicBattleText(roles);
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
    case 'alien:wake':
      return 'ALIENS, wake up and look around for the other aliens.';
    case 'alien:close':
      return 'ALIENS, close your eyes.';
    case 'cow:wake':
      return `${n('cow')}, put out your fist. If an alien sits right next to you, one of them must tap it.`;
    case 'doppelganger:cow:wake':
      return `${n('doppelganger')}, if you copied the ${deck.name('cow')}, put out your fist too.`;
    case 'cow:close':
      return `${n('cow')}, put your fist away.`;
    case 'doppelganger:cow:close':
      return `${n('doppelganger')}, put your fist away.`;
    case 'groob-zerb:wake':
      return `${n('groob')} and ${n('zerb')}, wake up and look at each other.`;
    case 'groob-zerb:close':
      return `${n('groob')} and ${n('zerb')}, close your eyes.`;
    case 'leader:groob-zerb':
    case 'doppelganger:leader:groob-zerb':
      return `${n('groob')} and ${n('zerb')}, if you saw each other, show a thumb. ${key.startsWith('doppelganger') ? n('doppelganger') : n('leader')}, if you see them both, you win only if both of them live.`;
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
  alien: 'The aliens',
  'groob-zerb': 'Groob and Zerb',
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
  opts: { awake: boolean; readyEarly?: boolean; roles?: readonly RoleId[] },
): string {
  if (key === FRAME_LINES.vote)
    return opts.readyEarly ? 'Everyone’s ready. Three, two, one… vote!' : lineText(key, deck);
  if (opts.awake) return lineText(key, deck, opts.roles);
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
      return lineText(key, deck, opts.roles);
    case 'dusk:wake':
      return 'Everyone is awake, looking at their own Mark.';
    case 'werewolf:lone-wolf':
      return 'A lone werewolf may look at a centre card.';
    case 'renfield:hands-away':
      return 'The vampires put their hands away.';
    case 'assassin:close:with-apprentice':
      return `The ${deck.name('assassin')} and the ${deck.name('apprentice-assassin')} go back to sleep.`;
    case 'cow:wake':
    case 'doppelganger:cow:wake':
      return `The ${deck.name('cow')} puts out a fist.`;
    case 'cow:close':
    case 'doppelganger:cow:close':
      return 'Fists away.';
    case 'leader:groob-zerb':
    case 'doppelganger:leader:groob-zerb':
      return `${deck.name('groob')} and ${deck.name('zerb')} show a thumb, if they saw each other.`;
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

/**
 * The words for a piece of narration on a screen: a line as `narrationText` words it, a step's
 * instruction in the third person (unless `told`: the viewer's own box already shows it), and an
 * announcement as everyone hears it.
 */
export function partText(
  part: CuePart,
  deck: Deck,
  opts: {
    awake: boolean;
    at: Numbered;
    told?: boolean;
    readyEarly?: boolean;
    roles?: readonly RoleId[];
  },
): string {
  switch (part.kind) {
    case 'line':
      return narrationText(part.key, deck, opts);
    case 'pick':
      return opts.told ? '' : pickAbout(part.pick, opts.at, deck, { doppel: part.doppel });
    case 'announcement':
      return announcementText(part.announcement, opts.at, deck);
  }
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
  at: Numbered = NO_NUMBERS,
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
        aliens: ['Your fellow aliens', 'No other alien woke up.'],
        'groob-zerb': [`Awake with you`, `Nobody else woke: your rival isn’t among the players.`],
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
        aliens: 'The aliens’ thumbs',
        'groob-zerb': `${r('groob')} and ${r('zerb')}, who saw each other`,
        cow: `The ${r('cow')}’s fist`,
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
        : note.role === 'robber'
          ? 'There was no one to rob: every other card is shielded.'
          : 'There was nobody you could choose.';
    case 'feared':
      return `You held the ${deck.markName('fear')}, so you slept through your turn as the ${r(note.role)}.`;
    case 'passed':
      return 'You did nothing.';
    case 'artifact':
      return `There is an artifact on your card: ${deck.artifactName(note.artifact)}. ${deck.artifactText(note.artifact)}`;
    case 'marked': {
      const to = note.targets.map((t) => (t === me ? 'yourself' : nameOf(t)));
      const chose = note.chosenBy ? `${nameOf(note.chosenBy)} chose for you all: ` : '';
      const you = chose ? 'you' : 'You';
      return `${chose}${you} gave the ${deck.markName(note.mark)} to ${listNames(to)}.`;
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
    case 'told':
      return `The narrator told you: ${toldText(note.pick, at, deck, { empath: note.watching === true })}`;
    case 'tipped':
      return note.tipped
        ? 'An alien tapped your fist: one of your neighbours is an alien.'
        : 'Nobody tapped your fist: no alien woke up right next to you.';
    case 'fist':
      return !note.tapped
        ? 'Nobody tapped your fist.'
        : note.helper
          ? 'The aliens tapped your fist: you play for them now, though you aren’t an alien.'
          : 'The aliens tapped your fist: you are an alien now, whatever your card.';
    case 'recruited': {
      const chose = note.chosenBy ? `${nameOf(note.chosenBy)} chose for you all: ` : '';
      return `${chose}${chose ? 'you' : 'You'} tapped ${nameOf(note.target)}’s fist: ${note.helper ? 'they play for the aliens now' : 'they are an alien now'}.`;
    }
    case 'passed-card':
      return note.to
        ? `You gave your card to ${nameOf(note.to)}, the next alien to your ${note.side}, without looking.`
        : 'No other alien’s card could move: you kept yours.';
    case 'snatched':
      return `You took ${slotName(note.slot, nameOf, kinds, me)}: ${r(note.role)}. It is an Alien card now, and so are you.`;
    case 'took':
      return `You swapped your card with ${slotName(note.slot, nameOf, kinds, me)} and looked: you are now the ${r(note.role)}.`;
    case 'gave':
      return `You gave ${slotName(note.from, nameOf, kinds, me)} to ${note.to === me ? 'yourself' : nameOf(note.to)}.`;
    case 'exposed':
      return `You turned ${centreName(note.center, kinds)} face up: ${r(note.role)}. Everyone will see it.`;
    case 'pointed':
      return note.target ? `You pointed at ${nameOf(note.target)}.` : 'You pointed at nobody.';
    case 'saw-point':
      return `${nameOf(note.from)} pointed at ${note.target === me ? 'you' : note.target ? nameOf(note.target) : 'nobody'}.`;
    case 'foretold':
      return `Your last look puts you on the side of ${nostraTeamWords(note.team, deck)}; everyone heard it.`;
    case 'oracle':
      return `${oracleQuestion(note.question)} You answered ${note.answer}. ${oracleReply(note.outcome, deck)}`;
    case 'pretended':
      return 'You only pretended to look.';
    case 'watched': {
      const touched = note.touched.map((sl) => slotName(sl, nameOf, kinds, me));
      return note.awake.length
        ? `Eyes open: ${who(note.awake)} woke${touched.length ? `, and touched ${listNames(touched)}` : ''}${note.marks.length ? `; Marks moved: ${who(note.marks)}` : ''}.`
        : 'Eyes open: nobody woke for that call.';
    }
    case 'shuffled':
      return `You and ${nameOf(note.with)} showed each other your cards: yours, ${r(note.mine)}; theirs, ${r(note.theirs)}. Then they were shuffled between you.`;
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
  at: Numbered = NO_NUMBERS,
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
        aliens: [`${by} saw the other aliens`, `${by} was the only alien awake.`],
        'groob-zerb': [`${by} saw`, `${by} saw no rival awake.`],
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
        aliens: 'the aliens’ thumbs',
        'groob-zerb': `${r('groob')} and ${r('zerb')}’s thumbs`,
        cow: `the ${r('cow')}’s fist`,
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
        : note.role === 'robber'
          ? `${by} had no one to rob.`
          : `${by} had nobody to choose.`;
    case 'feared':
      return `${by} held the ${deck.markName('fear')}, and slept through their turn.`;
    case 'passed':
      return `${by} did nothing.`;
    case 'artifact':
      return `${by}’s card carried an artifact: ${deck.artifactName(note.artifact)}.`;
    case 'marked':
      return `${by} gave the ${deck.markName(note.mark)} to ${list(note.targets)}${note.chosenBy ? ` (${nameOf(note.chosenBy)}’s pick)` : ''}.`;
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
    case 'told':
      return `${by} was told: ${toldText(note.pick, at, deck)}`;
    case 'tipped':
      return note.tipped ? `${by}’s fist was tapped by an alien.` : `Nobody tapped ${by}’s fist.`;
    case 'fist':
      return note.tapped
        ? `${by}’s fist was tapped: ${note.helper ? 'they joined the aliens’ side' : 'they became an alien'}.`
        : `${by} put out a fist; nobody tapped it.`;
    case 'recruited':
      return `${by} tapped ${nameOf(note.target)}’s fist${note.helper ? ', making them an alien helper' : ', making them an alien'}${note.chosenBy ? ` (${nameOf(note.chosenBy)}’s pick)` : ''}.`;
    case 'passed-card':
      return note.to ? `${by} passed their card to ${nameOf(note.to)}.` : `${by} kept their card.`;
    case 'snatched':
      return `${by} took ${slot(note.slot)}: ${r(note.role)}, an Alien card now.`;
    case 'took':
      return `${by} swapped with ${slot(note.slot)}, and took the ${r(note.role)}.`;
    case 'gave':
      return `${by} gave ${slot(note.from)} to ${who(note.to)}.`;
    case 'exposed':
      return `${by} turned ${centreName(note.center, kinds)} face up: ${r(note.role)}.`;
    case 'pointed':
      return note.target ? `${by} pointed at ${who(note.target)}.` : `${by} pointed at nobody.`;
    case 'saw-point':
      return `${by} saw ${nameOf(note.from)} point at ${note.target ? who(note.target) : 'nobody'}.`;
    case 'foretold':
      return `${by} was announced on the side of ${nostraTeamWords(note.team, deck)}.`;
    case 'oracle':
      return `${by}, ${oracleAbout(note.question, note.answer, note.outcome)}`;
    case 'pretended':
      return `${by} only pretended to look.`;
    case 'watched':
      return `${by} watched with eyes open: ${note.awake.length ? list(note.awake) : 'nobody'} woke.`;
    case 'shuffled':
      return `${by} and ${nameOf(note.with)} showed each other their cards (${r(note.mine)} and ${r(note.theirs)}), then shuffled them.`;
  }
}

/** A timeline entry, in the third person, for the reveal (everyone sees the same words). */
export function describeEntry(
  entry: TimelineEntry,
  nameOf: NameOf,
  deck: Deck,
  kinds?: readonly string[],
  at: Numbered = NO_NUMBERS,
): string {
  if (entry.note.kind === 'announced')
    return `Announced: ${announcementText(entry.note.announcement, at, deck)}`;
  if (entry.note.kind === 'told' && entry.by === null)
    return `The narrator said: ${toldText(entry.note.pick, at, deck, { empath: true })}`;
  if (entry.note.kind === 'nobody') {
    if (entry.stepId === 'ripple') return 'No ripple tonight.';
    if (entry.stepId === 'lovers') return 'Nobody held a Mark of Love.';
    if (entry.stepId.startsWith('doppelganger-'))
      return `Nobody woke: the ${deck.name('doppelganger')} didn’t copy this card.`;
    return 'Nobody at the table had this card.';
  }
  if (entry.note.kind === 'oracle' && entry.by === null)
    return `The narrator answered for the ${deck.name('oracle')}: “${entry.note.answer.split('>')[0]}”.`;
  const text = describeNoteAbout(entry.note, entry.by, nameOf, deck, kinds, at);
  const moved = entry.moved?.length
    ? ` (${entry.moved.map((m) => `${slotName(m.slot, nameOf, kinds)} was ${deck.name(m.role)}`).join('; ')})`
    : '';
  // Marks moved: who held what just before. A Mark given replaces the one there, which goes
  // back unseen: name it, unless it was the plain Mark of Clarity everyone starts with.
  const before =
    entry.note.kind === 'marked'
      ? (entry.marks ?? []).filter((m) => m.mark && m.mark !== 'clarity')
      : (entry.marks ?? []);
  const marks = before.length
    ? ` (${before.map((m) => `${nameOf(m.player)} had ${m.mark ? `the ${deck.markName(m.mark)}` : 'no Mark'}`).join('; ')})`
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
    case 'give-wolf-any':
      return `Tap any other player but the ${r('alpha-wolf')} (a werewolf will do): they get the centre werewolf card.`;
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
      return 'Together, choose a player who isn’t a vampire: they get the Mark of the Vampire. The others see who you tap; the first to confirm decides for you all.';
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
    case 'alien-view':
      return 'Tap a player to look at their card, or skip.';
    case 'alien-all-view':
      return 'Together, choose one card to look at: the first of you to confirm decides for you all.';
    case 'new-alien':
      return 'Tap a fist: that player becomes an alien. The first of you to confirm decides.';
    case 'alien-helper':
      return 'Tap a fist: that player joins your side. The first of you to confirm decides.';
    case 'snatch':
      return 'Tap a player who isn’t an alien to take their card.';
    case 'snatch-centre':
      return 'Tap a centre card to take it.';
    case 'psychic':
      return p.players && p.players.max > 1
        ? `Tap up to ${p.players.max} players to look at their cards, or skip.`
        : 'Tap a player to look at their card, or skip.';
    case 'rascal-swap':
      return 'Tap two players to swap their cards, or skip.';
    case 'rascal-view':
      return p.center
        ? 'Tap a centre card to look at it, or skip.'
        : 'Tap a player to look at their card, or skip.';
    case 'rascal-give':
    case 'ripple-give':
      return 'Now give that card to a player.';
    case 'rascal-rob':
    case 'ripple-steal':
      return p.center
        ? 'Tap a centre card to swap with yours and look at it, or skip.'
        : 'Tap a player to swap cards with them and look at your new card, or skip.';
    case 'rascal-drunk':
    case 'ripple-drunk':
      return p.center
        ? 'Tap a centre card to swap with yours. You won’t see it.'
        : 'Tap a player to swap cards with them. You won’t see your new card.';
    case 'expose':
      return `Tap exactly ${p.center?.min ?? 1} centre card${(p.center?.min ?? 1) > 1 ? 's' : ''} to turn face up, or skip.`;
    case 'mortician':
      return p.players && p.players.max > 1
        ? 'Tap your neighbours to look at their cards, or skip.'
        : 'Tap the card to look at it, or skip.';
    case 'point':
      return 'Keep your eyes closed and point: tap a player, or point at nobody.';
    case 'foresee':
      return 'Tap a player to look at their card. If it isn’t village, you stop: that card’s team is yours.';
    case 'foresee-again':
      return 'That card is village: you may look at another (three at most), or stop.';
    case 'oracle':
      return 'Answer the question:';
    case 'view-center':
      return `You may look at up to ${p.center?.max ?? 1} centre card${(p.center?.max ?? 1) > 1 ? 's' : ''}.`;
    case 'ripple-view':
      return p.center
        ? 'Tap centre cards to look at them, or skip.'
        : 'Tap players to look at their cards, or skip.';
    case 'ripple-own':
      return 'Tap your own card to look at it, or skip.';
    case 'ripple-swap':
      return 'Tap both players to swap their cards, or skip.';
    case 'ripple-witch':
      return 'Tap a centre card to look at it, or skip.';
    case 'ripple-reveal':
      return 'Tap the card to turn it face up, or skip.';
    default:
      return 'Make your choice.';
  }
}

export const winText = (role: RoleId) => ROLES[role].win;

/**
 * Each player's Marks through the night, oldest first, from the timeline: every entry that
 * gives or moves a Mark records who held what just before, and `final` is what they hold now.
 * Only players whose Mark changed are listed.
 */
export function markHistory(
  timeline: readonly TimelineEntry[],
  final: Record<string, { id: MarkId } | undefined> | null,
): Record<string, MarkId[]> {
  if (!final) return {};
  const seen: Record<string, (MarkId | null)[]> = {};
  for (const e of [...timeline].sort((a, b) => a.step - b.step))
    for (const m of e.marks ?? []) (seen[m.player] ??= []).push(m.mark);
  const out: Record<string, MarkId[]> = {};
  for (const [p, before] of Object.entries(seen)) {
    const chain: MarkId[] = [];
    for (const m of [...before, final[p]?.id ?? null]) if (m && chain.at(-1) !== m) chain.push(m);
    if (chain.length > 1) out[p] = chain;
  }
  return out;
}

/** A team's line on the reveal, with who on it really won (Disease and traitors aside). */
export interface TeamLine {
  team: TeamResultId;
  /** The side won and at least one of its players did. */
  won: boolean;
  /** The side's result before Disease and traitors. */
  sideWon: boolean;
  players: string[];
  /** On a winning side, the players who still lost; on a losing side, those who won anyway. */
  exceptions: string[];
}

export function teamLines(result: VoteResult): TeamLine[] {
  const winners = new Set(result.winners);
  return result.teams.map((t) => {
    const won = t.won && t.players.some((p) => winners.has(p));
    return {
      team: t.team,
      won,
      sideWon: t.won,
      players: t.players,
      exceptions: t.players.filter((p) => winners.has(p) !== won),
    };
  });
}

/** Nostradamus announced on a side of its own (the Synthetic Alien…) whose card nobody held. */
export const foretoldInCentre = (id: FinalIdentity) =>
  !!id.foretold && !id.foretold.holder && id.team === 'nostradamus';

/** Nostradamus's badge on the reveal: the side he was announced on, and who holds its card. */
export function foretoldBadge(id: FinalIdentity, deck: Deck, nameOf: NameOf): string {
  const f = id.foretold!;
  const side = `side of ${nostraTeamWords(f.team, deck)}`;
  if (f.holder) return `${side} (${nameOf(f.holder)})`;
  return foretoldInCentre(id) ? `${side} (card in the centre)` : side;
}
