import type { NostraTeam, RoleId } from '../logic/roles.ts';
import type { BlobShape, PlayerSet, Ripple, StepPick, WeightTable } from '../logic/tables.ts';
import type { Announcement, NoteBody } from '../logic/types.ts';
import { type Deck, theRole } from './assets.ts';

// The Alien set's words: what the narrator tells the players it wakes, what it announces to
// everyone, and the sets of players it names. Our own words, after the narrator's meaning.

/** Names a player by number, as the narrator does, with their name when known. */
export interface Numbered {
  /** The player's name for a number (1…n), or null. */
  name: (n: number) => string | null;
}

const and = (items: readonly string[], joiner = 'and') =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`;

/** "player 3 (Cy)". */
export const playerNo = (n: number, at: Numbered) => {
  const name = at.name(n);
  return name ? `player ${n} (${name})` : `player ${n}`;
};

/** "players 2 (Ben), 5 (Eve) or 7 (Gus)". */
const numbers = (ns: readonly number[], at: Numbered, joiner: 'and' | 'or') =>
  `players ${and(
    ns.map((n) => {
      const name = at.name(n);
      return name ? `${n} (${name})` : String(n);
    }),
    joiner,
  )}`;

/** A set of players to pick from, as the end of a sentence ("any even-numbered player"). */
export function setWords(set: PlayerSet | undefined, at: Numbered, plural = false): string {
  if (!set) return 'any player';
  switch (set.kind) {
    case 'everyone':
      return 'everyone';
    case 'any':
      return plural ? 'any two other players' : 'any other player';
    case 'even':
      return 'any even-numbered player';
    case 'odd':
      return 'any odd-numbered player';
    case 'numbers':
      return numbers(set.numbers, at, 'or');
    case 'center':
      return 'the centre';
    case 'neighbours':
      return 'one of your neighbours';
    case 'both-neighbours':
      return 'both your neighbours';
    case 'left':
      return 'your left neighbour';
    case 'right':
      return 'your right neighbour';
    case 'yourself':
      return 'yourself';
    case 'higher':
      return 'any two players with a higher number than yours';
    case 'lower':
      return 'any two players with a lower number than yours';
    case 'two-left':
      return 'the two players right after you, to your left';
    case 'two-right':
      return 'the two players right before you, to your right';
  }
}

/** The card a swap takes, from a set ("the card of any other player", "a centre card"). */
export const cardOf = (set: PlayerSet | undefined, at: Numbered) =>
  set?.kind === 'center'
    ? 'a centre card'
    : set?.kind === 'yourself'
      ? 'your own card'
      : `the card of ${setWords(set, at)}`;

/** Who the narrator names to do something ("The even-numbered players", "Players 1, 4 and 8"). */
export function whoWords(set: PlayerSet, at: Numbered): string {
  switch (set.kind) {
    case 'everyone':
      return 'Everyone';
    case 'even':
      return 'The even-numbered players';
    case 'odd':
      return 'The odd-numbered players';
    case 'numbers': {
      const s = numbers(set.numbers, at, 'and');
      return s[0]!.toUpperCase() + s.slice(1);
    }
    default:
      return 'Everyone';
  }
}

const EMPATH: Record<string, string> = {
  think: 'the player you think is the Empath',
  goodlooking: 'the best-looking player',
  suspicious: 'the most suspicious player',
  smells: 'a player who smells really nice',
  sharp: 'the sharpest dresser',
  awesome: 'the player who is simply awesome',
  everyoneelse: 'whoever you think everyone else is pointing at',
  smartest: 'the smartest player',
  friendliest: 'the friendliest player',
  funniest: 'the funniest player',
  winner: 'a player who will win this game',
  like: 'a player you really, really like',
  dontthink: 'a player you think nobody else will point at',
  nicest: 'the nicest player',
};

const ORACLE_QUESTION: Record<string, string> = {
  'werewolf-team': 'Would you like to join the werewolves?',
  'vampire-team': 'Would you like to join the vampires?',
  'alien-team': 'Would you like to join the aliens?',
  'alien-exchange': 'Would you like to make the aliens swap their cards tonight?',
  'view-center': 'Would you like to look at all three centre cards?',
  'center-exchange': 'Would you like to swap your card with a centre card?',
  ripple: 'Would you like to make sure there is a ripple at the end of the night?',
  'even-odd': 'Is your player number even or odd?',
  'view-player': 'Whose card would you like to look at? Pick a player number.',
  number: 'What number am I thinking of, from 1 to 12?',
};

export const oracleQuestion = (q: string) => ORACLE_QUESTION[q] ?? 'Answer the question.';

/** The narrator's reply to the Oracle, in our own words. */
export function oracleReply(outcome: string, deck: Deck): string {
  const [what, how] = outcome.split(':');
  switch (outcome) {
    case 'werewolf-team:yes':
      return 'Your card is now a werewolf card: you play for the werewolves (but you don’t wake with them).';
    case 'vampire-team:yes':
      return 'Your card is now a vampire card: you play for the vampires (but you don’t wake with them).';
    case 'alien-team:yes':
      return 'Your card is now an alien card: you play for the aliens (but you don’t wake with them).';
    case 'alien-team:yes-helper':
      return 'You want the aliens to win: now you win only if they do, though you aren’t one.';
    case 'team:no':
      return 'Good for you: you stay with the village.';
    case 'alien-exchange:yes':
      return 'When the aliens wake, they will have to swap their cards.';
    case 'alien-exchange:no':
      return 'The aliens keep their cards.';
    case 'view-center:no':
    case 'ripple:no':
      return 'No? Fair enough.';
    case 'center-exchange:yes':
      return 'Go ahead: swap your card with a centre card (without looking).';
    case 'center-exchange:denied':
      return `What’s wrong with being the ${deck.name('oracle')}? Keep your card.`;
    case 'center-exchange:no':
      return 'Good for you: keep your card.';
    case 'ripple:yes':
      return 'There will be a ripple at the end of the night.';
    case 'even':
    case 'odd':
      return `Everyone will hear that the ${deck.name('oracle')} has an ${outcome} number.`;
    case 'view-player:yes':
      return 'Good choice: look at that card.';
    case 'view-player:other':
      return 'No, not that one: look at the card the narrator picks instead.';
    case 'number:right':
      return 'Right! You keep your eyes open for the rest of the night.';
    case 'number:wrong':
      return 'Wrong! Now everyone else wins only if you die, and you win only if you survive.';
  }
  if (what === 'view-center') {
    const n = Number(how);
    return n === 3
      ? 'All three? Go ahead.'
      : `${n === 1 ? 'Three is far too many' : 'Three is one too many'}: you may look at ${n === 1 ? 'one' : 'two'} of them.`;
  }
  return '';
}

/**
 * What the narrator told a player to do this step (the Alien set's random instructions), worded
 * after the narrator's line. `empath`: the viewer is the Empath (not one of the players pointing).
 */
export function toldText(
  pick: StepPick,
  at: Numbered,
  deck: Deck,
  opts: { empath?: boolean } = {},
): string {
  switch (pick.kind) {
    case 'alien':
      switch (pick.action) {
        case 'view':
          return `Each alien may secretly look at one card of ${setWords(pick.from, at)}.`;
        case 'all-view':
          return `All of you together may look at one card of ${setWords(pick.from, at)}.`;
        case 'stare':
          return 'Just stare at each other.';
        case 'show':
          return 'Show your cards to each other.';
        case 'timer':
          return 'You have cut the day’s timer in half.';
        case 'left':
        case 'right':
          return `Give your card to the alien on your ${pick.action}.${pick.forced ? ` (The ${deck.name('oracle')} made you swap.)` : ''}`;
        case 'new-alien':
          return `${whoWords(pick.fists!, at)}: put out a fist. Aliens, tap one fist: that player becomes an alien.`;
        case 'alien-helper':
          return `${whoWords(pick.fists!, at)}: put out a fist. Aliens, tap one fist: that player joins your side, but isn’t an alien.`;
      }
      return '';
    case 'oracle':
      return oracleQuestion(pick.question);
    case 'body-snatcher':
      if (pick.action === 'center')
        return 'Take a card from the centre and look at it: it is an Alien card now.';
      if (pick.action === 'pretend') return 'Only pretend to take someone’s card.';
      return `Take the card of a player who isn’t an alien, from ${setWords(pick.from, at)}, and look at it: it is an Alien card now.`;
    case 'psychic':
      return `You may look at ${pick.count === 2 ? 'two cards' : 'one card'} of ${setWords(pick.from, at)}.`;
    case 'rascal':
      switch (pick.action) {
        case 'troublemaker':
          return `You may swap the cards of ${setWords(pick.from, at, true)}, without looking.`;
        case 'witch':
          return `You may look at a card of ${setWords(pick.from, at)}. If you do, you must give it to any player.`;
        case 'robber':
          return `You may swap your card with ${cardOf(pick.from, at)}, then look at your new card (you won’t wake as it).`;
        case 'drunk':
          return `You must swap your card with ${cardOf(pick.from, at)}, without looking at your new card.`;
        case 'idiot':
          return 'You may move everyone else’s card one seat to the left, or one to the right.';
      }
      return '';
    case 'exposer':
      return `Turn ${pick.count === 1 ? 'one centre card' : `${pick.count === 2 ? 'two' : 'three'} centre cards`} face up: exactly that many, or none.`;
    case 'mortician':
      if (pick.action === 'pretend') return 'Only pretend to look at someone’s card.';
      if (pick.action === 'both-cards') return 'You may look at both your neighbours’ cards.';
      return `You may look at ${cardOf(pick.from, at)}.`;
    case 'empath':
      return opts.empath
        ? `${whoWords(pick.who, at)}: point, eyes closed, at ${EMPATH[pick.prompt]}. Watch where they point.`
        : `Keep your eyes closed and point at ${EMPATH[pick.prompt]} (or at nobody).`;
  }
}

/** Sentence words about someone else: "your left neighbour" → "their left neighbour". */
const theirs = (words: string) =>
  words
    .replace(/\byourself\b/g, 'themselves')
    .replace(/\byours\b/g, 'theirs')
    .replace(/\byour\b/g, 'their')
    .replace(/\byou\b/g, 'them');

/**
 * A step's random instruction as everyone hears it, in the third person: the narrator says it out
 * loud for the whole table, while only those it wakes read `toldText`. `doppel`: a Doppelgänger
 * re-wake, so she is the one told.
 */
export function pickAbout(
  pick: StepPick,
  at: Numbered,
  deck: Deck,
  opts: { doppel?: boolean } = {},
): string {
  const from = (set: PlayerSet | undefined, plural = false) => theirs(setWords(set, at, plural));
  const who = (role: RoleId) => theRole(deck, opts.doppel ? 'doppelganger' : role, true);
  switch (pick.kind) {
    case 'alien':
      switch (pick.action) {
        case 'view':
          return `Each alien may secretly look at one card of ${from(pick.from)}.`;
        case 'all-view':
          return `The aliens may look at one card of ${from(pick.from)} together.`;
        case 'stare':
          return 'The aliens just stare at each other.';
        case 'show':
          return 'The aliens show each other their cards.';
        case 'timer':
          return 'The aliens have cut the day’s timer in half.';
        case 'left':
        case 'right':
          return `Each alien gives their card to the alien on their ${pick.action}.`;
        case 'new-alien':
          return `${whoWords(pick.fists!, at)}: fists out. The aliens tap one, and that player becomes an alien.`;
        case 'alien-helper':
          return `${whoWords(pick.fists!, at)}: fists out. The aliens tap one, and that player joins their side without being an alien.`;
      }
      return '';
    case 'oracle':
      return `${who('oracle')} is asked: “${oracleQuestion(pick.question)}”`;
    case 'body-snatcher':
      if (pick.action === 'center')
        return `${who('body-snatcher')} takes a card from the centre: it is an Alien card now.`;
      if (pick.action === 'pretend')
        return `${who('body-snatcher')} only pretends to take someone’s card.`;
      return `${who('body-snatcher')} takes the card of a player who isn’t an alien, from ${from(pick.from)}: it is an Alien card now.`;
    case 'psychic':
      return `${who('psychic')} may look at ${pick.count === 2 ? 'two cards' : 'one card'} of ${from(pick.from)}.`;
    case 'rascal':
      switch (pick.action) {
        case 'troublemaker':
          return `${who('rascal')} may swap the cards of ${from(pick.from, true)}, without looking.`;
        case 'witch':
          return `${who('rascal')} may look at a card of ${from(pick.from)}, and must then give it to any player.`;
        case 'robber':
          return `${who('rascal')} may swap their card with ${theirs(cardOf(pick.from, at))}, then look at the new card.`;
        case 'drunk':
          return `${who('rascal')} must swap their card with ${theirs(cardOf(pick.from, at))}, without looking.`;
        case 'idiot':
          return `${who('rascal')} may move everyone else’s card one seat to the left, or one to the right.`;
      }
      return '';
    case 'exposer':
      return `${who('exposer')} turns ${pick.count === 1 ? 'one centre card' : `${pick.count === 2 ? 'two' : 'three'} centre cards`} face up: exactly that many, or none.`;
    case 'mortician':
      if (pick.action === 'pretend')
        return `${who('mortician')} only pretends to look at someone’s card.`;
      if (pick.action === 'both-cards')
        return `${who('mortician')} may look at both their neighbours’ cards.`;
      return `${who('mortician')} may look at ${theirs(cardOf(pick.from, at))}.`;
    case 'empath':
      return `${whoWords(pick.who, at)}: eyes closed, point at ${EMPATH[pick.prompt]!.replace(/\byou\b/g, 'they')}. ${who('empath')} watches.`;
  }
}

/** A Nostradamus team, in words. */
export function nostraTeamWords(team: NostraTeam, deck: Deck): string {
  const role = (r: RoleId) => theRole(deck, r);
  switch (team) {
    case 'village':
      return 'the village';
    case 'werewolf':
      return 'the werewolves';
    case 'vampire':
      return 'the vampires';
    case 'alien':
      return 'the aliens';
    case 'tanner':
      return role('tanner');
    case 'synthetic':
      return role('synthetic-alien');
    case 'assassin':
    case 'apprentice-assassin':
    case 'blob':
    case 'mortician':
    case 'doppelganger':
    case 'copycat':
    case 'oracle':
    case 'paranormal-investigator':
      return role(team);
  }
}

/** The Blob's members, as announced: how many on each side of the Blob. */
export function blobWords(shape: BlobShape): string {
  const n = (k: number) =>
    ['', 'one player', 'two players', 'three players', 'four players'][k] ?? `${k} players`;
  if (shape.left && shape.right)
    return `${shape.left === 1 ? 'one player' : 'two players'} on each side of the Blob`;
  return shape.left
    ? `the ${n(shape.left)} to the Blob’s left`
    : `the ${n(shape.right)} to the Blob’s right`;
}

/** A ripple, as announced to everyone. */
export function rippleText(rp: Ripple, at: Numbered, deck: Deck): string {
  const p = (n: number) => {
    const s = playerNo(n, at);
    return s[0]!.toUpperCase() + s.slice(1);
  };
  switch (rp.key) {
    case 'none':
      return '';
    case 'one-minute':
      return 'You will only have one minute before the vote.';
    case 'vote-for-app':
      return 'When it is time to vote, you may vote for the app instead of a player. If the app gets the most votes, nobody dies.';
    case 'repeat-role':
      return `${deck.name(rp.role).toUpperCase()}, do your night action again, right now, with fresh choices.`;
    case 'i-am-alien':
      return `${whoWords(rp.who, at)}: from now until the vote, you may only say “I am an alien.”`;
    case 'face-away':
      return `${whoWords(rp.who, at)}: face away from the table until after the vote.`;
    case 'two-hand-vote':
      return `${whoWords(rp.who, at)}: when it is time to vote, point with both hands; each counts as a vote.`;
    case 'no-speak':
      return `${whoWords(rp.who, at)}: you may not speak until after the vote.`;
    case 'view-1':
      return `${p(rp.actor)}, you may look at one card of ${setWords(rp.from, at)}.`;
    case 'view-2':
      return `${p(rp.actor)}, you may look at two cards of ${setWords(rp.from, at)}.`;
    case 'dual-view':
      return `${p(rp.actors[0]!)} and ${playerNo(rp.actors[1]!, at)}, you may each look at two cards of ${setWords(rp.from, at)}.`;
    case 'insomniac':
      return `${numbers(rp.actors, at, 'and').replace(/^p/, 'P')}, you may look at your own card.`;
    case 'troublemaker':
      return `${p(rp.actor)}, you may swap the cards of ${playerNo(rp.between[0]!, at)} and ${playerNo(rp.between[1]!, at)}, without looking.`;
    case 'steal':
      return `${p(rp.actor)}, you may swap your card with ${cardOf(rp.from, at)}, and look at your new card.`;
    case 'drunk':
      return `${p(rp.actor)}, you must swap your card with ${cardOf(rp.from, at)}, without looking.`;
    case 'witch':
      return `${p(rp.actor)}, you may look at a centre card. If you do, you must give it to ${setWords(rp.from, at)}.`;
    case 'reveal':
      return `${p(rp.actor)}, you may turn over ${rp.target === 'yourself' ? 'your own card' : `your ${rp.target} neighbour’s card`}: a village card stays face up, any other goes back down.`;
    case 'shuffle':
      return `${p(rp.players[0]!)} and ${playerNo(rp.players[1]!, at)}, show each other your cards; then ${playerNo(rp.giver, at)} shuffles them and you each take one back.`;
    case 'repeat-night':
      return 'You’ve entered a time loop: the whole night happens again. Some roles may not wake up.';
    case 'repeat-observer':
      return `You’ve entered a time loop: the whole night happens again. Some roles may not wake up. ${p(rp.observer)}, keep your eyes open from now on.`;
  }
}

/** Something the narrator announced to everyone. */
export function announcementText(a: Announcement, at: Numbered, deck: Deck): string {
  const oracle = deck.name('oracle');
  switch (a.kind) {
    case 'oracle-parity':
      return `The ${oracle} has an ${a.parity} player number.`;
    case 'oracle-view':
      return a.swapped
        ? `The ${oracle} may not look at the card she asked for: she looks at ${playerNo(a.number, at)}’s instead.`
        : `The ${oracle} looks at the card of ${playerNo(a.number, at)}.`;
    case 'oracle-number':
      return a.right
        ? `The ${oracle} guessed the narrator’s number: she keeps her eyes open for the rest of the night.`
        : `The ${oracle} guessed the narrator’s number wrong. Everyone else now wins only if the ${oracle} dies; the ${oracle} wins only by surviving.`;
    case 'nostradamus':
      return `${a.doppel ? `The ${deck.name('doppelganger')} (as ${deck.name('nostradamus')})` : deck.name('nostradamus')} is on the side of ${nostraTeamWords(a.team, deck)}.`;
    case 'blob':
      return `${deck.name('blob').toUpperCase()}: ${blobWords(a.shape)} ${a.shape.left + a.shape.right === 1 ? 'is' : 'are'} part of the Blob. Keep them, and yourself, alive to win.`;
    case 'ripple':
      return `A ripple in the space-time continuum! ${rippleText(a.ripple, at, deck)}`;
  }
}

/** A short title for an announcement (for lists). */
export function announcementTitle(a: Announcement, deck: Deck): string {
  switch (a.kind) {
    case 'oracle-parity':
    case 'oracle-view':
    case 'oracle-number':
      return deck.name('oracle');
    case 'nostradamus':
      return deck.name('nostradamus');
    case 'blob':
      return deck.name('blob');
    case 'ripple':
      return 'Ripple';
  }
}

/** The roles an Alien-set note names (for tappable chips). */
export function alienRolesIn(n: NoteBody): RoleId[] {
  switch (n.kind) {
    case 'snatched':
    case 'took':
    case 'exposed':
      return [n.role];
    case 'shuffled':
      return [n.mine, n.theirs];
    default:
      return [];
  }
}

// ---- The lobby's Alien options ----

/** A heading for each random table. */
export function tableTitle(t: WeightTable, deck: Deck): string {
  switch (t) {
    case 'alien':
      return 'The aliens’ instruction';
    case 'oracle':
      return `The ${deck.name('oracle')}’s question`;
    case 'ripple':
      return 'Ripples at the end of the night';
    case 'body-snatcher':
      return `The ${deck.name('body-snatcher')}`;
    case 'psychic':
      return `The ${deck.name('psychic')}`;
    case 'rascal':
      return `The ${deck.name('rascal')}`;
    case 'exposer':
      return `The ${deck.name('exposer')}`;
    case 'mortician':
      return `The ${deck.name('mortician')}`;
    case 'empath':
      return `The ${deck.name('empath')}’s question`;
  }
}

/** A short label for each entry of each table. */
export const ENTRY_LABEL: Record<WeightTable, Record<string, string>> = {
  alien: {
    view: 'Each looks at a card',
    'all-view': 'One card, together',
    stare: 'Just stare',
    show: 'Show each other',
    timer: 'Halve the day',
    left: 'Pass cards left',
    right: 'Pass cards right',
    'new-alien': 'Recruit a New Alien',
    'alien-helper': 'Recruit a helper',
  },
  oracle: {
    'werewolf-team': 'Join the werewolves?',
    'vampire-team': 'Join the vampires?',
    'alien-team': 'Join the aliens?',
    'alien-exchange': 'Make the aliens swap?',
    'view-center': 'See the centre?',
    'center-exchange': 'Swap with the centre?',
    ripple: 'Guarantee a ripple?',
    'even-odd': 'Even or odd?',
    'view-player': 'Whose card to see?',
    number: 'Guess my number',
  },
  ripple: {
    'one-minute': 'One-minute day',
    'vote-for-app': 'Vote for the app',
    'repeat-role': 'A role acts again',
    'i-am-alien': '“I am an alien”',
    'face-away': 'Face away',
    'two-hand-vote': 'Two-hand vote',
    'no-speak': 'No speaking',
    'view-1': 'Look at one card',
    'view-2': 'Look at two cards',
    'dual-view': 'Two players look',
    insomniac: 'Check own cards',
    troublemaker: 'Swap two players',
    steal: 'Rob a player',
    drunk: 'Blind swap',
    witch: 'Give a centre card',
    reveal: 'Turn a card up',
    shuffle: 'Show and shuffle',
    'repeat-night': 'Time loop',
    'repeat-observer': 'Time loop, one watching',
    none: 'No ripple',
  },
  'body-snatcher': {
    steal: 'Take a player’s card',
    center: 'Take a centre card',
    pretend: 'Only pretend',
  },
  psychic: { 'view-1': 'Look at one card', 'view-2': 'Look at two cards' },
  rascal: {
    troublemaker: 'Swap two players',
    witch: 'Look, then give',
    robber: 'Rob',
    drunk: 'Blind swap',
    idiot: 'Move everyone’s card',
  },
  exposer: { 'flip-1': 'One card', 'flip-2': 'Two cards', 'flip-3': 'Three cards' },
  mortician: {
    'one-card': 'Look at one card',
    'both-cards': 'Both neighbours',
    pretend: 'Only pretend',
  },
  empath: Object.fromEntries(
    Object.entries(EMPATH).map(([k, v]) => [k, v[0]!.toUpperCase() + v.slice(1)]),
  ),
};

const ORACLE_TOPIC: Record<string, string> = {
  'werewolf-team': 'whether to join the werewolves',
  'vampire-team': 'whether to join the vampires',
  'alien-team': 'whether to join the aliens',
  'alien-exchange': 'whether to make the aliens swap their cards',
  'view-center': 'whether to look at the centre cards',
  'center-exchange': 'whether to swap with a centre card',
  ripple: 'whether to guarantee a ripple',
  'even-odd': 'whether her number is even or odd',
  'view-player': 'whose card to look at',
  number: 'to guess the narrator’s number',
};

/** The Oracle's question and what came of it, in the third person (for the replay). */
export function oracleAbout(question: string, answer: string, outcome: string): string {
  const what: Record<string, string> = {
    'werewolf-team:yes': 'her card became a werewolf card',
    'vampire-team:yes': 'her card became a vampire card',
    'alien-team:yes': 'her card became an alien card',
    'alien-team:yes-helper': 'she now wins only if the aliens win',
    'team:no': 'she stayed with the village',
    'alien-exchange:yes': 'the aliens had to swap their cards',
    'alien-exchange:no': 'the aliens kept their cards',
    'center-exchange:yes': 'she swapped with a centre card',
    'center-exchange:denied': 'the narrator made her keep her card',
    'ripple:yes': 'a ripple was guaranteed',
    'view-player:yes': 'she looked at that card',
    'view-player:other': 'the narrator gave her another card to look at',
    'number:right': 'she was right, and kept her eyes open',
    'number:wrong': 'she was wrong: everyone else then won only if she died',
  };
  const res =
    what[outcome] ??
    (outcome.startsWith('view-center:') && outcome !== 'view-center:no'
      ? `she could look at ${outcome.split(':')[1]} centre card(s)`
      : 'nothing changed');
  return `asked ${ORACLE_TOPIC[question] ?? 'a question'}, she answered “${answer}”: ${res}.`;
}
