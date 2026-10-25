import type { PlayerId } from '@vt/game-sdk';
import {
  bankRefusal,
  bidSteps,
  drawWaiting,
  loanWaiting,
  screwTargets,
  screwsOn,
  testRigAllowed,
} from './game.ts';
import { artOf } from './hints.ts';
import { halfAt } from './setup.ts';
import {
  DRAW_GRACE_MS,
  type Game,
  type GameView,
  type GoingOnceState,
  type GoingOnceView,
  type Item,
  type LotPicture,
  type LotResult,
  MAX_LOANS,
  type MineView,
  type SeatView,
} from './types.ts';

/** A lot's picture: strokes or the house picture, nothing while hidden. */
function picture(item: Item, withStrokes: boolean): LotPicture {
  if (item.hidden) return { item: item.id, drawing: null, house: null, hidden: true };
  return {
    item: item.id,
    drawing: withStrokes && item.drawing ? structuredClone(item.drawing) : null,
    house: item.drawing ? null : item.house,
    hidden: false,
  };
}

function result(g: Game, item: Item, index: number, over: boolean): LotResult {
  const sale = item.sale!;
  // The artist of a lot nobody bought stays secret until the end.
  const artistKnown = over || sale.buyer !== null;
  return {
    ...picture(item, over),
    index,
    title: item.title,
    value: item.value,
    artist: artistKnown ? item.artist : null,
    artistKnown,
    buyer: sale.buyer,
    price: sale.price,
    commission: sale.commission,
    screwedBy: sale.screwedBy,
  };
}

function gameView(state: GoingOnceState, g: Game): GameView {
  const over = state.phase === 'over';
  const a = g.auction;
  const drawing = g.stage === 'draw';
  const waitingToDraw = drawing ? drawWaiting(g) : [];
  return {
    stage: g.stage,
    until: drawing ? g.until - DRAW_GRACE_MS : g.until,
    order: [...g.order],
    players: g.order.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
      screw: g.players[id]!.screw,
      drawn: drawing && !waitingToDraw.includes(id),
      left: g.left.includes(id),
    })),
    lotCount: g.lots.length,
    halfAt: halfAt(g.lots.length),
    screwsOn: screwsOn(g),
    auction:
      a && (g.stage === 'auction' || g.stage === 'sold')
        ? {
            lot: a.lot,
            picture: picture(g.items[g.lots[a.lot]!]!, true),
            seq: a.seq,
            bid: a.bid ? { ...a.bid } : null,
            close: a.close,
            closeAt: a.closeAt,
            steps: bidSteps(a.bid),
            screw: a.screw ? { by: a.screw.by, until: a.screw.until } : null,
            screwed: a.screwed ? { ...a.screwed } : null,
            bankCalled: a.bankCalled.length > 0,
            bidders: [...a.bidders],
          }
        : null,
    results: g.lots.flatMap((id, i) => {
      const item = g.items[id]!;
      return item.sale ? [result(g, item, i, over)] : [];
    }),
    bank:
      g.stage === 'bank' ? { open: true, done: [...g.bankDone], waiting: loanWaiting(g) } : null,
    bankOpened: g.bankOpened,
    final: over
      ? g.order.map((id) => {
          const p = g.players[id]!;
          const art = artOf(g, id);
          return {
            id,
            cash: p.cash,
            art,
            debt: p.debt,
            score: p.cash + art - p.debt,
            bought: g.lots.filter((item) => g.items[item]!.sale?.buyer === id),
          };
        })
      : null,
    winners: [...g.winners],
    host: g.host ? { id: g.host.id, lines: [...g.host.lines] } : null,
    ended: g.ended,
    redraw: g.stage === 'draw' && g.redraws > 0,
    paddles: { ...g.paddles },
    firstGame: state.gamesPlayed <= 1,
  };
}

function mineView(state: GoingOnceState, g: Game, viewer: PlayerId): MineView | null {
  const p = g.players[viewer];
  if (!p) return null;
  const a = g.auction;
  const refusal = bankRefusal(g, viewer);
  return {
    cash: p.cash,
    debt: p.debt,
    loans: p.loans,
    bankCalls: p.bankCalls,
    screw: p.screw,
    prompts: g.prompts[viewer]!.map((id) => {
      const item = g.items[id]!;
      return {
        item: id,
        title: item.title,
        sent: item.drawing !== null,
        drawing: g.stage === 'draw' && item.drawing ? structuredClone(item.drawing) : null,
      };
    }),
    wish: g.stage === 'draw' ? [] : p.wish.map((w) => ({ title: w.title, value: w.value })),
    messages: p.messages.map((m) => ({ ...m })),
    targets: a?.screw?.by === viewer && g.stage === 'auction' ? screwTargets(g, viewer) : [],
    canLoan: g.stage === 'bank' && p.loans < MAX_LOANS && !g.bankDone.includes(viewer),
    bankDone: g.stage === 'bank' && g.bankDone.includes(viewer),
    canCallBank: refusal === null,
    bankRefusal: refusal ?? null,
  };
}

export function view(state: GoingOnceState, viewer: PlayerId | null): GoingOnceView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g) : null,
    mine: g && viewer !== null ? mineView(state, g, viewer) : null,
    log: state.log.map((e) => ({ ...e })),
    groupsAvailable: state.groupsAvailable,
    rigAllowed: testRigAllowed(),
    rig: state.rig ? { ...state.rig } : null,
  };
}
