import { CARDS } from '../logic/cards.ts';
import { POWER_TEXT } from '../logic/guide.ts';
import type { CardDef, ChoiceView, GameView, LogEntry, TavernBrawlView } from '../logic/types.ts';
import type { Art } from './assets.ts';

export type NameOf = (id: string) => string;

/** Display names for everyone who sat in the game, then everyone in the room. */
export function namesFor(view: TavernBrawlView, you: string | null): NameOf {
  const names = new Map<string, string>();
  for (const s of view.seats) names.set(s.id, s.name);
  for (const p of view.game?.players ?? []) names.set(p.id, p.name);
  return (id) => (id === you ? 'You' : (names.get(id) ?? 'Someone'));
}

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
      if (e.hp === 0) return `${Possessive(t)} shields blocked ${e.shield}`;
      const blocked = e.shield > 0 ? ` (shields blocked ${e.shield})` : '';
      return `${t} took ${e.hp} damage${blocked}`;
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
    case 'social':
      return e.done
        ? `🐺 ${name(e.player)} made an animal noise${e.auto ? ' (time ran out)' : ''}`
        : `${name(e.player)} skipped the noise`;
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

/** What a card does, in our own words, for the zoom view. */
export function rulesLine(def: CardDef): string {
  const parts: string[] = [];
  for (const step of def.steps) {
    switch (step.k) {
      case 'atk':
        parts.push(`deal ${step.n} damage to one opponent`);
        break;
      case 'heal':
        parts.push(`heal ${step.n}`);
        break;
      case 'play':
        parts.push(step.n > 1 ? `play ${step.n} more cards` : 'play another card');
        break;
      case 'draw':
        parts.push(`draw ${plural(step.n, 'card')}`);
        break;
      case 'paw':
        parts.push('in a Form: heal 1 more (bear) or deal 1 more damage (wolf)');
        break;
      case 'power':
        parts.push(
          POWER_TEXT[def.effect!].replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()),
        );
        break;
    }
  }
  if (def.shield > 0) parts.push(`then it stays in front of you as a ${def.shield}-point shield`);
  const line = parts.join(', then ');
  return line ? line[0]!.toUpperCase() + line.slice(1) + '.' : 'No effect.';
}

/** The question the open choice asks the chooser. */
export function prompt(c: ChoiceView, g: GameView, name: NameOf, art: Art): string {
  const card = art.card(c.source.card);
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
      return `${card}: make an animal noise out loud to hit every opponent!`;
  }
  void g;
}

/** What everyone else sees while someone chooses. */
export function waitingLine(c: ChoiceView, name: NameOf, art: Art): string {
  const who = name(c.chooser);
  const card = art.card(c.source.card);
  const verb: Record<ChoiceView['kind'], string> = {
    target: 'choosing who to hit',
    shield: 'choosing which shield to hit',
    destroy: 'choosing a shield to destroy',
    charm: 'choosing a shield to take',
    swap: 'choosing who to swap hit points with',
    pickpocket: 'choosing whose deck to take from',
    recover: 'taking a card back',
    form: 'deciding on a free Form',
    social: 'making an animal noise (or not)',
  };
  return `${who} ${who === 'You' ? 'are' : 'is'} ${verb[c.kind]} (${card})…`;
}
