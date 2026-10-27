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
  BUYERS,
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
  PRACTICE_CASH,
  PRACTICE_VALUE,
  type PracticeView,
  type SeatView,
  settingsOf,
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

function practiceView(g: Game): PracticeView | null {
  const p = g.practice;
  if (g.stage !== 'practice' || !p) return null;
  return {
    step: p.step,
    until: p.until,
    since: p.since,
    house: p.house,
    hint: p.hint,
    value: PRACTICE_VALUE,
    cash: PRACTICE_CASH,
    title: p.step === 'hint' || p.step === 'bid' ? null : p.title,
    seq: p.seq,
    bid: p.bid ? { ...p.bid } : null,
    close: p.close,
    closeAt: p.closeAt,
    steps: bidSteps(p.bid).filter((n) => n <= PRACTICE_CASH),
    recent: p.recent.map((r) => ({ ...r })),
  };
}

/** The lot on the easel: nothing of it during its intro, before the picture goes up. */
function easel(item: Item, intro: boolean): LotPicture {
  return intro ? { item: item.id, drawing: null, house: null, hidden: false } : picture(item, true);
}

function gameView(state: GoingOnceState, g: Game): GameView {
  const over = state.phase === 'over';
  const a = g.auction;
  const drawing = g.stage === 'draw';
  const waitingToDraw = drawing ? drawWaiting(g) : [];
  return {
    stage: g.stage,
    until: drawing ? g.until - DRAW_GRACE_MS : g.until,
    since: g.since ?? 0,
    drawFrom: drawing ? g.drawStart : 0,
    soldBeats: g.stage === 'sold' ? (g.soldBeats ?? null) : null,
    practice: practiceView(g),
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
            picture: easel(g.items[g.lots[a.lot]!]!, a.close === 'intro'),
            seq: a.seq,
            bid: a.bid ? { ...a.bid } : null,
            close: a.close,
            closeAt: a.closeAt,
            since: a.since ?? 0,
            steps: bidSteps(a.bid),
            screw: a.screw ? { by: a.screw.by, until: a.screw.until } : null,
            pausedUntil: a.pausedUntil ?? 0,
            screwed: a.screwed ? { ...a.screwed } : null,
            bankCalled: a.bankCalled.length > 0,
            bidders: [...a.bidders],
            recent: (a.recent ?? []).map((r) => ({ ...r })),
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
    voiced: g.voiced === true,
    introSkipped: g.introSkipped === true,
    introSkippedAt: g.introSkippedAt ?? 0,
    host: g.host
      ? {
          id: g.host.id,
          lines: [...g.host.lines],
          ...(g.host.clips && { clips: g.host.clips.map((c) => ({ ...c })) }),
          ...(g.host.ms !== undefined && { ms: g.host.ms }),
          ...(g.host.moments && { moments: [...g.host.moments] }),
          ...(g.host.named && { named: [...g.host.named] }),
          ...(g.host.at !== undefined && { at: g.host.at }),
        }
      : null,
    ended: g.ended,
    redraw: g.stage === 'draw' && g.redraws > 0,
    paddles: { ...g.paddles },
    firstGame: state.gamesPlayed <= 1,
    knew: over
      ? {
          lists: Object.fromEntries(
            g.order.map((id) => [
              id,
              g.players[id]!.wish.map((w) => ({ title: w.title, value: w.value })),
            ]),
          ),
          by: Object.fromEntries(
            g.lots.map((item) => [
              item,
              g.order.filter((id) => g.players[id]!.wish.some((w) => w.item === item)),
            ]),
          ),
        }
      : null,
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
    contact: g.contacts?.[viewer] ?? BUYERS[g.order.indexOf(viewer) % BUYERS.length]!,
  };
}

/**
 * Whether the viewer drew this lot: one of their titles that they sent. A title they never sent
 * is a house picture with no artist, so it is never theirs (no "your drawing", no commission).
 */
export const drewIt = (mine: GoingOnceView['mine'], item: string) =>
  mine?.prompts.some((p) => p.item === item && p.sent) ?? false;

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
    settings: settingsOf(state.settings),
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g) : null,
    mine: g && viewer !== null ? mineView(state, g, viewer) : null,
    log: state.log.map((e) => ({ ...e })),
    groupsAvailable: state.groupsAvailable,
    gamesPlayed: state.gamesPlayed,
    rigAllowed: testRigAllowed(),
    rig: state.rig ? { ...state.rig } : null,
  };
}
