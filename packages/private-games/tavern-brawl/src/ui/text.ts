import { CARDS } from '../logic/cards.ts';
import type { ChoiceView, GameView, LogEntry, TavernBrawlView } from '../logic/types.ts';
import type { Art } from './assets.ts';

export type NameOf = (id: string) => string;

/** Display names for everyone who sat in the game, then everyone in the room. */
export function namesFor(view: TavernBrawlView, you: string | null): NameOf {
  const names = new Map<string, string>();
  for (const s of view.seats) names.set(s.id, s.name);
  for (const p of view.game?.players ?? []) names.set(p.id, p.name);
  return (id) => (id === you ? 'You' : (names.get(id) ?? 'Someone'));
}

/** A name inside a sentence: "played by you", "played by Ana". */
export const midSentence = (name: string) => (name === 'You' ? 'you' : name);
/** "You" reads "your", anyone else "Ana's". */
export const possessive = (name: string) => (name === 'You' ? 'your' : `${name}’s`);
/** Sentence start for possessives. */
export const Possessive = (name: string) => (name === 'You' ? 'Your' : `${name}’s`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line of the public log, in plain words. Null for lines that would only add noise. */
export function describe(e: LogEntry, name: NameOf, art: Art): string | null {
  const card = (id: string) => art.card(id);
  switch (e.kind) {
    case 'turn':
      return `${Possessive(name(e.player))} turn`;
    case 'play': {
      const who = name(e.by);
      const auto = e.auto === 'timer' ? '⏱ ' : '';
      const from = e.stolen ? ` from ${possessive(name(e.owner))} deck` : '';
      const free = e.free ? ' for free' : '';
      return `${auto}${who} played ${card(e.card)}${from}${free}`;
    }
    case 'damage': {
      const t = name(e.target);
      if (e.hp === 0 && e.shield === 0) return null;
      const ghost = e.ghost ? `👻 ${Possessive(name(e.by))} ghost: ` : '';
      if (e.hp === 0) return `${ghost}${Possessive(t)} shields blocked ${e.shield}`;
      const blocked = e.shield > 0 ? ` (shields blocked ${e.shield})` : '';
      return `${ghost}${t} took ${e.hp} damage${blocked}`;
    }
    case 'shield-hit':
      return null;
    case 'destroy': {
      const holder = name(e.holder);
      return `🛡 ${holder} lost ${card(e.card)}`;
    }
    case 'heal':
      return e.amount > 0 ? `${name(e.player)} healed ${e.amount}` : null;
    case 'draw':
      if (e.refill) return `${Possessive(name(e.player))} hand was empty: drew ${e.count}`;
      return `${name(e.player)} drew ${plural(e.count, 'card')}`;
    case 'reshuffle':
      return `${name(e.player)} shuffled a discard pile into a new deck`;
    case 'debt': {
      const who = name(e.player);
      const more = e.amount > 1 ? `${e.amount} more cards` : 'another card';
      return `⚡ ${who} ${who === 'You' ? 'play' : 'plays'} ${more}`;
    }
    case 'shield-up':
      return `${name(e.player)} put up ${card(e.card)} (🛡${CARDS[e.card]?.shield ?? ''})`;
    case 'charm':
      return `${name(e.by)} took ${card(e.card)} from ${name(e.from) === 'You' ? 'you' : name(e.from)}`;
    case 'swap':
      return `${name(e.a)} and ${name(e.b)} swapped hit points (${e.hpA} and ${e.hpB} now)`;
    case 'rotate':
      return `Hit points passed to the right: ${e.players.map((p, i) => `${name(p)} ${e.after[i]}`).join(', ')}`;
    case 'recover':
      return `${name(e.player)} took ${card(e.card)} back from the discard pile`;
    case 'scout':
      return `${name(e.by)} took the top card of ${plural(e.count, 'deck')}`;
    case 'pickpocket':
      return e.card
        ? `${name(e.by)} took ${card(e.card)} off ${possessive(name(e.from))} deck`
        : `${Possessive(name(e.from))} deck was empty`;
    case 'roar':
      return `${e.players.map(name).join(', ')} discarded their hands and drew 3`;
    case 'disguise':
      return `🎭 ${name(e.player)} can’t be touched by opponents until their next turn`;
    case 'bonus':
      return `${Possessive(name(e.player))} attack cards deal +${e.bonus} this turn`;
    case 'form':
      return `${name(e.player)} took the ${e.form === 'bear' ? '🐻 bear' : '🐺 wolf'} Form`;
    case 'social': {
      const who = name(e.player);
      const late = e.auto ? ' (time ran out)' : '';
      switch (e.flavour ?? 'howl') {
        case 'howl':
          return e.done ? `🐺 ${who} made an animal noise${late}` : `${who} skipped the noise`;
        case 'dance':
          return e.done ? `💃 ${who} danced${late}` : `${who} sat the dance out`;
        case 'praise':
          return e.done ? `🙌 ${who} gave praise${late}` : `😤 ${who} refused to praise`;
      }
      return null;
    }
    case 'mna': {
      const who = name(e.player);
      const what = { attack: '⚔ attack', heal: '❤ heal', draw: '🃏 draw' }[e.pick];
      return `${who} chose to ${what}`;
    }
    case 'hp-copy':
      return `${Possessive(name(e.a))} hit points became ${e.hp}, like ${possessive(name(e.b))}`;
    case 'hands':
      return `${name(e.a)} and ${name(e.b)} swapped hands`;
    case 'mother':
      return e.cards.length
        ? `${name(e.by)} took ${e.cards.map(card).join(', ')} from discard piles`
        : `${name(e.by)} found no discards to take`;
    case 'mirror':
      return `🪞 ${name(e.player)} copied ${card(e.card)}`;
    case 'lasting': {
      const who = name(e.player);
      if (e.what === 'control')
        return `🎯 ${who} steers everyone else’s attacks until their next turn`;
      if (e.what === 'allOpps')
        return `✳ ${Possessive(who)} attacks hit every opponent until their next turn`;
      return `${Possessive(who)} attack cards ignore shields this turn`;
    }
    case 'redirect':
      return `🎯 ${name(e.by)} steered ${possessive(name(e.attacker))} attack at ${name(e.target) === 'You' ? 'you' : name(e.target)}`;
    case 'borrow':
      return `${name(e.player)} borrowed ${possessive(name(e.from))} power`;
    case 'liquidate':
      return `${name(e.player)} discarded ${plural(e.count, 'card')}`;
    case 'haunt':
      return `👻 ${Possessive(name(e.player))} ghost had nobody to haunt`;
    case 'fizzle':
      return `${card(e.card)} had ${e.why === 'no-target' ? 'nobody to hit' : e.why === 'no-shield' ? 'no shield to take' : 'no card to take'}`;
    case 'ko': {
      const p = name(e.player);
      if (e.removed) return `💥 ${p} ${p === 'You' ? 'were' : 'was'} removed by the host`;
      if (e.by === e.player)
        return `💥 ${p} knocked ${p === 'You' ? 'yourself' : 'themselves'} out${e.card ? ` with ${card(e.card)}` : ''}`;
      const by = e.card ? ` by ${possessive(name(e.by))} ${card(e.card)}` : '';
      return `💥 ${p} ${p === 'You' ? 'are' : 'is'} knocked out${by}`;
    }
    case 'pass':
      return `${name(e.player)} had nothing to play`;
    case 'auto':
      if (e.by === 'timer')
        return `⏱ Time ran out: ${e.what === 'play' ? 'a card was played' : e.what === 'done' ? 'counted as done' : 'a choice was made'} for ${name(e.player)}`;
      if (e.by === 'host') return `The host acted for ${name(e.player)}`;
      return `The table played for ${name(e.player)}, who left`;
    case 'left':
      return `${name(e.player)} left the table: the table plays for them`;
    case 'end':
      if (e.winners.length === 0) return 'Everyone is out: a tie!';
      return `🏆 ${e.winners.map(name).join(' & ')} ${e.winners.length === 1 && name(e.winners[0]!) !== 'You' ? 'wins' : 'win'}!`;
  }
}

/** The question the open choice asks the chooser. */
/** The card a question is about, by name ("Your ghost" for a ghost's attack). */
export const askingCard = (c: ChoiceView, art: Art) =>
  c.card === 'ghost' || (!c.card && !c.source) ? 'Your ghost' : art.card(c.card ?? c.source!.card);

export function prompt(c: ChoiceView, g: GameView, name: NameOf, art: Art): string {
  const card = askingCard(c, art);
  switch (c.kind) {
    case 'target':
      return `${card}: who takes ${c.amount} damage? Tap a player, or one of their shields.`;
    case 'shield':
      return `${card}: which of ${possessive(name(c.target ?? ''))} shields takes the ${c.amount} damage first?`;
    case 'destroy':
      return `${card}: destroy which shield?`;
    case 'charm':
      return `${card}: take which shield?`;
    case 'swap':
      return `${card}: swap hit points with whom?`;
    case 'pickpocket':
      return `${card}: play the top card of whose deck?`;
    case 'recover':
      return `${card}: take which card back into your hand?`;
    case 'form':
      return `${card}: play a Form card for free?`;
    case 'social':
      if (c.flavour === 'dance') return `${card}: do a little dance out loud to draw a card!`;
      if (c.flavour === 'praise')
        return `${card}: ${name(g.turn.player)} demands praise. Praise them out loud, or take 2 damage.`;
      return `${card}: make an animal noise out loud to hit every opponent!`;
    case 'mna':
      return `${card} (${name(g.turn.player)}): attack, heal or draw? ${name(g.turn.player)} does the same.`;
    case 'opponent':
      return c.amount !== undefined
        ? `${card}: who takes ${c.amount} damage?`
        : `${card}: which opponent?`;
    case 'second':
      return `${card}: who takes the last ${c.amount ?? 1} damage (a different opponent)?`;
    case 'side':
      return `${card}: borrow the power of your left or right neighbour?`;
    case 'copyA':
      return `${card}: whose hit points change?`;
    case 'copyB':
      return `${card}: copy whose hit points?`;
    case 'mirror':
      return `${card}: copy which shield?`;
    case 'redirect':
      return `${card} (${name(c.attacker ?? '')}): you steer this ${c.amount}-damage attack. Where does it go?`;
  }
}

/** What everyone else sees while someone chooses. */
export function waitingLine(c: ChoiceView, name: NameOf, art: Art): string {
  const who = name(c.chooser);
  const card =
    c.card === 'ghost' || (!c.card && !c.source) ? 'ghost' : art.card(c.card ?? c.source!.card);
  const verb: Record<ChoiceView['kind'], string> = {
    target: 'choosing who to hit',
    shield: 'choosing which shield to hit',
    destroy: 'choosing a shield to destroy',
    charm: 'choosing a shield to take',
    swap: 'choosing who to swap hit points with',
    pickpocket: 'choosing whose deck to take from',
    recover: 'taking a card back',
    form: 'deciding on a free Form',
    social:
      c.flavour === 'dance'
        ? 'deciding whether to dance'
        : c.flavour === 'praise'
          ? 'deciding whether to give praise'
          : 'making an animal noise (or not)',
    mna: 'choosing attack, heal or draw',
    opponent: 'choosing an opponent',
    second: 'choosing one more opponent',
    side: 'choosing a neighbour’s power',
    copyA: 'choosing whose hit points change',
    copyB: 'choosing whose hit points to copy',
    mirror: 'choosing a shield to copy',
    redirect: 'steering an attack',
  };
  return `${who} ${who === 'You' ? 'are' : 'is'} ${verb[c.kind]} (${card})…`;
}
