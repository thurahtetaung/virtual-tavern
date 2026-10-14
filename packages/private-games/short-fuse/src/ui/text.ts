import { timedOut } from '@vt/game-sdk';
import type { CardType } from '../logic/cards.ts';
import type { GameView, LogEntry, PendingView, PlayKind, ShortFuseView } from '../logic/types.ts';
import type { Content } from './assets.ts';

/** A player's name as the table shows it ("you" for the viewer). */
export function who(view: ShortFuseView, id: string | null | undefined, you = true): string {
  if (!id) return 'Someone';
  if (you && id === view.me?.id) return 'you';
  return (
    view.game?.players.find((p) => p.id === id)?.name ??
    view.seats.find((s) => s.id === id)?.name ??
    'Someone'
  );
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "your" for the viewer, else "Ana’s" (from a name `who` gave). */
const whose = (name: string) => (name === 'you' ? 'your' : name === 'You' ? 'Your' : `${name}’s`);

/** The verb that agrees with a name `who` gave: "you draw", "Ana draws". */
const agree = (name: string, you: string, other: string) =>
  name.toLowerCase() === 'you' ? you : other;

/** "a Bomb", "an Ace": the article for a name. */
export const an = (name: string) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;

/** "a pair", "three of a kind", "five different cards", or the card's own name. */
export function playName(c: Content, kind: PlayKind, t: CardType | null): string {
  if (kind === 'pair') return `a pair${t ? ` of ${c.name(t)}` : ''}`;
  if (kind === 'triple') return `three of a kind${t ? ` (${c.name(t)})` : ''}`;
  if (kind === 'five') return 'five different cards';
  return t ? c.name(t) : 'a card';
}

/** "Ana plays Attack", "Ana plays Favor on Ben", "Ana asks Ben for a Defuse (three of a kind)". */
export function pendingLine(view: ShortFuseView, c: Content, p: PendingView): string {
  const by = cap(who(view, p.by));
  const on = p.target ? who(view, p.target) : null;
  if (p.kind === 'triple' && p.named)
    return `${by} ${by === 'You' ? 'ask' : 'asks'} ${on} for ${c.name(p.named)} (three of a kind)`;
  if (p.kind === 'pair')
    return `${by} ${by === 'You' ? 'steal' : 'steals'} from ${on} with ${playName(c, 'pair', p.t)}`;
  const verb = by === 'You' ? 'play' : 'plays';
  return `${by} ${verb} ${playName(c, p.kind, p.t)}${on ? ` on ${on}` : ''}`;
}

/** One line of the public log. */
export function logLine(view: ShortFuseView, c: Content, e: LogEntry): string {
  const by = cap(who(view, e.by));
  const target = who(view, e.target);
  const card = (t: CardType | undefined) => (t ? c.name(t) : 'a card');
  switch (e.kind) {
    case 'start':
      return `The game begins with ${e.n} players.`;
    case 'play': {
      const kind = e.play ?? 'card';
      if (kind === 'triple')
        return `${by} asked ${target} for ${card(e.named)} with three of a kind.`;
      if (kind === 'pair') return `${by} played a pair on ${target}.`;
      if (kind === 'five') return `${by} played five different cards.`;
      return `${by} played ${card(e.cards?.[0])}${e.target ? ` on ${target}` : ''}.`;
    }
    case 'nope':
      return (e.n ?? 1) % 2 === 1
        ? `${by}: ${c.name('nope')}! (${e.n})`
        : `${by} said ${c.name('nope')} to the ${c.name('nope')} (${e.n}).`;
    case 'cancelled':
      return `${whose(by)} play was cancelled.`;
    case 'resolved':
      return `${whose(by)} play goes ahead after ${e.n} × ${c.name('nope')}.`;
    case 'draw':
      return `${by} drew a card${e.from === 'bottom' ? ' from the bottom' : ''}.`;
    case 'drew-bomb':
      return `${by} drew ${an(card(e.cards?.[0]))}!`;
    case 'defuse':
      return `${by} used ${an(card('defuse'))}.`;
    case 'placed':
      return e.cards?.[0] === 'void'
        ? `${by} put ${card('void')} back, face up.`
        : `${by} hid the ${card('bomb')} back in the pile.`;
    case 'void-up':
      return `${by} drew ${card('void')}: it goes back in face up.`;
    case 'explode':
      return e.cards?.[0] === 'void' ? `🕳️ ${by} fell into ${card('void')}.` : `💥 ${by} exploded!`;
    case 'favor':
      return e.n
        ? e.from === 'stash'
          ? `${whose(by)} ${c.name('vault')} Stash gave ${target} a card.`
          : `${by} gave ${target} a card.`
        : `${by} had nothing to give.`;
    case 'steal':
      return e.n
        ? `${by} stole a card from ${e.from === 'stash' ? `${whose(target)} ${c.name('vault')} Stash` : target}.`
        : `${by} found nothing to steal.`;
    case 'ask':
      return e.hit
        ? `${cap(target)} handed over ${card(e.named)}.`
        : `${cap(target)} had no ${card(e.named)}.`;
    case 'salvage':
      return `${by} took ${card(e.cards?.[0])} from the discard pile.`;
    case 'shuffle':
      return `${by} shuffled the pile.`;
    case 'reverse':
      return 'Play now goes the other way.';
    case 'attacked':
      return `${cap(target)} must take ${e.n} turns.`;
    case 'empty':
      return `The pile is empty: ${who(view, e.by)} ${agree(by, 'draw', 'draws')} nothing.`;
    case 'left':
      return `${by} left the game.`;
    case 'timeout':
      return timedOut(`${who(view, e.by)} ${c.t(e.did ?? 'moved')}`);
    case 'act-for':
      return `${by} (host) acted for ${target}: ${c.t(e.did ?? 'moved')}.`;
    case 'win':
      return `🏆 ${by} ${by === 'You' ? 'win' : 'wins'}!`;
    case 'swap':
      return `${by} swapped the top and bottom of the pile.`;
    case 'stack':
      return `${by} put every ${c.names.bomb} on top: ${e.n} of them!`;
    case 'mark':
      return `${by} marked ${card(e.cards?.[0])} in ${whose(target)} hand.`;
    case 'blind':
      return `${by} blindfolded ${target}.`;
    case 'cured':
      return `${by} drew safely: the blindfold is off.`;
    case 'lost':
      return e.cards?.length
        ? `${by} turned over ${an(card(e.cards[0]))}: lost.`
        : `${by} turned over a card.`;
    case 'bark':
      return e.cards?.length === 2
        ? `${by} set both ${card('twin')} cards on ${target}!`
        : `${by} played ${an(card('twin'))}: ${target} had the other one!`;
    case 'twin-wait':
      return `${by} played ${an(card('twin'))}: nobody has the other yet. It waits in front of ${agree(by, 'you', 'them')}.`;
    case 'vault':
      return `${by} put on the ${card('vault')}, with a Stash of ${e.n}.`;
    case 'mine':
      return `${by} put ${an(card('mine'))} in front of ${target}.`;
    case 'mine-took':
      return e.cards?.length
        ? `${by} took ${whose(target)} draw: ${an(card(e.cards[0]))}!`
        : `${by} took ${whose(target)} draw.`;
    case 'bury':
      return `${by} drew a card to bury it back in the pile.`;
    case 'pooled':
      return e.cards?.[0] === 'potluck'
        ? `${e.n} cards went face down on top of the pile.`
        : `${e.n} cards went into the pile, and it was shuffled.`;
    case 'shared':
      return `${by} showed the top ${e.n} cards to ${target}.`;
    case 'received-bomb':
      return `${by} ${by === 'You' ? 'were' : 'was'} handed ${an(card(e.cards?.[0]))}!`;
    case 'unprotected':
      return `${by} lost ${by === 'You' ? 'your' : 'their'} cover: ${an(card(e.cards?.[0]))} goes off!`;
    case 'self-attack':
      return `${by} now ${by === 'You' ? 'owe' : 'owes'} ${e.n} turns.`;
    case 'superskip':
      return `${by} skipped every turn ${by === 'You' ? 'you' : 'they'} owed.`;
  }
}

/** The status line: what's going on, and what the viewer should do now. */
export function statusFor(view: ShortFuseView, c: Content): { text: string; yourMove: boolean } {
  const g = view.game;
  if (!g) return { text: '', yourMove: false };
  const me = view.me?.id;
  const mine = g.players.find((p) => p.id === me);
  if (view.phase === 'over') {
    if (!g.winner) return { text: 'The game is over.', yourMove: false };
    return {
      text: g.winner === me ? '🏆 You win! Last one standing.' : `🏆 ${who(view, g.winner)} wins!`,
      yourMove: false,
    };
  }
  if (view.stage === 'beat' && g.beat)
    return {
      text: g.beat.who === me ? '💥 You exploded!' : `💥 ${cap(who(view, g.beat.who))} exploded!`,
      yourMove: false,
    };
  if (mine?.dead)
    return {
      text: 'You’re out: you can watch the rest, seeing only what the table sees.',
      yourMove: false,
    };
  if (view.stage === 'window' && g.pending) {
    const line = pendingLine(view, c, g.pending);
    if (g.canNope) return { text: `${line}. ${c.name('nope')} it?`, yourMove: false };
    return {
      text: `${line}: ${g.window?.cancelled ? 'cancelled' : 'going ahead'} unless someone says ${c.name('nope')}…`,
      yourMove: false,
    };
  }
  const p = g.prompt;
  if (p) {
    switch (p.kind) {
      case 'turn': {
        const owed = g.turn.owed;
        if (p.blind)
          return {
            text: 'You’re blindfolded: tap a face-down card to play it blind, or draw (a safe draw takes the blindfold off).',
            yourMove: true,
          };
        return {
          text:
            owed > 1
              ? `Your turn: you owe ${owed} turns. Play cards, then draw (each draw ends one).`
              : 'Your turn: play any cards you like, then draw one.',
          yourMove: true,
        };
      }
      case 'give':
        return {
          text: `${cap(who(view, p.to))} asked you for a card: pick one to give.`,
          yourMove: true,
        };
      case 'alter':
        return {
          text: p.share
            ? `Put the top cards back in any order; ${who(view, p.share)} will see them too.`
            : 'Put the top cards back in any order.',
          yourMove: true,
        };
      case 'each':
        return p.done
          ? { text: 'Waiting for the others to choose their card…', yourMove: false }
          : {
              text:
                p.what === 'potluck'
                  ? 'Choose a card to put face down on top of the pile.'
                  : 'Choose a card to put into the pile (it gets shuffled).',
              yourMove: true,
            };
      case 'target':
        return {
          text: `You turned over ${an(c.name(p.card.t))}: choose who it’s for.`,
          yourMove: true,
        };
      case 'search':
        return {
          text: `${p.twin ? `${cap(an(c.name('twin')))} barked at you!` : `You drew ${an(c.name('bomb'))}!`} Blindfolded: turn your cards over one by one, hoping for ${an(c.name('defuse'))}.`,
          yourMove: true,
        };
      case 'salvage':
        return { text: 'Take any card from the discard pile.', yourMove: true };
      case 'bomb':
        return {
          text: p.twin
            ? `${cap(an(c.name('twin')))} barked at you! Play ${an(c.name('defuse'))} to survive.`
            : g.log.at(-1)?.kind === 'drew-bomb' && g.log.at(-1)?.by === view.me?.id
              ? `You drew ${an(c.name('bomb'))}! Play ${an(c.name('defuse'))} to survive.`
              : `${cap(an(c.name('bomb')))} is yours to deal with! Play ${an(c.name('defuse'))} to survive.`,
          yourMove: true,
        };
      case 'place':
        return {
          text: p.bury
            ? `Put ${an(c.name(p.card.t))} back anywhere in the pile. Nobody sees where.`
            : p.void
              ? c.t('Put {c:void} back face up anywhere in the pile.')
              : c.t('Hide {c:bomb} anywhere in the pile. Nobody sees where.'),
          yourMove: true,
        };
    }
  }
  const busy = g.busy;
  if (busy) {
    const name = cap(who(view, busy.who));
    const is = agree(name, 'are', 'is');
    const lines = {
      give: `${name} ${is} choosing a card to give ${who(view, g.turn.player)}…`,
      alter: `${name} ${is} rearranging the top of the pile…`,
      salvage: `${name} ${is} picking a card from the discard pile…`,
      bomb:
        g.drawnKind === 'twin'
          ? `${name} must answer the ${c.name('twin')}!`
          : `${name} ${agree(name, 'have', 'has')} ${an(c.name('bomb'))} to deal with!`,
      search: `${name} ${is} blindfolded with ${an(c.name(g.drawnKind === 'twin' ? 'twin' : 'bomb'))}: turning cards over…`,
      target: `${name} ${is} choosing who the blind card is for…`,
      each: `Everyone with cards is choosing one (${(g.each?.waiting ?? []).map((id) => who(view, id)).join(', ') || 'done'})…`,
      place:
        g.drawnKind === 'bury'
          ? `${name} ${is} burying a card back in the pile…`
          : g.drawnKind === 'void'
            ? c.t(`${name} ${is} putting {c:void} back face up…`)
            : c.t(`${name} ${is} hiding {c:bomb} back in the pile…`),
    };
    return { text: lines[busy.what], yourMove: false };
  }
  const turn = g.turn;
  const owed = turn.owed > 1 ? ` (${turn.owed} turns to go)` : '';
  return { text: `${whose(cap(who(view, turn.player)))} turn${owed}.`, yourMove: false };
}

/** Whether the viewer is still in the game (seated and not exploded). */
export const amIn = (view: ShortFuseView) => {
  const me = view.game?.players.find((p) => p.id === view.me?.id);
  return !!me && !me.dead && !me.left;
};

export const playersIn = (g: GameView) => g.players.filter((p) => !p.dead && !p.left);
