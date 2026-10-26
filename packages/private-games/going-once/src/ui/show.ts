import { type Moment, type Profile, type Rig, type Step, variantOf } from '@vt/game-sdk/show';
import {
  type AuctionView,
  BANK_LATER_MS,
  BID_STEP,
  type GoingOnceView,
  type LotResult,
  OPENING_BID,
  type PracticeView,
} from '../logic/types.ts';
import { RACKUP_BEAT_MS, SOLD_BEAT_MS, endTimes } from './audio.ts';

// Going Once's show as data: every beat the table screen and the phones animate, built purely from
// the view on the server clock (the same moments the sound in `audio.ts` keys its cues to: the
// stamp lands with the bell, the value spins with its effect, and so on), so every device shows
// the same beat at the same instant and a device that arrives late lands on the same frame. The
// parts named here are the rig's (`private-assets/tools/showkit_export.py`) and the layers
// `Stage.tsx` and the phone's overlays register under these target names:
//   camera, dim · lot, lot.num · painting, stamp, stamp.slab, stamp.word, stamp.lineL, stamp.line
//   bidPrompt, bidAmount, bidFrom · phone · timer, timeNum, sign · bank-<part>
//   seat:<id>, pad:<id>, pad:<id>.num, artpay:<id>, artpay:<id>.text, screws:<id>, spot:<id>
//   finale:<id>, finale:<id>.debt, win:<id>, end:<buyer>, endpic:<item>, total:<buyer>, total.num
// Moments only move things and set words; what lasts (whose paddle is whose, the amounts, the
// names) the views render, so a moment that never ran leaves a correct page.

const STAGE: Profile[] = ['stage'];
const PHONES: Profile[] = ['phone-quiet', 'phone-full'];
const FULL: Profile[] = ['stage', 'phone-full'];

/** The original's clip lengths (30 fps) that timings below wait on. */
const MS = {
  stampGood: 733,
  stampBad: 600,
  paintingOut: 633,
  flipEdge: 267,
  lotIn: 867,
  zoom: 1033,
  screwFly: 933,
  bankFirst: 3233,
};

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

/** The raise wobble for a bid: from the lot and the amount, so every screen shows the same one. */
export const raiseOf = (lot: number, amount: number) =>
  `paddle.Raise${variantOf(`${lot}:${amount}`, 4)}` as const;

export interface ShowCtx {
  /** This device's player, or null (the table screen, a watcher). */
  you: string | null;
  profile: Profile;
  /**
   * When this device first saw each seat taken (the view has no join times): a lobby paddle pops
   * up then; seats already taken when the device arrived are just there.
   */
  joined?: Readonly<Record<string, number>>;
  /** The rig's mid-track art swaps (the bank's sign turning into the shark's). */
  swaps?: Rig['swaps'];
}

/** The lot on the easel: the auction's, or the practice lot's (same beats, nothing counts). */
interface Lot {
  key: string;
  lot: number;
  label: string;
  bid: AuctionView['bid'];
  recent: AuctionView['recent'];
  close: AuctionView['close'];
  since: number;
  intro: boolean;
}

function lotOf(view: GoingOnceView): Lot | null {
  const g = view.game;
  if (!g) return null;
  if (g.stage === 'practice' && g.practice) {
    const p: PracticeView = g.practice;
    if (p.step !== 'bid' && p.step !== 'sold' && p.step !== 'own' && p.step !== 'screw')
      return null;
    return {
      key: `practice:${g.since}`,
      lot: -1,
      label: 'Practice',
      bid: p.bid,
      recent: p.recent,
      close: p.close,
      since: p.since,
      intro: false,
    };
  }
  const a = g.auction;
  if (!a || (g.stage !== 'auction' && g.stage !== 'sold')) return null;
  return {
    key: `lot${a.lot}`,
    lot: a.lot,
    label: `${a.lot + 1}/${g.lotCount}`,
    bid: a.bid,
    recent: a.recent,
    close: a.close,
    since: a.since,
    intro: a.close === 'intro',
  };
}

const anim = (t: number, target: string, track: `${string}.${string}`, more: Partial<Step> = {}) =>
  ({ t, kind: 'anim', target, track, ...more }) as Step;
const text = (t: number, target: string, words: string, more: Partial<Step> = {}) =>
  ({ t, kind: 'text', target, text: words, ...more }) as Step;
/** The room darkening or lightening (the original tints the room; ours is a black veil). */
const dim = (t: number, to: number, ms = 300): Step => ({
  t,
  kind: 'css',
  target: 'dim',
  keyframes: [{ opacity: to }],
  ms,
  on: STAGE,
});
const set = (t: number, target: string, attr: string, value: string, more: Partial<Step> = {}) =>
  ({ t, kind: 'set', target, attr, value, ...more }) as Step;

/** The lot coming up: the camera closes in, the LOT disc drops with its number, the phone rings. */
function lotIn(view: GoingOnceView, l: Lot): Moment {
  const g = view.game!;
  const at = g.auction && g.auction.lot === l.lot && l.lot >= 0 ? introAt(view) : l.since;
  return {
    id: `${l.key}:in`,
    at,
    steps: [
      text(0, 'lot.num', l.label),
      {
        t: 0,
        kind: 'css',
        target: 'stampSpin',
        keyframes: [{ transform: 'none', opacity: 1 }],
        ms: 1,
        on: STAGE,
      },
      // Last lot's stamp, if it was never sent off, is put away.
      {
        t: 0,
        kind: 'css',
        target: 'stamp',
        keyframes: [{ opacity: 0 }],
        ms: 1,
        on: FULL,
      },
      // Last lot's amounts and the artist's sign come off the paddles.
      ...g.order.map((id) => text(0, `pad:${id}.num`, '', { on: FULL })),
      anim(0, 'camera', 'stage.ZoomIn', { on: STAGE }),
      anim(0, 'lot', 'lot.Appear'),
      ...(l.lot >= 0 ? [anim(250, 'phone', 'phone.Appear', { on: STAGE })] : []),
    ],
  };
}

/** When the lot's intro began (the auction's `since` moves on with every bid). */
function introAt(view: GoingOnceView): number {
  const a = view.game!.auction!;
  if (a.close === 'intro') return a.since;
  // After the intro: the moment is long past, so its end state is what matters.
  return a.since - 60_000;
}

/** The picture going up on the easel (and the phone's ring going quiet). */
function paintingIn(view: GoingOnceView, l: Lot): Moment {
  const a = view.game!.auction;
  const opened = a && a.close === 'open' && !a.bid ? a.since : l.since - 60_000;
  return {
    id: `${l.key}:painting`,
    at: l.lot < 0 ? l.since - 60_000 : opened,
    steps: [
      anim(0, 'painting', 'painting.Appear'),
      anim(0, 'phone', 'phone.Disappear', { on: STAGE }),
      text(0, 'bidLabel.text', 'Opening bid', { on: STAGE }),
      text(0, 'bidAmount.text', money(OPENING_BID), { on: STAGE }),
      text(0, 'bidPrompt.text', `${money(OPENING_BID)}?`, { on: STAGE }),
      anim(200, 'bidLabel', 'bidLabel.Appear', { on: STAGE }),
      anim(250, 'bidAmount', 'bidAmount.Appear', { on: STAGE }),
      anim(300, 'bidPrompt', 'bidPrompt.Appear', { on: STAGE }),
    ],
  };
}

/**
 * Every bid still in the lot's recent list: the bidder's paddle shoots up (their wobble from the
 * amount), the one they beat drops, the amount pops with the leader's shape spinning in. Only the
 * newest is timed: older ones are long past, so a late device only shows where they left things.
 */
function bids(l: Lot): Moment[] {
  const out: Moment[] = [];
  l.recent.forEach((b, i) => {
    const newest = i === l.recent.length - 1 && l.bid?.amount === b.amount;
    const before = l.recent[i - 1];
    const at = newest ? l.since : l.since - 60_000 + i;
    const steps: Step[] = [
      text(0, `pad:${b.by}.num`, money(b.amount), { on: FULL }),
      anim(0, `pad:${b.by}`, b.forced ? 'paddle.ScrewRaise' : raiseOf(l.lot, b.amount), {
        on: FULL,
      }),
      text(0, 'bidAmount.text', money(b.amount), { on: STAGE }),
      anim(0, 'bidAmount', 'bidAmount.Update', { on: STAGE }),
      anim(0, 'bidFrom', i === 0 ? 'bidFrom.Appear' : 'bidFrom.Update', { on: STAGE }),
      // The next ask swaps in as the bar slides back (the original swaps it at the turn).
      anim(0, 'bidPrompt', 'bidPrompt.Swap', { on: STAGE }),
      text(300, 'bidPrompt.text', `${money(b.amount + BID_STEP)}?`, { on: STAGE }),
    ];
    if (i === 0)
      steps.push(
        anim(0, 'bidLabel', 'bidLabel.Swap', { on: STAGE }),
        text(160, 'bidLabel.text', 'Current bid', { on: STAGE }),
      );
    if (before && before.by !== b.by)
      steps.push(
        anim(0, `pad:${before.by}`, b.forced ? 'paddle.ScrewUnraise' : 'paddle.Unraise', {
          on: FULL,
        }),
      );
    // Outbid and screwed buzzes are the phone's own (`Alerts`), so no personal steps here.
    out.push({ id: `${l.key}:bid${b.amount}`, at, steps });
  });
  return out;
}

/** Aiming a screw: the room darkens and a spotlight drops on the screwer. */
function screwAim(view: GoingOnceView): Moment[] {
  const a = view.game?.auction;
  if (!a?.screw) return [];
  const by = a.screw.by;
  return [
    {
      id: `lot${a.lot}:aim${a.since}`,
      at: a.since,
      steps: [
        dim(0, 0.55),
        anim(0, `spot:${by}`, 'spot.Appear', { on: STAGE }),
        anim(0, `screws:${by}`, 'screws-d1.ScrewStart', { on: STAGE }),
      ],
    },
  ];
}

/**
 * A screw that landed (the victim's forced bid) or failed: the screw flies the seats between them
 * and drills in, or tumbles off; the light comes back.
 */
function screwOutcome(view: GoingOnceView): Moment[] {
  const g = view.game!;
  const a = g.auction;
  const last = view.log.at(-1);
  if (!a || a.screw || last?.kind !== 'screw' || last.lot !== a.lot) return [];
  const from = g.order.indexOf(last.by);
  const to = last.target ? g.order.indexOf(last.target) : from;
  const d = Math.max(1, Math.min(5, Math.abs(to - from)));
  const fly = `screws-d1.${to > from ? 'Right' : 'Left'}${d}` as const;
  const ok = last.outcome === 'forced';
  return [
    {
      id: `lot${a.lot}:screw${last.id}`,
      at: a.since,
      steps: [
        anim(0, `spot:${last.by}`, 'spot.Disappear', { on: STAGE }),
        dim(0, 0),
        anim(0, `screws:${last.by}`, ok ? fly : 'screws-d1.ScrewFail', { on: STAGE }),
      ],
    },
  ];
}

/**
 * The hammer: the stamp slams onto the picture with the bell, spins round to the value (counting
 * up from the price on the table screen), PROFIT or LOSS pops under it, the artist's paddle turns
 * round to say ARTIST and their commission rises from it, and the stamp leaves with the picture.
 * Unsold: the picture just leaves. Beats as the sound's (`SOLD_BEAT_MS`), so the bell, the spin
 * and the profit line land together.
 */
export function soldMoment(view: GoingOnceView): Moment | null {
  const g = view.game;
  const r: LotResult | undefined = g?.results.at(-1);
  if (!g || g.stage !== 'sold' || !r) return null;
  const beat = SOLD_BEAT_MS * (view.rig?.scale ?? 1);
  const len = Math.max(beat * 5, g.until - g.since);
  const id = `sold${r.index}`;
  if (!r.buyer)
    return {
      id,
      at: g.since,
      steps: [
        anim(600, 'painting', 'painting.Disappear'),
        anim(0, 'bidPrompt', 'bidPrompt.Disappear', { on: STAGE }),
        anim(0, 'bidAmount', 'bidAmount.Disappear', { on: STAGE }),
        anim(0, 'bidLabel', 'bidLabel.Disappear', { on: STAGE }),
      ],
    };
  const profit = r.value - r.price;
  const tone = profit > 0 ? 'good' : profit < 0 ? 'bad' : '';
  const line =
    profit > 0
      ? `PROFIT : ${money(profit)}`
      : profit < 0
        ? `LOSS : ${money(-profit)}`
        : 'BROKE EVEN';
  const spin = beat * 2;
  const swap = spin + 300;
  const out = len - Math.max(MS.paintingOut, profit >= 0 ? MS.stampGood : MS.stampBad) - 150;
  const steps: Step[] = [
    set(0, 'stamp', 'data-face', 'sold'),
    set(0, 'stamp.slab', 'data-tone', ''),
    text(0, 'stamp.word', 'SOLD!'),
    text(0, 'stamp.line', ''),
    anim(0, 'stamp', 'stamp.Appear'),
    anim(0, 'bidPrompt', 'bidPrompt.RackUp', { on: STAGE }),
    text(0, 'bidLabel.text', 'Winning bid', { on: STAGE }),
    anim(0, 'bidLabel', 'bidLabel.Swap', { on: STAGE }),
    anim(0, `pad:${r.buyer}`, 'paddle.Done', { on: FULL }),
    // The value: the table screen's stamp spins round to it and flies to the middle of the room;
    // a phone's stays on its picture and pops.
    // The original flies the value to the middle of the room; ours spins in place over the
    // painting, so the row and the bid stay readable.
    {
      t: spin,
      kind: 'css',
      target: 'stampSpin',
      keyframes: [
        { transform: 'rotate(0deg) scale(1)' },
        { transform: 'rotate(-200deg) scale(1.25)', offset: 0.5 },
        { transform: 'rotate(-360deg) scale(1.45)' },
      ],
      ms: 867,
      easing: 'ease-out',
      on: STAGE,
    },
    {
      t: swap,
      kind: 'css',
      target: 'stamp.word',
      keyframes: [
        { transform: 'translate(-50%,-50%) scale(1)' },
        { transform: 'translate(-50%,-50%) scale(1.25)' },
        { transform: 'translate(-50%,-50%) scale(1)' },
      ],
      ms: 300,
      on: PHONES,
    },
    set(swap, 'stamp', 'data-face', 'value'),
    set(swap, 'stamp.slab', 'data-tone', tone),
    // What the table screen last showed sold, on its room (a lasting mark for tests and tools).
    set(swap, 'room', 'data-sold', `${r.index}:${tone || 'even'}`, { on: STAGE }),
    {
      t: swap,
      kind: 'count',
      target: 'stamp.word',
      from: r.price,
      to: r.value,
      ms: 600,
      format: 'money',
      on: STAGE,
    },
    text(swap, 'stamp.word', money(r.value), { on: PHONES }),
    text(beat * 3, 'stamp.line', line, { on: FULL }),
    anim(beat * 3, 'stamp.lineL', 'profit.Appear', { on: FULL }),
    // The buyer's own phone: the profit or loss lands with a tap.
    {
      t: beat * 3,
      kind: 'haptic',
      pattern: profit >= 0 ? [20] : [40, 40, 40],
      for: r.buyer,
      on: PHONES,
    },
    // Its exit, from where ours spun to: a good buy shrinks away, a bad one spins off.
    {
      t: out,
      kind: 'css',
      target: 'stampSpin',
      keyframes:
        profit >= 0
          ? [{ transform: 'scale(1.45)' }, { transform: 'scale(0.2)', opacity: 0 }]
          : [{ transform: 'scale(1.45)' }, { transform: 'rotate(-169deg) scale(1)', opacity: 0 }],
      ms: profit >= 0 ? MS.stampGood : MS.stampBad,
      easing: 'ease-in',
      on: STAGE,
    },
    anim(out + 100, 'painting', 'painting.Disappear', { on: STAGE }),
    anim(out, 'bidAmount', 'bidAmount.Disappear', { on: STAGE }),
    anim(out, 'bidFrom', 'bidFrom.Disappear', { on: STAGE }),
    anim(out, 'bidLabel', 'bidLabel.Disappear', { on: STAGE }),
    anim(out, `pad:${r.buyer}`, 'paddle.DoneOff', { on: FULL }),
  ];
  if (r.artistKnown && r.artist) {
    const artist = r.artist;
    steps.push(
      anim(beat * 4, `pad:${artist}`, 'paddle.Flip', { on: FULL }),
      text(beat * 4 + MS.flipEdge, `pad:${artist}.num`, 'ARTIST', { on: FULL }),
      // Back down once the flip has been seen (a short Sold card still lets it finish).
      text(Math.max(out, beat * 4 + 900), `pad:${artist}.num`, '', { on: FULL }),
      anim(Math.max(out, beat * 4 + 900), `pad:${artist}`, 'paddle.DoneOff', { on: FULL }),
    );
    if (r.commission > 0)
      steps.push(
        text(beat * 4 + 500, `artpay:${artist}.text`, `+${money(r.commission)}`, { on: FULL }),
        anim(beat * 4 + 500, `artpay:${artist}`, 'artpay.Appear', { on: FULL }),
        { t: beat * 4 + 500, kind: 'haptic', pattern: [15, 40, 15], for: artist, on: PHONES },
      );
  }
  // Quiet phones drop the table's beats they don't draw (nothing to aim them at), and the
  // player's own cues stay theirs.
  return { id, at: g.since, steps };
}

/** Half-time: the room darkens and every paddle gets its screw. */
function halftime(view: GoingOnceView): Moment[] {
  const g = view.game!;
  if (g.stage !== 'halftime') return [];
  return [
    {
      id: `half:${g.since}`,
      at: g.since,
      steps: [
        anim(0, 'camera', 'stage.ZoomOut', { on: STAGE }),
        dim(0, 0.55),
        ...g.order.flatMap((id, i) => [
          anim(300 + i * 120, `screws:${id}`, 'screws-d1.Appear', { on: STAGE }),
          anim(1100 + i * 120, `screws:${id}`, 'screws-d1.Down', { on: STAGE }),
        ]),
        dim(2600, 0, 500),
      ],
    },
  ];
}

/** The bank: on its first visit the sign types itself in and the shark bursts out; later, a quick one. */
function bank(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game!;
  if (g.stage !== 'bank') return [];
  // The first visit is the long one (BANK_FIRST_MS); called visits are short.
  const first = g.until - g.since > BANK_LATER_MS * (view.rig?.scale ?? 1) + 500;
  const label = first ? 'Appear' : 'Appear2';
  return [
    {
      id: `bank:${g.since}`,
      at: g.since,
      steps: [
        anim(0, 'camera', 'stage.ZoomOut', { on: STAGE }),
        dim(0, 0.55),
        ...BANK_PARTS.map((p) => anim(0, `bank-${p}`, `bank-${p}.${label}`, { on: STAGE })),
        ...BANK_PARTS.flatMap((p) =>
          (ctx.swaps?.[`bank-${p}`]?.[label] ?? []).map(([ms, face]) =>
            set(ms, `bank-${p}`, 'data-show', face, { on: STAGE }),
          ),
        ),
        { t: 0, kind: 'haptic', pattern: [20, 60, 20], for: 'you', on: ['phone-full'] },
      ],
    },
  ];
}

/** The bank's moving parts (the rig's `bank-*` tracks). */
export const BANK_PARTS = ['loans', 'd4', 'tory', 'pred', 'a', 'd35'];

/** The drawing: the hourglass drops in and the sign swings down (each seat's tick is the page's). */
function drawing(view: GoingOnceView): Moment[] {
  const g = view.game!;
  if (g.stage !== 'draw') return [];
  return [
    {
      id: `draw:${g.since}`,
      at: g.since,
      steps: [anim(0, 'timer', 'timer.Appear'), anim(300, 'sign', 'sign.Appear', { on: STAGE })],
    },
  ];
}

/** A buyer's art at the end: one, two or three pictures (the original's layouts), the first three. */
export const endTrack = (n: number, k: number) => (n === 1 ? 'art1' : `art${n}-painting${k}`);

/**
 * The end: each buyer's art slides in, each title and value pops, the values fly down into the
 * buyer's total; then everyone's totals line up, the shark bites the debts off, and the winners
 * spring up in the light.
 */
function end(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game!;
  const times = endTimes(view);
  if (!times || !g.final) return [];
  const step = RACKUP_BEAT_MS * (view.rig?.scale ?? 1);
  const out: Moment[] = [];
  const buyers = g.final.filter((f) => f.bought.length > 0);
  buyers.forEach((f, i) => {
    const items = f.bought.slice(0, 3);
    const n = items.length;
    // Everything they bought counts; the layout shows the first three.
    const art = f.art;
    out.push({
      id: `end:${g.since}:buyer${i}`,
      at: g.since + i * step,
      steps: [
        ...(i === 0 ? [anim(0, 'camera', 'stage.ZoomOut', { on: STAGE })] : []),
        {
          t: 0,
          kind: 'css',
          target: `endtotal:${i}`,
          keyframes: [{ opacity: 1 }],
          ms: 200,
          on: STAGE,
        },
        text(0, `endtotal:${i}.num`, '', { on: STAGE }),
        ...items.flatMap((_, k) => [
          anim(0, `end:${i}:${k}`, `${endTrack(n, k)}.Appear`, { on: STAGE }),
          anim(450 + k * 120, `end:${i}:${k}.name`, 'endpic-drawingName.NameOn', { on: STAGE }),
          anim(650 + k * 120, `end:${i}:${k}.price`, 'endpic-price.ValueOn', { on: STAGE }),
          anim(950 + k * 120, `end:${i}:${k}.price`, 'endpic-price.Score', { on: STAGE }),
        ]),
        // The total counts up as the values fly into it.
        {
          t: 950,
          kind: 'count',
          target: `endtotal:${i}.num`,
          from: 0,
          to: art,
          ms: 700,
          format: 'money',
          on: STAGE,
        },
        anim(1300, `endtotal:${i}.thump`, 'total-score.RackUp', { on: STAGE }),
        ...items.map((_, k) =>
          anim(step - 450, `end:${i}:${k}`, `${endTrack(n, k)}.Disappear`, { on: STAGE }),
        ),
        {
          t: step - 300,
          kind: 'css',
          target: `endtotal:${i}`,
          keyframes: [{ opacity: 0 }],
          ms: 250,
          on: STAGE,
        },
      ],
    });
  });
  out.push({
    id: `end:${g.since}:finale`,
    at: times.sum,
    steps: [
      ...(buyers.length ? [] : [anim(0, 'camera', 'stage.ZoomOut', { on: STAGE })]),
      ...g.final.flatMap((f, i) => [
        text(0, `finale:${f.id}.score`, money(f.score + f.debt), { on: STAGE }),
        anim(i * 250, `finale:${f.id}`, 'finale-content.Appear', { on: STAGE }),
        anim(i * 250, `finale:${f.id}.scoreL`, 'finale-score.Appear', { on: STAGE }),
      ]),
      ...g.final.flatMap((f) =>
        f.debt > 0
          ? [
              anim(step, `finale:${f.id}.shark`, 'finale-d7.Debt', { on: STAGE }),
              anim(step, `finale:${f.id}.debtL`, 'finale-debt.Debt', { on: STAGE }),
              anim(step, `finale:${f.id}.scoreL`, 'finale-score.Debt', { on: STAGE }),
              text(step + 300, `finale:${f.id}.score`, money(f.score), { on: STAGE }),
            ]
          : [],
      ),
      // Your own total, on your phone.
      ...(ctx.you && g.final.some((f) => f.id === ctx.you)
        ? [{ t: 0, kind: 'haptic', pattern: [15], for: ctx.you, on: PHONES } as Step]
        : []),
    ],
  });
  out.push({
    id: `end:${g.since}:winner`,
    at: times.winner,
    steps: [
      dim(0, 0.6, 400),
      ...g.final.map((f) => anim(0, `finale:${f.id}`, 'finale-content.Disappear', { on: STAGE })),
      ...g.final.map((f) =>
        anim(0, `finale:${f.id}.scoreL`, 'finale-score.Disappear', { on: STAGE }),
      ),
      ...g.winners.map((id, i) =>
        anim(300 + i * 100, `win:${id}`, 'winning-content.Appear', { on: STAGE }),
      ),
      { t: 300, kind: 'css', target: 'winline', keyframes: [{ opacity: 1 }], ms: 400, on: STAGE },
      { t: 300, kind: 'confetti', n: 50, on: STAGE },
      ...(ctx.you && g.winners.includes(ctx.you)
        ? [
            {
              t: 300,
              kind: 'haptic',
              pattern: [30, 60, 30, 60, 90],
              for: ctx.you,
              on: PHONES,
            } as Step,
          ]
        : []),
    ],
  });
  return out;
}

/** Players joining in the lobby: each paddle pops up into the row as its player sits down. */
function lobby(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  if (view.phase !== 'lobby') return [];
  return view.seats
    .filter((s) => s.playing)
    .map((s) => ({
      id: `login:${s.id}`,
      at: ctx.joined?.[s.id] ?? 0,
      steps: [anim(0, `login:${s.id}`, 'login.Appear', { on: STAGE })],
    }));
}

/**
 * Every moment the view calls for on this device, oldest first. Moments are built for every
 * profile; `schedule` (in `@vt/ui/show`) plays each step only where its `on` and `for` allow.
 */
export function moments(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return lobby(view, ctx);
  const out: Moment[] = [...drawing(view)];
  const l = lotOf(view);
  if (l) {
    out.push(lotIn(view, l));
    if (!l.intro) out.push(paintingIn(view, l));
    out.push(...bids(l), ...screwAim(view), ...screwOutcome(view));
  }
  const sold = soldMoment(view);
  if (sold) out.push(sold);
  out.push(...halftime(view), ...bank(view, ctx), ...end(view, ctx));
  return out;
}
