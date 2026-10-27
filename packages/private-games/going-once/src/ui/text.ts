import type { Message, GoingOnceView, LogEntry, Sender } from '../logic/types.ts';
import { money } from '../logic/lines.ts';
import { fillNames, type Names } from '../logic/names.ts';

export type NameOf = (id: string | null | undefined) => string;

/** Quote marks a title may carry itself: straight, curly and low-9, single or double. */
const MARKS = '"\'“”‘’„‚«»';

/**
 * A title without the quote marks round it that it brings itself (some house titles are quotes),
 * so the screens that put a title in quotes show one pair. Only marks at both ends go, so a
 * trailing apostrophe stays.
 */
export function unquote(title: string): string {
  let bare = title.trim();
  while (bare.length > 1 && MARKS.includes(bare[0]!) && MARKS.includes(bare.at(-1)!))
    bare = bare.slice(1, -1).trim();
  return bare || title;
}

export interface Status {
  text: string;
  yourMove: boolean;
}

/** The always-visible line: what's happening and what the viewer can do now. */
export function statusFor(view: GoingOnceView, you: string, name: NameOf, names: Names): Status {
  const g = view.game;
  const mine = view.mine;
  if (!g) return { text: '', yourMove: false };
  const lot = g.auction ? `Lot ${g.auction.lot + 1} of ${g.lotCount}` : '';
  switch (g.stage) {
    case 'intro':
      return { text: 'The auctioneer explains the auction…', yourMove: false };
    case 'draw': {
      if (!mine) return { text: 'Everyone is drawing.', yourMove: false };
      const todo = mine.prompts.findIndex((p) => !p.sent);
      if (todo >= 0)
        return {
          text: `Draw “${unquote(mine.prompts[todo]!.title)}” (${todo + 1} of ${mine.prompts.length}).`,
          yourMove: true,
        };
      const waiting = g.players.filter((p) => !p.drawn && !p.left).map((p) => name(p.id));
      return { text: `Both sent! Waiting for: ${waiting.join(', ')}.`, yourMove: false };
    }
    case 'practice': {
      const p = g.practice;
      if (!p) return { text: 'Practice lot.', yourMove: false };
      switch (p.step) {
        case 'hint':
          return { text: 'Practice lot: read your tip.', yourMove: false };
        case 'bid':
          return {
            text: 'Practice lot: bid with play money. Nothing counts.',
            yourMove: !!mine && p.bid?.by !== you,
          };
        case 'sold':
          return { text: 'Practice lot: sold!', yourMove: false };
        default:
          return { text: 'Practice lot: one more thing before lot 1.', yourMove: false };
      }
    }
    case 'auction': {
      const a = g.auction!;
      if (a.close === 'intro') return { text: `${lot}: coming up…`, yourMove: false };
      if (a.screw)
        return a.screw.by === you
          ? { text: 'Pick who to screw: they must bid $100 more.', yourMove: true }
          : { text: `${name(a.screw.by)} is choosing who to screw…`, yourMove: false };
      if (!mine) return { text: `${lot}: bidding is open.`, yourMove: false };
      if (a.bid?.by === you)
        return { text: `${lot}: you have the top bid, ${money(a.bid.amount)}.`, yourMove: false };
      if (a.screwed?.target === you)
        return {
          text: `${lot}: ${name(a.screwed.by)} screwed you into bidding ${money(a.bid!.amount)}.`,
          yourMove: false,
        };
      const top = a.bid ? `${name(a.bid.by)} leads with ${money(a.bid.amount)}` : 'no bids yet';
      return { text: `${lot}: ${top}. Bid if it’s worth more to you.`, yourMove: false };
    }
    case 'sold': {
      const r = g.results.at(-1);
      if (!r) return { text: 'Sold!', yourMove: false };
      if (!r.buyer) return { text: `Unsold – it was worth ${money(r.value)}.`, yourMove: false };
      return {
        text: `Sold to ${r.buyer === you ? 'you' : name(r.buyer)} for ${money(r.price)}.`,
        yourMove: false,
      };
    }
    case 'halftime':
      return { text: 'Half-time: screws are unlocked!', yourMove: false };
    case 'bank': {
      const open = fillNames('{Bank} is open', names);
      if (mine && !mine.bankDone)
        return mine.canLoan
          ? { text: `${open}: take a loan, or say no thanks.`, yourMove: true }
          : { text: `${open}, but you have no credit left.`, yourMove: true };
      const waiting = (g.bank?.waiting ?? []).map((id) => name(id));
      return {
        text: waiting.length ? `${open}. Waiting for: ${waiting.join(', ')}.` : `${open}.`,
        yourMove: false,
      };
    }
    case 'done': {
      const winners = g.winners.map((id) => (id === you ? 'You' : name(id)));
      const verb = winners.length === 1 && winners[0] !== 'You' ? 'wins' : 'win';
      return { text: `${winners.join(' & ')} ${verb}!`, yourMove: false };
    }
  }
}

export const SENDERS: Record<Sender, { icon: string; label: string }> = {
  buyer1: { icon: '🎩', label: 'Art buyer' },
  buyer2: { icon: '👒', label: 'Art buyer' },
  buyer3: { icon: '🧐', label: 'Art buyer' },
  bank: { icon: '🏦', label: 'The bank' },
  dog: { icon: '🐕', label: 'A dog' },
  caller: { icon: '📞', label: 'Wrong number' },
};

/** "Why this hint?": the plain fact behind an informative message, or null for chatter. */
export function whyLine(m: Message, name: NameOf): string | null {
  switch (m.kind) {
    case 'intro':
      return 'Your wish list: three titles and their true values. Which picture is which is up to you.';
    case 'yourArt':
      return 'True: this lot is one of your drawings.';
    case 'someoneKnows':
      return `True: ${name(m.about)} has this drawing on their wish list.`;
    case 'topStillOut':
      return 'True: the most valuable drawing of the game hasn’t been sold.';
    case 'leader':
      return `True: ${name(m.about)} is leading by more than $2,500.`;
    case 'poorPlayer':
      return `True: ${name(m.about)} has $1,000 or less.`;
    case 'wantArt':
      return `True: ${name(m.about)}’s unsold high drawing is worth ${money(m.value ?? 0)}.`;
    case 'revenge':
      return `${name(m.about)} screwed you into your last buy.`;
    default:
      return null;
  }
}

/** A public notice from the log, in words. */
export function logLine(e: LogEntry, name: NameOf): string | null {
  switch (e.kind) {
    case 'screw':
      if (e.outcome === 'forced')
        return `🔩 ${name(e.by)} screwed ${name(e.target)} into bidding ${money(e.amount ?? 0)}.`;
      if (e.outcome === 'failed')
        return `🔩 ${name(e.by)} tried to screw ${name(e.target)}, who couldn’t afford it.`;
      return `🔩 ${name(e.by)}’s screw was wasted.`;
    case 'hidden':
      return e.hidden ? '🙈 The host hid a drawing.' : '👁 The host showed a drawing again.';
    case 'left':
      return `${name(e.player)} left; they keep their seat, cash and art.`;
    case 'back':
      return `${name(e.player)} is back.`;
  }
}
