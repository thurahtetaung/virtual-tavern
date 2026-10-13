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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
      return `${by === 'You' ? 'Your' : `${by}’s`} play was cancelled.`;
    case 'resolved':
      return `${by === 'You' ? 'Your' : `${by}’s`} play goes ahead after ${e.n} × ${c.name('nope')}.`;
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
      return e.n ? `${by} gave ${target} a card.` : `${by} had nothing to give.`;
    case 'steal':
      return e.n ? `${by} stole a card from ${target}.` : `${by} found nothing to steal.`;
    case 'ask':
      return e.hit
        ? `${target} handed over ${card(e.named)}.`
        : `${target} had no ${card(e.named)}.`;
    case 'salvage':
      return `${by} took ${card(e.cards?.[0])} from the discard pile.`;
    case 'shuffle':
      return `${by} shuffled the pile.`;
    case 'reverse':
      return 'Play now goes the other way.';
    case 'attacked':
      return `${cap(target)} must take ${e.n} turns.`;
    case 'empty':
      return `The pile is empty: ${who(view, e.by)} draws nothing.`;
    case 'left':
      return `${by} left the game.`;
    case 'timeout':
      return timedOut(`${who(view, e.by)} ${e.did ?? 'moved'}`);
    case 'act-for':
      return `${by} (host) acted for ${target}: ${e.did ?? 'moved'}.`;
    case 'win':
      return `🏆 ${by} ${by === 'You' ? 'win' : 'wins'}!`;
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
        return { text: 'Put the top cards back in any order.', yourMove: true };
      case 'salvage':
        return { text: 'Take any card from the discard pile.', yourMove: true };
      case 'bomb':
        return {
          text: `You drew ${an(c.name('bomb'))}! Play ${an(c.name('defuse'))} to survive.`,
          yourMove: true,
        };
      case 'place':
        return {
          text: p.void
            ? c.t('Put {c:void} back face up anywhere in the pile.')
            : c.t('Hide {c:bomb} anywhere in the pile. Nobody sees where.'),
          yourMove: true,
        };
    }
  }
  const busy = g.busy;
  if (busy) {
    const name = cap(who(view, busy.who));
    const lines = {
      give: `${name} is choosing a card to give ${who(view, g.turn.player)}…`,
      alter: `${name} is rearranging the top of the pile…`,
      salvage: `${name} is picking a card from the discard pile…`,
      bomb: `${name} drew ${an(c.name('bomb'))}!`,
      place:
        g.drawnKind === 'void'
          ? c.t(`${name} is putting {c:void} back face up…`)
          : c.t(`${name} is hiding {c:bomb} back in the pile…`),
    };
    return { text: lines[busy.what], yourMove: false };
  }
  const turn = g.turn;
  const owed = turn.owed > 1 ? ` (${turn.owed} turns to go)` : '';
  if (!mine) return { text: `${cap(who(view, turn.player))}’s turn${owed}.`, yourMove: false };
  return { text: `${cap(who(view, turn.player))}’s turn${owed}.`, yourMove: false };
}

/** Whether the viewer is still in the game (seated and not exploded). */
export const amIn = (view: ShortFuseView) => {
  const me = view.game?.players.find((p) => p.id === view.me?.id);
  return !!me && !me.dead && !me.left;
};

export const playersIn = (g: GameView) => g.players.filter((p) => !p.dead && !p.left);
