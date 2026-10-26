import type { PlayerId, Rng } from '@vt/game-sdk';
import { FALLBACK_LINES, fillLine, saidAs, senderOf } from './lines.ts';
import { halfAt } from './setup.ts';
import {
  BANK_TRIGGER,
  BUYERS,
  type Game,
  type GoingOnceState,
  type HintKind,
  MAX_BANK_CALLS,
  MAX_LOANS,
  MAX_MESSAGES,
} from './types.ts';

/** Kinds that come at most once a game. */
const ONCE: ReadonlySet<HintKind> = new Set([
  'intro',
  'firstLoan',
  'thirdLoan',
  'prankCall',
  'topStillOut',
  'bankReminder',
  'leader',
  'poorPlayer',
  'wantArt',
  'notBidding',
  'notBuying',
  'rivalry',
  'dog',
  'cameoA',
  'cameoB',
]);

/** How many of a player's latest messages a new line may not repeat. */
const RECENT_LINES = 4;

/** A player's full score now: cash, plus the value of the art they own, minus debt. */
export function scoreOf(g: Game, id: PlayerId): number {
  const p = g.players[id]!;
  return p.cash - p.debt + artOf(g, id);
}

/** The value of the drawings a player bought. */
export const artOf = (g: Game, id: PlayerId) =>
  Object.values(g.items).reduce((n, i) => n + (i.sale?.buyer === id ? i.value : 0), 0);

const owned = (g: Game, id: PlayerId) => Object.values(g.items).filter((i) => i.sale?.buyer === id);

interface Pick {
  kind: HintKind;
  about?: PlayerId;
  value?: number;
}

/**
 * Before each lot, every player gets one message: the first kind in priority order whose
 * condition holds. Players with the fewest bids so far go first, and only one player per lot is
 * told who knows the lot. Every informative message is true.
 */
export function sendHints(s: GoingOnceState, rng: Rng, lot = s.game!.auction!.lot): void {
  const g = s.game!;
  const item = g.items[g.lots[lot]!]!;
  const prev = lot > 0 ? g.items[g.lots[lot - 1]!]! : null;
  const half = halfAt(g.lots.length);
  const screwsOn = lot >= half;
  const left = g.lots.length - lot;
  let someoneKnowsSent = false;
  const knowers = (itemId: string) =>
    g.order.filter((p) => g.players[p]!.wish.some((w) => w.item === itemId));
  const top = Math.max(...Object.values(g.items).map((i) => i.value));
  const tops = Object.values(g.items).filter((i) => i.value === top);
  const scores = Object.fromEntries(g.order.map((p) => [p, scoreOf(g, p)]));
  const best = Math.max(...Object.values(scores));
  const leaders = g.order.filter((p) => scores[p] === best);

  const order = rng
    .shuffle(g.order)
    .sort((x, y) => g.players[x]!.bids - g.players[y]!.bids)
    .filter((p) => !g.left.includes(p));

  for (const id of order) {
    const p = g.players[id]!;
    const others = g.order.filter((o) => o !== id);
    const can = (kind: HintKind) => !(ONCE.has(kind) && p.sent.includes(kind));
    const won = prev?.sale?.buyer === id ? prev : null;
    const profit = won ? won.value - won.sale!.price : 0;
    const mine = owned(g, id);

    const pick = ((): Pick => {
      if (can('intro')) return { kind: 'intro' };
      if (p.pending.includes('firstLoan') && can('firstLoan')) return { kind: 'firstLoan' };
      if (p.pending.includes('thirdLoan') && can('thirdLoan')) return { kind: 'thirdLoan' };
      if (p.pending.includes('prankCall') && can('prankCall')) return { kind: 'prankCall' };
      if (
        can('topStillOut') &&
        lot === half &&
        tops.every((t) => !p.wish.some((w) => w.item === t.id)) &&
        tops.some((t) => !t.sale) &&
        mine.length < 3 &&
        mine.every((i) => i.value - i.sale!.price < 1000)
      )
        return { kind: 'topStillOut' };
      if (
        can('bankReminder') &&
        g.bankOpened &&
        p.bankCalls < MAX_BANK_CALLS &&
        p.loans < MAX_LOANS &&
        p.cash < 1600 &&
        left > 1
      )
        return { kind: 'bankReminder' };
      if (won && profit >= 1000) return { kind: 'goodBuy' };
      // Revenge from no profit at all, as the original (a break-even forced buy included).
      if (won && profit <= 0 && won.sale!.screwedBy && p.screw)
        return { kind: 'revenge', about: won.sale!.screwedBy };
      if (won && profit >= -400 && profit <= 500) return { kind: 'brokeEven' };
      if (won && profit <= -800) return { kind: 'badBuy' };
      if (lot === 1) return { kind: 'secondLot' };
      if (item.artist === id) return { kind: 'yourArt' };
      if (lot >= 2 && !someoneKnowsSent && !p.wish.some((w) => w.item === item.id)) {
        const who = knowers(item.id).filter((k) => k !== id);
        if (who.length) {
          someoneKnowsSent = true;
          return { kind: 'someoneKnows', about: who[rng.int(who.length)]! };
        }
      }
      if (can('leader') && screwsOn && !leaders.includes(id) && best - scores[id]! > 2500)
        return { kind: 'leader', about: leaders[rng.int(leaders.length)]! };
      if (can('poorPlayer') && screwsOn && p.screw) {
        const poor = others.filter((o) => g.players[o]!.cash <= BANK_TRIGGER);
        if (poor.length) return { kind: 'poorPlayer', about: poor[rng.int(poor.length)]! };
      }
      if (can('wantArt') && mine.length <= 1) {
        const offer = (o: PlayerId) => {
          const theirs = Object.values(g.items).filter((i) => i.artist === o);
          const hi = theirs.find((i) => i.value >= 3000);
          const lo = theirs.find((i) => i.value < 3000);
          return hi && lo && !hi.sale && lo.sale?.buyer && lo.sale.price >= 1500
            ? [{ about: o, value: hi.value }]
            : [];
        };
        // As the original: an artist who is the one being asked for gets no such message.
        const offers = offer(id).length ? [] : others.flatMap(offer);
        if (offers.length) return { kind: 'wantArt', ...offers[rng.int(offers.length)]! };
      }
      if (can('notBidding') && lot >= 2 && p.bids === 0) return { kind: 'notBidding' };
      if (can('notBuying') && screwsOn && mine.length === 0) return { kind: 'notBuying' };
      if (can('rivalry')) return { kind: 'rivalry', about: others[rng.int(others.length)]! };
      if (can('dog') && screwsOn && rng.next() < 0.2) return { kind: 'dog' };
      if (left === 1 && can('cameoA') && rng.next() < 1 / 40) return { kind: 'cameoA' };
      if (left === 1 && can('cameoB') && rng.next() < 1 / 40) return { kind: 'cameoB' };
      return { kind: 'filler' };
    })();

    p.pending = p.pending.filter((f) => f !== pick.kind);
    if (ONCE.has(pick.kind)) p.sent.push(pick.kind);
    // Rooms saved before contacts were dealt pick a buyer per message, as they used to.
    const contact = g.contacts?.[id] ?? BUYERS[rng.int(BUYERS.length)]!;
    const from = senderOf(pick.kind, contact);
    // Filler from a buyer is that buyer's own chatter when the pack gives them some.
    const own = pick.kind === 'filler' && from === contact ? g.lines[contact] : undefined;
    const lines = own?.length
      ? own
      : g.lines[pick.kind]?.length
        ? g.lines[pick.kind]!
        : FALLBACK_LINES[pick.kind];
    const vars = {
      ...(pick.about && { player: g.names[pick.about] }),
      ...(pick.value !== undefined && { value: pick.value }),
    };
    // Never the same line twice in a player's last few messages, while there is another.
    const recent = p.messages.slice(-RECENT_LINES);
    const fresh = lines.filter((l) => !recent.some((m) => saidAs(m.text, l, vars)));
    const choices = fresh.length ? fresh : lines;
    const line = choices[rng.int(choices.length)]!;
    s.seq += 1;
    p.messages.push({
      id: s.seq,
      lot,
      kind: pick.kind,
      from,
      text: fillLine(line, vars, rng),
      ...(pick.about && { about: pick.about }),
      ...(pick.value !== undefined && { value: pick.value }),
    });
    if (p.messages.length > MAX_MESSAGES) p.messages.splice(0, p.messages.length - MAX_MESSAGES);
  }
}
