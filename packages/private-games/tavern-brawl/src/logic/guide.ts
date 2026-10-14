import type { GameGuide, GuideFooter } from '@vt/game-sdk';
import { HEROES, cardsOf, ENABLED_HEROES, symbolCount } from './cards.ts';
import type { CardDef, Effect, HeroId } from './types.ts';

/** Our own one-line summary of every power ("you" is whoever plays the card). */
export const POWER_TEXT: Record<Effect, string> = {
  healPerOppThenHitEach: 'Heal 1 for each opponent, then deal 1 damage to each opponent.',
  allDiscardDraw3: 'Everyone, you included, discards their hand and draws 3. Then play again.',
  destroyOneShield: 'Destroy one shield in play (yours if it is the only one).',
  damageAll3: 'Every player, you included, takes 3 damage.',
  stealShield: 'Take a shield an opponent has in play, damage and all: it protects you now.',
  swapHpWithOpp: 'Swap hit points with an opponent.',
  takeFromDiscard: 'Take a card from your discard pile (from before this turn) into your hand.',
  destroyAllShields: 'Destroy every shield in play, yours too.',
  disguise: 'Until your next turn, opponents’ cards can’t touch you or your shields.',
  playOpponentTop: 'Take the top card of an opponent’s deck and play it as your own.',
  rotateHpRight: 'Everyone passes their hit point total to the player on their right.',
  drawFromEachOpp: 'Take the top card of each opponent’s deck into your hand.',
  attackBonus: 'Your attack cards played after this one this turn deal 1 more damage.',
  formBear: 'Turn into the bear: your Form cards heal you 1 more.',
  formWolf: 'Turn into the wolf: your Form cards deal 1 more damage.',
  freeFormPlay: 'You may also play a Form card from your hand for free.',
  howlThenHitEach:
    'Make an animal noise out loud, then deal 1 damage to each opponent (or skip the noise and the damage).',
  everyoneChooses:
    'Starting with you and going right, each player attacks for 1, heals 1 or draws 1, and you do the same as each of them.',
  discardHandHit:
    'Discard the rest of your hand, then deal that much damage (up to 5) to one opponent.',
  threeTargets:
    'Deal 1 damage to each opponent, then 2 to one opponent, then 1 to a different opponent.',
  destroyThenHitPerShield:
    'Destroy a shield in play, then deal as much damage as it had printed shield points to an opponent.',
  danceDraw:
    'Everyone may do a little dance out loud: each dancer draws 1, and you draw 1 more for every dancer.',
  hitAllOpps: 'Until your next turn, your attacks hit every opponent. Then this card attacks.',
  swapHands: 'Swap your hand with an opponent’s.',
  takeTopDiscards: 'Take the top card of each opponent’s discard pile into your hand.',
  hitPerHandCard: 'Deal an opponent 1 damage for each card in their hand (up to 5).',
  destroyThenHealPerShield: 'Destroy a shield in play, then heal its printed shield points.',
  ignoreShields: 'This turn your attack cards ignore shields, this one included.',
  bonesOnDestroy:
    'A shield that strikes back: when it is destroyed, whoever holds it deals two separate 1-damage attacks.',
  praiseOrHit: 'Each opponent may praise you out loud; those who refuse take 2 damage.',
  controlAttacks:
    'Until your next turn, you choose the target of every attack card anyone else plays.',
  hitUnshieldedThenWipe:
    'Deal 2 damage to each opponent with no shield, then destroy every shield in play, yours too.',
  copyShield:
    'Becomes a copy of another shield in play: it does what that card does and stays as that shield.',
  borrowNeighbourPower:
    'Use the first power of the hero to your left or right (the nearest still in the game).',
  copyHp: 'Make one player’s hit points equal to another player’s (you may be either).',
};

/** "⚔3", "🛡2 + 🃏1"… for a card's printed symbols. */
export function symbolLine(def: CardDef): string {
  const parts: string[] = [];
  const icons: Record<string, string> = { atk: '⚔', shd: '🛡', heal: '❤', play: '⚡', draw: '🃏' };
  for (const k of ['atk', 'shd', 'heal', 'play', 'draw'] as const) {
    const n = symbolCount(def, k);
    if (n > 0) parts.push(`${icons[k]}${n}`);
  }
  if (def.steps.some((s) => s.k === 'paw')) parts.push('🐾');
  if (def.effect) parts.push('✦');
  return parts.join(' ');
}

/** A neutral placeholder name built from a card's symbols ("Attack 3", "Shield 2 + Draw"). */
export function placeholderCardName(def: CardDef): string {
  if (def.effect) {
    const short: Record<Effect, string> = {
      healPerOppThenHitEach: 'Power: Spin',
      allDiscardDraw3: 'Power: Fresh hands',
      destroyOneShield: 'Power: Break a shield',
      damageAll3: 'Power: Blast all',
      stealShield: 'Power: Take a shield',
      swapHpWithOpp: 'Power: Swap hit points',
      takeFromDiscard: 'Power: Second chance',
      destroyAllShields: 'Power: Break all shields',
      disguise: 'Power: Disguise',
      playOpponentTop: 'Power: Pick a deck',
      rotateHpRight: 'Power: Pass it on',
      drawFromEachOpp: 'Power: Scout',
      attackBonus: 'Power: Boost',
      formBear: 'Form: Bear',
      formWolf: 'Form: Wolf',
      freeFormPlay: 'Power: Call of the wild',
      howlThenHitEach: 'Power: Howl',
      everyoneChooses: 'Power: Everyone chooses',
      discardHandHit: 'Power: Cash in',
      threeTargets: 'Power: Three targets',
      destroyThenHitPerShield: 'Power: Shield smash',
      danceDraw: 'Power: Dance',
      hitAllOpps: 'Power: Hit everyone',
      swapHands: 'Power: Swap hands',
      takeTopDiscards: 'Power: Raid discards',
      hitPerHandCard: 'Power: Hand blast',
      destroyThenHealPerShield: 'Power: Shield snack',
      ignoreShields: 'Power: Through shields',
      bonesOnDestroy: 'Shield 3 + Strike back',
      praiseOrHit: 'Power: Praise me',
      controlAttacks: 'Power: Steer attacks',
      hitUnshieldedThenWipe: 'Power: Wipe shields',
      copyShield: 'Power: Copy a shield',
      borrowNeighbourPower: 'Power: Borrow a power',
      copyHp: 'Power: Copy hit points',
    };
    return short[def.effect];
  }
  const words = { atk: 'Attack', shd: 'Shield', heal: 'Heal', play: 'Play', draw: 'Draw' };
  const parts: string[] = [];
  for (const k of ['atk', 'shd', 'heal', 'play', 'draw'] as const) {
    const n = symbolCount(def, k);
    if (n > 0) parts.push(`${words[k]} ${n}`);
  }
  if (def.steps.some((s) => s.k === 'paw')) parts.push('Form bonus');
  return parts.join(' + ');
}

/** Names the guide uses; the web app fills them from the private manifest. */
export interface GuideNames {
  hero?: (id: HeroId) => string | undefined;
  card?: (id: string) => string | undefined;
}

export function makeGuide(names: GuideNames = {}, footer?: GuideFooter): GameGuide {
  const heroName = (h: HeroId) => names.hero?.(h) ?? HEROES[h].label;
  const cardName = (def: CardDef) => names.card?.(def.id) ?? placeholderCardName(def);
  return {
    tagline:
      'Heroes brawl with cards: hit, block, heal and chain plays to be the last one standing.',
    players: '2 to 6',
    duration: '10 to 20 minutes',
    goal: 'Knock out every other hero. Everyone starts with 10 hit points; the last hero standing wins.',
    quickStart: [
      'Pick a hero: each has their own 28-card deck. Everyone starts with 10 hit points and 3 cards.',
      'On your turn you draw 1 card, then play 1 card and do what its symbols say, top to bottom.',
      '⚔ deals damage, 🛡 stays in front of you and blocks, ❤ heals, ⚡ lets you play another card, 🃏 draws.',
      'Damage hits shields first (you choose which), and only reaches hit points once they’re broken.',
      'Cards with ✦ have a power: just do what it says. Run out of cards in hand and you draw 2.',
      'At 0 hit points you’re out. The last hero standing wins.',
    ],
    setup: [
      'Everyone takes a seat (2 to 6 players) and picks a different hero, or taps 🎲 for a random one. The host can also deal random heroes to everyone, from the sets they tick.',
      'Each hero’s deck is shuffled, everyone starts on 10 hit points and draws 3 cards.',
      'A random player goes first; play passes round the table in seat order.',
    ],
    sections: [
      {
        title: 'Your turn',
        bullets: [
          'You draw 1 card automatically, then you must play 1 card from your hand.',
          'Each ⚡ on a card you play means you play one more card this turn. The counter at the bottom shows how many you still owe.',
          'You must play even if every card in your hand hurts you.',
          'Whenever your hand is empty after a card, you draw 2 straight away and carry on.',
          'When you owe no more cards, your turn ends by itself. Cards you played go to their owner’s discard pile; shields stay in play.',
        ],
      },
      {
        title: 'The symbols',
        bullets: [
          '⚔ Attack: deal that much damage to one opponent (or one of their shields). All the swords on one card go to the same target.',
          '🛡 Shield: the card stays in front of you, with that many points. Damage must break your shields before it reaches your hit points.',
          '❤ Heal: gain that many hit points, up to 10.',
          '⚡ Play again: play one more card this turn.',
          '🃏 Draw: draw that many cards.',
          '✦ Power: do what the card says (tap the card to read it).',
        ],
      },
      {
        title: 'Shields and damage',
        bullets: [
          'You attack a player or tap one of their shields. If they have shields, you choose which one takes the damage first.',
          'Damage left over when a shield breaks goes to another shield of theirs that you pick, then to their hit points.',
          'Damage marks stay on a shield until it breaks; a broken shield goes to its owner’s discard pile.',
          'Power damage (like a blast that hits everyone) is blocked by shields too.',
        ],
      },
      {
        title: 'Knockouts',
        bullets: [
          'A card always resolves completely first; then everyone on 0 hit points is out.',
          'If you knock yourself out on your own turn, your turn ends there.',
          'If the last players are knocked out together, the game is a tie.',
          'Knocked-out players can’t be targeted; they watch the rest of the game.',
        ],
      },
      {
        title: 'Stealing and borrowing',
        bullets: [
          'Some powers let you play or take another hero’s cards. You play them as your own (you are the “you” on the card).',
          'A borrowed card always goes back to its owner’s discard pile afterwards; a borrowed shield protects you until it breaks, then goes home.',
          'Only the druid ever holds a Form. Anyone else who plays a Form card just gets its symbols.',
        ],
      },
      {
        title: 'Forms (the druid)',
        bullets: [
          'Playing a Form card puts you in that Form; a new Form replaces the old one.',
          '🐾 cards get a bonus in a Form: 1 more heal in the bear Form, 1 more damage in the wolf Form. Without a Form, 🐾 does nothing.',
        ],
      },
      {
        title: 'When five or six play',
        bullets: [
          'Neighbours only: with five or six at the start, regular attack cards can only hit the nearest player still in on your left or right, for the whole game. Cards with a power (✦) reach anyone, even their swords.',
          'Ghosts: a knocked-out player stays at the table as a ghost. On their turn they attack one player for 1. It can never knock anyone out, can’t target a player on 1 hit point, and shields block it. Ghosts can’t win.',
        ],
      },
      {
        title: 'Out-of-turn questions',
        bullets: [
          'Some powers ask other players: everyone chooses attack, heal or draw; dance; praise; a broken strike-back shield’s attacks; or where a steered attack goes.',
          'These questions always get 20 seconds. Then the table answers for you: draw, dance, praise, a random target, or the attack stays where it was aimed.',
        ],
      },
      {
        title: 'Table rulings',
        bullets: [
          'The attacker picks which shield is hit, and where any overflow goes.',
          'If your deck and discard pile are both empty, you simply don’t draw. If you have nothing at all to play, your turn passes.',
          'Taking back a discarded card only reaches cards that were there before this turn.',
          'Powers that take or play another hero’s cards only pick opponents.',
          'A disguise keeps out every opponent’s card, including “everyone” effects, but not your own cards. An attack with only disguised targets does nothing.',
          'The attack bonus adds 1 damage to every target of each attack card played after it this turn, and two of them add 2.',
          'Destroying a shield is not optional: if the only shield in play is yours, it goes.',
          'A taken shield keeps its damage marks.',
          'Attack cards include cards with a power and printed swords (like the wolf Form).',
          'There is no hand limit.',
          'When everyone chooses, every player’s attacks reach anyone, and all of your own repeated attacks hit the same opponent.',
          'A strike-back shield strikes whenever it is destroyed (by damage or a power), but not when its holder is knocked out. Its attacks come after the destroying card has resolved.',
          'Steering attacks never turns an attack back on the player making it.',
          'A shield copy with no other shield in play does nothing and is discarded.',
          'Borrowing a neighbour’s power uses the nearest player still in on that side.',
          'The power that makes your attacks ignore shields and the one that makes them hit everyone also apply to the card that carries them.',
          'Anyone whose hand is emptied by a card draws 2 once it has resolved.',
        ],
      },
      {
        title: 'Timers and absent players',
        bullets: [
          'By default the clock is only a reminder. With a strict clock, a random card is played (and random choices made) when time runs out.',
          'Animal noises and other honour-system prompts get 20 seconds; after that they count as done.',
          'If a player leaves, the table plays their turns for them; the host can also remove them.',
        ],
      },
      {
        title: 'Powers',
        bullets: ENABLED_HEROES.flatMap((h) =>
          cardsOf(h)
            .filter((c) => c.effect)
            .map((c) => `${heroName(h)}, ${cardName(c)}: ${POWER_TEXT[c.effect!]}`),
        ),
      },
    ],
    roles: ENABLED_HEROES.map((h) => ({
      name: heroName(h),
      summary: `${HEROES[h].style} Deck: ${cardsOf(h)
        .map((c) => `${cardName(c)} ×${c.count}`)
        .join(', ')}.`,
    })),
    tips: [
      'Chain ⚡ cards to play several cards in one turn.',
      'Break the biggest shield first when you can finish it off.',
      'Keep a shield up when your hit points are low: it buys a turn.',
      'Tap any card to see the original and what it will do.',
    ],
    glossary: [
      { term: 'Power', meaning: 'A card with ✦: it does what its text says.' },
      { term: 'Form', meaning: 'The druid’s bear or wolf, which boosts 🐾 cards.' },
    ],
    ...(footer && { footer }),
  };
}

export const guide: GameGuide = makeGuide();
