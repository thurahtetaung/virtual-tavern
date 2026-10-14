import type {
  GameGuide,
  GuideCatalogGroup,
  GuideContext,
  GuideFooter,
  GuideOption,
  GuideTile,
} from '@vt/game-sdk';
import { ENABLED_HEROES, HEROES, SETS, cardsOf, symbolCount } from './cards.ts';
import type { CardDef, Effect, HeroId, SetId, TavernBrawlView } from './types.ts';

/** Our own one-line summary of every power ("you" is whoever plays the card). */
export const POWER_TEXT: Record<Effect, string> = {
  healPerOppThenHitEach: 'Heal 1 for each opponent, then deal 1 damage to each opponent.',
  allDiscardDraw3: 'Everyone, you included, discards their hand and draws 3.',
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
  hitAllOpps: 'Until your next turn, your attacks hit every opponent, this card’s included.',
  swapHands: 'Swap your hand with an opponent’s.',
  takeTopDiscards: 'Take the top card of each opponent’s discard pile into your hand.',
  hitPerHandCard: 'Deal an opponent 1 damage for each card in their hand (up to 5).',
  destroyThenHealPerShield: 'Destroy a shield in play, then heal its printed shield points.',
  ignoreShields: 'This turn your attack cards ignore shields, this one included.',
  bonesOnDestroy:
    'It strikes back: when it is destroyed, whoever holds it deals two separate 1-damage attacks.',
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

/**
 * What a card does, in our own words, each symbol spelled out in printed order ("Deal 2 damage to
 * one opponent, then play another card."): the guide, the hero sheets and the zoom view.
 */
export function cardText(def: CardDef): string {
  const whom = def.effect === 'hitAllOpps' ? 'each opponent' : 'one opponent';
  const through = def.effect === 'ignoreShields' ? ', straight through shields' : '';
  const parts: string[] = [];
  if (def.shield > 0)
    parts.push(
      def.steps.length
        ? `put up a ${def.shield}-point shield`
        : `put up a ${def.shield}-point shield: it stays in front of you and takes damage before you do, until it breaks`,
    );
  let paw = false;
  for (const step of def.steps) {
    switch (step.k) {
      case 'atk':
        parts.push(`deal ${step.n} damage to ${whom}${through}`);
        break;
      case 'heal':
        parts.push(`heal ${step.n}`);
        break;
      case 'play':
        parts.push(step.n > 1 ? `play ${step.n} more cards` : 'play another card');
        break;
      case 'draw':
        parts.push(`draw ${step.n === 1 ? '1 card' : `${step.n} cards`}`);
        break;
      case 'paw':
        paw = true;
        break;
      case 'power':
        parts.push(
          POWER_TEXT[def.effect!].replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()),
        );
        break;
    }
  }
  const sentence = (line: string) => line[0]!.toUpperCase() + line.slice(1) + '.';
  // A shield with a power: the power says what the shield does, so it gets its own sentence.
  const lines =
    def.shield > 0 && def.effect && parts.length > 1
      ? [sentence(parts[0]!), sentence(parts.slice(1).join(', then '))]
      : parts.length
        ? [sentence(parts.join(', then '))]
        : [];
  if (paw) {
    const wolf = def.steps.some((st) => st.k === 'atk')
      ? 'deal 1 more damage as the wolf'
      : 'deal 1 damage to one opponent as the wolf';
    lines.push(`Form bonus: heal 1 as the bear, or ${wolf}.`);
  }
  return lines.join(' ') || 'No effect.';
}

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
  /** A hero's class ("Barbarian"), shown under their name; nothing without a manifest. */
  heroClass?: (id: HeroId) => string | undefined;
  card?: (id: string) => string | undefined;
  /** A hero's portrait (a URL) and full hero card. */
  heroArt?: (
    id: HeroId,
  ) => { portrait?: string; card?: string; focus?: [number, number] } | undefined;
  /** A hero set's name ("core", "x1", "x2"). */
  set?: (id: SetId) => string | undefined;
  /** A card's face: a small picture and the full card (URLs). */
  cardArt?: (id: string) => { thumb?: string; face?: string } | undefined;
}

/**
 * Portraits are the back of a hero card, under the game's logo: the face usually sits right of
 * centre, mid-height, unless the manifest says where.
 */
export const DEFAULT_FOCUS: [number, number] = [0.66, 0.55];
/** How far a round face crop zooms in (the portrait's width over the circle's). */
export const FACE_ZOOM = 2.4;
/** The guide's square hero tiles show a little more than the face. */
const TILE_ZOOM = 2;

/** A hero's mighty powers: the cards in their deck with a power (✦), in deck order. */
export const powersOf = (hero: HeroId): CardDef[] => cardsOf(hero).filter((c) => !!c.effect);

/** What the guide calls a card with a power. */
export const MIGHTY = 'Mighty power';

const BIG_TABLE: GuideOption = { key: 'big', label: '5 or 6 players' };

const LEVELS: Record<string, 'basics' | 'details' | 'edge'> = {
  'Your turn': 'basics',
  'The symbols': 'basics',
  'Shields and damage': 'basics',
  Knockouts: 'basics',
  'Stealing and borrowing': 'details',
  Forms: 'details',
  'Mighty powers': 'details',
  'When five or six play': 'details',
  'Out-of-turn questions': 'details',
  'Table rulings': 'edge',
  'Timers and absent players': 'edge',
};

export function makeGuide(names: GuideNames = {}, footer?: GuideFooter): GameGuide {
  const heroName = (h: HeroId) => names.hero?.(h) ?? HEROES[h].label;
  const cardName = (def: CardDef) => names.card?.(def.id) ?? placeholderCardName(def);
  const heroClass = (h: HeroId) => names.heroClass?.(h) || undefined;
  const druid = heroName('druid');
  const portrait = (h: HeroId) => names.heroArt?.(h)?.portrait;
  const setName = (id: SetId) => names.set?.(id) ?? SETS[id].label;
  const deckSize = (h: HeroId) => cardsOf(h).reduce((n, c) => n + c.count, 0);
  const guide = text();
  const sections = guide.sections.map((sec) => ({
    ...sec,
    ...(sec.title === 'Forms' && { title: `Forms (${druid})` }),
    level: LEVELS[sec.title] ?? 'details',
    ...(sec.title === 'When five or six play' && { option: BIG_TABLE }),
  }));
  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as TavernBrawlView;
    if (!Array.isArray(v?.seats)) return undefined;
    const heroes = v.seats.map((x) => x.hero).filter((h): h is HeroId => !!h);
    const sets = v.settings?.sets?.length ? v.settings.sets : (Object.keys(SETS) as SetId[]);
    const players = v.seats.filter((x) => x.playing).length;
    // Before anyone picks, the game is whatever the ticked sets hold.
    const pool = heroes.length
      ? heroes
      : ENABLED_HEROES.filter((h) => sets.includes(HEROES[h].set));
    const ctx: GuideContext = {
      summary: heroes.length
        ? heroes.map(heroName).join(' · ')
        : `Heroes from ${sets.map(setName).join(', ')}`,
      options: players >= 5 ? [BIG_TABLE.key] : [],
      inGame: Object.fromEntries(pool.map((h) => [h, 1])),
    };
    const mine = v.seats.find((x) => x.id === you)?.hero;
    if (mine) {
      const art = portrait(mine);
      ctx.you = {
        name: heroName(mine),
        ...(heroClass(mine) && { subtitle: heroClass(mine) }),
        text: HEROES[mine].style,
        tile: mine,
        ...(art && { art }),
      };
    }
    return ctx;
  };
  return {
    ...guide,
    sections,
    steps: [
      {
        title: 'Pick a hero',
        text: guide.quickStart![0]!,
        icon: '🦸',
        ...(portrait('brute') && { art: portrait('brute') }),
      },
      { title: 'Draw 1, play 1', text: guide.quickStart![1]!, icon: '🃏' },
      { title: 'Read the symbols', text: guide.quickStart![2]!, icon: '⚔️🛡️❤️' },
      { title: 'Shields soak damage', text: guide.quickStart![3]!, icon: '🛡️' },
      { title: 'Powers do what they say', text: guide.quickStart![4]!, icon: '✦' },
      {
        title: 'Last hero standing',
        text: guide.quickStart![5]!,
        icon: '🏆',
        ...(portrait('ranger') && { art: portrait('ranger') }),
      },
    ],
    tiles: {
      label: 'Heroes',
      blurb: `${ENABLED_HEROES.length} heroes, each with their own deck`,
      intro:
        'Each hero plays differently. Tap one for their mighty powers, their style and their whole deck; filter by set.',
      items: ENABLED_HEROES.map((h): GuideTile => {
        const art = names.heroArt?.(h);
        return {
          id: h,
          name: heroName(h),
          ...(heroClass(h) && { subtitle: heroClass(h) }),
          text: HEROES[h].style,
          icon: HEROES[h].set === 'x2' ? '👹' : '🦸',
          group: setName(HEROES[h].set),
          meta: setName(HEROES[h].set),
          highlights: {
            title: 'Mighty powers',
            items: powersOf(h).map((c) => {
              const thumb = names.cardArt?.(c.id)?.thumb;
              return {
                name: `${cardName(c)} ×${c.count}`,
                text: cardText(c),
                ...(thumb && { art: thumb }),
              };
            }),
          },
          more: {
            title: `The deck (${deckSize(h)} cards)`,
            items: cardsOf(h).map((c) => `${cardName(c)} ×${c.count} (${symbolLine(c)})`),
          },
          catalog: h,
          ...(art?.portrait && {
            art: art.portrait,
            focus: art.focus ?? DEFAULT_FOCUS,
            zoom: TILE_ZOOM,
          }),
          ...(art?.card && { card: art.card }),
        };
      }),
    },
    catalog: {
      label: 'Cards',
      blurb: `${ENABLED_HEROES.length} decks, ${ENABLED_HEROES.reduce((n, h) => n + powersOf(h).length, 0)} mighty powers`,
      intro:
        'Every hero’s deck, card by card, with what each card does. ✦ marks a mighty power. Tap a card to see it big.',
      groups: ENABLED_HEROES.map((h): GuideCatalogGroup => {
        const art = names.heroArt?.(h);
        const powers = powersOf(h);
        return {
          id: h,
          name: heroName(h),
          ...(heroClass(h) && { subtitle: heroClass(h) }),
          group: setName(HEROES[h].set),
          meta: `${setName(HEROES[h].set)} · ${deckSize(h)} cards · ${powers.length} mighty ${powers.length === 1 ? 'power' : 'powers'}`,
          icon: HEROES[h].set === 'x2' ? '👹' : '🦸',
          ...(art?.portrait && {
            art: art.portrait,
            focus: art.focus ?? DEFAULT_FOCUS,
            zoom: FACE_ZOOM,
          }),
          // Mighty powers first, then the rest in deck order.
          items: [...powers, ...cardsOf(h).filter((c) => !c.effect)].map((c) => {
            const face = names.cardArt?.(c.id);
            return {
              id: c.id,
              name: cardName(c),
              text: cardText(c),
              count: c.count,
              symbols: symbolLine(c),
              ...(face?.thumb && { art: face.thumb }),
              ...(face?.face && { card: face.face }),
              ...(c.effect && {
                mark: {
                  label: `✦ ${MIGHTY}`,
                  text: 'A mighty power: the card does what it says, in the order printed.',
                },
              }),
            };
          }),
        };
      }),
    },
    reference: [
      {
        title: 'The symbols',
        head: ['Symbol', 'What it does'],
        rows: [
          ['⚔', 'Damage to one opponent (or one of their shields)'],
          ['🛡', 'A shield: stays in front of you and blocks that much'],
          ['❤', 'Heal, up to 10'],
          ['⚡', 'Play one more card this turn'],
          ['🃏', 'Draw that many cards'],
          ['🐾', `A bonus in ${druid}’s Form`],
          ['✦', 'A mighty power: do what the card says'],
        ],
      },
      {
        title: 'Mighty powers',
        head: ['Hero', 'Mighty power'],
        rows: ENABLED_HEROES.flatMap((h) =>
          powersOf(h).map((c, i) => [
            i === 0 ? [heroName(h), heroClass(h)].filter(Boolean).join('\n') : '',
            `${cardName(c)}: ${POWER_TEXT[c.effect!]}`,
          ]),
        ),
        note: 'Tap a hero on the Heroes tab, or open Cards, for the whole card.',
      },
    ],
    presets: (Object.keys(SETS) as SetId[]).map((set) => ({
      id: set,
      label: setName(set),
      context: {
        summary: `The heroes of ${setName(set)}.`,
        inGame: Object.fromEntries(
          ENABLED_HEROES.filter((h) => HEROES[h].set === set).map((h) => [h, 1]),
        ),
      },
    })),
    room,
  };

  /** The rules, in reading order. */
  function text(): GameGuide {
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
            `Only ${druid} ever holds a Form. Anyone else who plays a Form card just gets its symbols.`,
          ],
        },
        {
          title: 'Forms',
          bullets: [
            'Playing a Form card puts you in that Form; a new Form replaces the old one.',
            '🐾 cards get a bonus in a Form: heal 1 in the bear Form; in the wolf Form, 1 more damage (or 1 damage to an opponent on a card without ⚔). Without a Form, 🐾 does nothing.',
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
          title: 'Mighty powers',
          bullets: ENABLED_HEROES.flatMap((h) =>
            powersOf(h).map((c) => `${heroName(h)}, ${cardName(c)}: ${cardText(c)}`),
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
        { term: 'Form', meaning: `${druid}’s bear or wolf, which boosts 🐾 cards.` },
      ],
      ...(footer && { footer }),
    };
  }
}

export const guide: GameGuide = makeGuide();
