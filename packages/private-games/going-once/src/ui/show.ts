import {
  type Frame,
  type Moment,
  type Profile,
  type Rig,
  type Step,
  variantOf,
} from '@vt/game-sdk/show';
import {
  type AuctionView,
  BANK_LATER_MS,
  BID_STEP,
  type GoingOnceView,
  type LotResult,
  OPENING_BID,
} from '../logic/types.ts';
import {
  BEAT,
  FINALE_GAP_MS,
  LOBBY,
  endBeats,
  endTimes,
  lotOutAt,
  openingTimes,
  soldBeatsOf,
  soldOutAt,
  tutorialTimes,
} from './audio.ts';

// Going Once's show as data: every beat the table screen and the phones animate, built purely from
// the view on the server clock (the same moments the sound in `audio.ts` keys its cues to: the
// stamp lands with the bell, the value spins with its effect, and so on), so every device shows
// the same beat at the same instant and a device that arrives late lands on the same frame. The
// parts named here are the rig's (`private-assets/tools/showkit_export.py`) and the layers
// `Stage.tsx` and the phone's overlays register under these target names:
//   camera, dim, walldim, beam · logo, countdown, countdown.num · lot, lot.num, phone, ring ·
//   painting, stamp, stamp.slab, stamp.word, stamp.lineL, stamp.line, title.by
//   bidPrompt, bidAmount, bidFrom · phone · timer, timeNum, sign · bank-<part>
//   chair:<id>, name:<id>, pad:<id>, pad:<id>.num, pad:<id>.word, artpay:<id>, artpay:<id>.text, screws:<id>,
//   screwhead:<id>,
//   spot:<id> · finale:<id>, finale:<id>.debt, win:<id>, win:<id>.plate, end:<buyer>, endpic:<item>,
//   total:<buyer>, total.num
// Moments only move things and set words; what lasts (whose paddle is whose, the amounts, the
// names) the views render, so a moment that never ran leaves a correct page.

const STAGE: Profile[] = ['stage'];
const PHONES: Profile[] = ['phone-quiet', 'phone-full'];
const FULL: Profile[] = ['stage', 'phone-full'];

/** The original's clip lengths (30 fps) that timings below wait on. */
const MS = {
  ...BEAT,
  phoneIn: 533,
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
  /** When this device first showed the lobby (the table screen's lobby opens then). */
  openedAt?: number;
  /** The rig's mid-track art swaps (the bank's sign turning into the shark's). */
  swaps?: Rig['swaps'];
  /**
   * The table screen's raise caps: for a player's paddle track (`paddle.Raise2`), how far down to
   * hold the paddle on each of its frames so it never covers the next ask (`raiseCap`), or null.
   */
  caps?: (id: string, track: string) => RaiseCap | null;
}

/** The lot on the easel. */
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
/**
 * The room darkening or lightening: a black veil over everything (ours, for the bank). The
 * original's own darkens tint only the wall behind (`wall`).
 */
const dim = (t: number, to: number, ms = 300): Step => ({
  t,
  kind: 'css',
  target: 'dim',
  keyframes: [{ opacity: to }],
  ms,
  on: STAGE,
});
/**
 * The wall darkening (the original's `Darken*` tracks multiply only the wall, to 40 %; the
 * paintings, chairs and paddles stay lit): a veil over the background alone.
 */
const wall = (t: number, dark: boolean, ms: number): Step => ({
  t,
  kind: 'css',
  target: 'walldim',
  keyframes: [{ opacity: dark ? WALL_DARK : 0 }],
  ms,
  on: STAGE,
});
/** The original's darkened wall: multiplied by 0.398. */
export const WALL_DARK = 0.6;
const set = (t: number, target: string, attr: string, value: string, more: Partial<Step> = {}) =>
  ({ t, kind: 'set', target, attr, value, ...more }) as Step;

/**
 * The lot coming up, in the original's order: the camera closes in, the LOT disc drops with its
 * number, the phone slides in and rings (the tips going out), and the disc rises away before the
 * picture goes up (`paintingIn`, when the intro ends).
 */
function lotIn(view: GoingOnceView, l: Lot): Moment {
  const g = view.game!;
  const a = g.auction!;
  const at = introAt(view);
  // The disc leaves as the intro ends (after it has landed), so the painting comes up on its own.
  const out = a.close === 'intro' ? lotOutAt(a) : MS.lotIn + 600;
  const phone = MS.lotIn - 300;
  return {
    id: `${l.key}:in`,
    at,
    steps: [
      text(0, 'lot.num', l.label),
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
      ...g.order.flatMap((id) => [
        text(0, `pad:${id}.num`, '', { on: FULL }),
        text(0, `pad:${id}.word`, '', { on: FULL }),
      ]),
      // The bank's veil lifts as the next lot comes in.
      dim(0, 0),
      anim(0, 'camera', 'stage.ZoomIn', { on: STAGE }),
      anim(0, 'lot', 'lot.Appear'),
      // The tips going out: the phone slides in and rings (not on lot 1 when they came during
      // the tutorial, as the original's lot 1).
      ...(a.lot === 0 && g.tipsEarly
        ? []
        : [
            anim(phone, 'phone', 'phone.Appear', { on: STAGE }),
            anim(phone + MS.phoneIn, 'ring', 'ring-d7.Ring', { on: STAGE }),
          ]),
      anim(out, 'lot', 'lot.Disappear', { on: STAGE }),
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

/**
 * The picture sliding in onto its spot (the phone going away), then, once it has landed, the
 * opening bid sliding in beside it: the original's order.
 */
function paintingIn(view: GoingOnceView, l: Lot): Moment {
  const a = view.game!.auction;
  const opened = a && a.close === 'open' && !a.bid ? a.since : l.since - 60_000;
  const t = MS.paintingIn;
  return {
    id: `${l.key}:painting`,
    at: opened,
    steps: [
      anim(0, 'painting', 'painting.Appear'),
      ...(l.lot === 0 && view.game!.tipsEarly
        ? []
        : [anim(0, 'phone', 'phone.Disappear', { on: STAGE })]),
      text(0, 'bidLabel.text', 'Opening Bid', { on: STAGE }),
      text(0, 'bidAmount.text', money(OPENING_BID), { on: STAGE }),
      text(0, 'bidPrompt.text', `${money(OPENING_BID)}?`, { on: STAGE }),
      anim(t, 'bidLabel', 'bidLabel.Appear', { on: STAGE }),
      anim(t + 50, 'bidAmount', 'bidAmount.Appear', { on: STAGE }),
      anim(t + 100, 'bidPrompt', 'bidPrompt.Appear', { on: STAGE }),
    ],
  };
}

/** The auctioneer's calls in the grey line under the amount: "Going Once…", "Going Twice…". */
export const CALL_WORDS = { once: 'Going Once…', twice: 'Going Twice…' } as const;

function calls(l: Lot): Moment[] {
  if (l.close !== 'once' && l.close !== 'twice') return [];
  return [
    {
      id: `${l.key}:${l.close}${l.bid?.amount ?? 0}`,
      at: l.since,
      steps: [
        anim(0, 'bidPrompt', 'bidPrompt.Swap', { on: STAGE }),
        text(300, 'bidPrompt.text', CALL_WORDS[l.close], { on: STAGE }),
      ],
    },
  ];
}

/**
 * The lot's newest bid: the bidder's paddle shoots up (their wobble from the amount) and comes back
 * down a second later, the amount pops with the leader's shape spinning in. Only the newest gets a moment:
 * older bids are long played and their lasting result is already on the paddles; a moment that
 * leaves the list settles where it ended (its paddle parked again), so a bid beaten within the
 * second lands its paddle at once.
 */
function bids(l: Lot, ctx?: ShowCtx): Moment[] {
  const i = l.recent.length - 1;
  const b = l.recent[i];
  if (!b) return [];
  const before = l.recent[i - 1];
  const first = i === 0;
  const steps: Step[] = [
    text(0, `pad:${b.by}.num`, money(b.amount), { on: FULL }),
    anim(0, `pad:${b.by}`, b.forced ? 'paddle.ScrewRaise' : raiseOf(l.lot, b.amount), {
      on: FULL,
    }),
    text(0, 'bidAmount.text', money(b.amount), { on: STAGE }),
    anim(0, 'bidAmount', 'bidAmount.Update', { on: STAGE }),
    // The leader's name on their chair lights up (the one they beat dims).
    anim(0, `name:${b.by}`, 'name.Bid', { on: STAGE }),
    anim(0, 'bidFrom', first ? 'bidFrom.Appear' : 'bidFrom.Update', { on: STAGE }),
    // The next ask swaps in as the bar slides back (the original swaps it at the turn).
    anim(0, 'bidPrompt', 'bidPrompt.Swap', { on: STAGE }),
    text(300, 'bidPrompt.text', `${money(b.amount + BID_STEP)}?`, { on: STAGE }),
  ];
  if (first)
    steps.push(
      anim(0, 'bidLabel', 'bidLabel.Swap', { on: STAGE }),
      text(160, 'bidLabel.text', 'Current Bid', { on: STAGE }),
    );
  // The paddle goes back down behind the chair (the original's: up and down again); the name and
  // the TOP shape keep showing the leader.
  const down = b.forced ? 'paddle.ScrewUnraise' : 'paddle.Unraise';
  steps.push(anim(BEAT.paddleDown, `pad:${b.by}`, down, { on: FULL }));
  // On the table screen a paddle under the next ask is held low enough, frame by frame, that it
  // never covers it (the owner's rule: nothing covers the price you would bid).
  const up = b.forced ? 'paddle.ScrewRaise' : raiseOf(l.lot, b.amount);
  for (const [t, track] of [
    [0, up],
    [BEAT.paddleDown, down],
  ] as const) {
    const cap = ctx?.caps?.(b.by, track);
    if (cap)
      steps.push({
        t,
        kind: 'css',
        target: `padcap:${b.by}`,
        keyframes: cap.ys.map((y) => ({ transform: `translate(0px, ${y}px)` })),
        ms: cap.ms,
        easing: 'linear',
        on: STAGE,
      });
  }
  if (before && before.by !== b.by)
    steps.push(anim(0, `name:${before.by}`, 'name.Reset', { on: STAGE }));
  // Outbid and screwed buzzes are the phone's own (`Alerts`), so no personal steps here.
  const at = l.bid?.amount === b.amount ? l.since : l.since - 60_000;
  return [{ id: `${l.key}:bid${b.amount}`, at, steps }];
}

/** Aiming a screw: the wall darkens (the original's DarkenScrew) and a spotlight drops on the screwer. */
function screwAim(view: GoingOnceView): Moment[] {
  const a = view.game?.auction;
  if (!a?.screw) return [];
  const by = a.screw.by;
  return [
    {
      id: `lot${a.lot}:aim${a.since}`,
      at: a.since,
      steps: [
        wall(0, true, 133),
        anim(0, `spot:${by}`, 'spot.Appear', { on: STAGE }),
        anim(0, `screws:${by}`, 'screws-d1.ScrewStart', { on: STAGE }),
        // The screw's head leaves the chair as the screw comes out of it.
        anim(0, `screwhead:${by}`, 'screws-mc.ScrewStart', { on: STAGE }),
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
        wall(0, false, 133),
        anim(0, `screws:${last.by}`, ok ? fly : 'screws-d1.ScrewFail', { on: STAGE }),
      ],
    },
  ];
}

/**
 * The hammer: the stamp slams onto the picture with the bell, the artist's paddle turns round to
 * say ARTIST and their commission rises from it, the stamp spins round to the value (counting up
 * from the price on the table screen), PROFIT or LOSS pops under it, and the stamp leaves with the
 * picture: the original's order, on the server's beats (`soldBeatsOf`, which voiced follow the
 * lines) as the sound's, so the bell, the spin and the profit line land together. Unsold: the
 * picture just leaves.
 */
export function soldMoment(view: GoingOnceView): Moment | null {
  const g = view.game;
  const r: LotResult | undefined = g?.results.at(-1);
  if (!g || g.stage !== 'sold' || !r) return null;
  const beats = soldBeatsOf(view, r.artistKnown && r.artist !== null);
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
  const spin = beats.value;
  const swap = spin + 300;
  const out = soldOutAt(view, profit);
  const steps: Step[] = [
    set(0, 'stamp', 'data-face', 'sold'),
    set(0, 'stamp.slab', 'data-tone', ''),
    text(0, 'stamp.word', 'SOLD!'),
    text(0, 'stamp.line', ''),
    anim(0, 'stamp', 'stamp.Appear'),
    anim(0, 'bidPrompt', 'bidPrompt.RackUp', { on: STAGE }),
    text(0, 'bidLabel.text', 'Winning Bid', { on: STAGE }),
    anim(0, 'bidLabel', 'bidLabel.Swap', { on: STAGE }),
    anim(0, `pad:${r.buyer}`, 'paddle.Done', { on: FULL }),
    // The buyer's paddle says WINNER, as the original's does (its words smaller than an amount),
    // and the TOP shape goes with the bidding.
    text(0, `pad:${r.buyer}.num`, '', { on: FULL }),
    text(0, `pad:${r.buyer}.word`, 'WINNER', { on: FULL }),
    anim(0, 'bidFrom', 'bidFrom.Disappear', { on: STAGE }),
    // The value, as the original's: the table screen's slab spins, grows to the middle of the room
    // (its face swapping to the value mid-spin) with PROFIT or LOSS under it on the slab; a phone's
    // stays on its picture and pops.
    anim(spin, 'stamp', 'stamp.Value', { on: STAGE }),
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
    text(beats.profit, 'stamp.line', line, { on: FULL }),
    anim(beats.profit, 'stamp.lineL', 'profit.Appear', { on: FULL }),
    // The buyer's own phone: the profit or loss lands with a tap.
    {
      t: beats.profit,
      kind: 'haptic',
      pattern: profit >= 0 ? [20] : [40, 40, 40],
      for: r.buyer,
      on: PHONES,
    },
    // Its exit, as the original's: a good buy (under the value) shrinks away, else it spins off.
    anim(out, 'stamp', profit > 0 ? 'stamp.Good' : 'stamp.Bad', { on: STAGE }),
    anim(out + 100, 'painting', 'painting.Disappear', { on: STAGE }),
    anim(out, 'bidAmount', 'bidAmount.Disappear', { on: STAGE }),
    anim(out, 'bidLabel', 'bidLabel.Disappear', { on: STAGE }),
    anim(out, `pad:${r.buyer}`, 'paddle.DoneOff', { on: FULL }),
    anim(out, `name:${r.buyer}`, 'name.Reset', { on: STAGE }),
    // The lot's amounts come off the paddles as it leaves (the artist's sign comes off below).
    ...g.order
      .filter((id) => !(r.artistKnown && id === r.artist))
      .flatMap((id) => [
        text(out, `pad:${id}.num`, '', { on: FULL }),
        text(out, `pad:${id}.word`, '', { on: FULL }),
      ]),
  ];
  if (r.artistKnown && r.artist && beats.artist !== null) {
    const artist = r.artist;
    const at = beats.artist;
    steps.push(
      anim(at, `pad:${artist}`, 'paddle.Flip', { on: FULL }),
      text(at + MS.flipEdge, `pad:${artist}.num`, '', { on: FULL }),
      text(at + MS.flipEdge, `pad:${artist}.word`, 'ARTIST', { on: FULL }),
      // The title's "by …" waits for the flip, as the auctioneer reveals the artist.
      {
        t: at + MS.flipEdge,
        kind: 'css',
        target: 'title.by',
        keyframes: [{ opacity: 1 }],
        ms: 300,
        on: STAGE,
      },
      // Back down once the flip has been seen (a short Sold card still lets it finish).
      text(Math.max(out, at + 900), `pad:${artist}.word`, '', { on: FULL }),
      anim(Math.max(out, at + 900), `pad:${artist}`, 'paddle.DoneOff', { on: FULL }),
    );
    if (r.commission > 0)
      steps.push(
        text(at + 500, `artpay:${artist}.text`, `+${money(r.commission)}`, { on: FULL }),
        anim(at + 500, `artpay:${artist}`, 'artpay.Appear', { on: FULL }),
        { t: at + 500, kind: 'haptic', pattern: [15, 40, 15], for: artist, on: PHONES },
      );
  }
  // Quiet phones drop the table's beats they don't draw (nothing to aim them at), and the
  // player's own cues stay theirs.
  return { id, at: g.since, steps };
}

/**
 * Half-time, as the original: the camera pulls back to the empty wall and a screw drops into every
 * chair at once and drills in (no card on the table screen; the auctioneer explains).
 */
function halftime(view: GoingOnceView): Moment[] {
  const g = view.game!;
  if (g.stage !== 'halftime') return [];
  return [
    {
      id: `half:${g.since}`,
      at: g.since,
      steps: [
        anim(0, 'camera', 'stage.ZoomOut', { on: STAGE }),
        ...g.order.flatMap((id) => [
          anim(MS.screwsIn - 500, `screws:${id}`, 'screws-d1.Appear', { on: STAGE }),
          anim(MS.screwsIn, `screws:${id}`, 'screws-d1.Down', { on: STAGE }),
          // Its head shows in the chair once it has gone in (the original's mark of a screw held).
          anim(MS.screwsIn, `screwhead:${id}`, 'screws-mc.Down', { on: STAGE }),
        ]),
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
function drawing(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game!;
  const o = openingTimes(view);
  if (!o) return [];
  const at = (t: number) => Math.max(0, t - g.since);
  const doodle = (ctx.swaps?.['doodle-d2']?.Appear ?? []).map(([ms, face]) =>
    set(at(o.signIn) + SIGN_IN_MS + ms, 'doodle', 'data-show', face, { on: STAGE }),
  );
  return [
    {
      id: `draw:${g.since}`,
      at: g.since,
      steps: [
        // The start, as the original's: the sign, its words and the paddles leave the lobby, the
        // logo grows to the middle and the chairs pop up from below with the names; the paddles
        // cascade as the auctioneer teases the guests, and the logo goes as the sign drops in.
        ...(o.redraw
          ? []
          : [
              anim(0, 'easel.stand', 'easel-d1.Disappear', { on: STAGE }),
              anim(0, 'easel.card', 'easel-content.Disappear', { on: STAGE }),
              anim(0, 'address', 'address.Disappear', { on: STAGE }),
              anim(0, 'press', 'pressToPlay.Disappear', { on: STAGE }),
              ...[0, 1, 2, 3, 4, 5].map((i) =>
                anim(0, `circle:${i}`, 'circle.Disappear', { on: STAGE }),
              ),
              ...g.order.map((id, i) =>
                anim(0, `leave:${id}`, i % 2 ? 'login.DisappearRight' : 'login.DisappearLeft', {
                  on: STAGE,
                }),
              ),
              anim(0, 'logo', 'logo.Enlarge', { on: STAGE }),
              anim(at(o.logoOut), 'logo', 'logo.Disappear', { on: STAGE }),
              ...g.order.flatMap((id) => [
                anim(0, `chair:${id}`, 'seat-d7.Appear', { on: STAGE }),
                anim(0, `name:${id}.seat`, 'seat-playerName.Appear', { on: STAGE }),
              ]),
              ...g.order.map((id, i) =>
                anim(at(o.cascade!) + i * CASCADE_GAP_MS, `pad:${id}`, 'paddle.Cascade', {
                  on: STAGE,
                }),
              ),
            ]),
        // The sign drops in and its example draws itself; the line comes with the instructions;
        // then it rises away as the hourglass drops in.
        set(0, 'doodle', 'data-show', ctx.swaps?.['doodle-d2']?.Appear?.[0]?.[1] ?? 'doodle-d2', {
          on: STAGE,
        }),
        anim(at(o.signIn), 'sign', 'sign.Appear', { on: STAGE }),
        ...doodle,
        anim(at(o.prompt), 'prompt', 'prompt.Appear', { on: STAGE }),
        anim(at(o.signOut), 'sign', 'sign.Disappear', { on: STAGE }),
        anim(at(o.signOut), 'prompt', 'prompt.Disappear', { on: STAGE }),
        anim(at(o.timerIn), 'timer', 'timer.Appear'),
      ],
    },
    // Each player's paddle springs up with a word as their drawings are all in (a moment of its
    // own: it comes after the drawing's moment has started).
    ...g.players.flatMap((p): Moment[] =>
      p.doneAt
        ? [
            {
              id: `draw:${g.since}:done:${p.id}`,
              at: p.doneAt,
              steps: [
                text(0, `pad:${p.id}.word`, DONE_WORDS[variantOf(p.id, 4)]!, { on: STAGE }),
                anim(0, `pad:${p.id}`, 'paddle.Done', { on: STAGE }),
              ],
            },
          ]
        : [],
    ),
  ];
}

/** The sign dropping in (the rig's `sign.Appear`): its example starts drawing once it hangs still. */
const SIGN_IN_MS = 733;

/** The hourglass rising away (the rig's `timer.Disappear`). */
const TIMER_OUT_MS = 533;

/** What a player's paddle says when their drawings are in (the original's words). */
export const DONE_WORDS = ['READY!', 'FINISHED!', 'LET’S GO!', 'DONE!'] as const;
/** The opening's paddle cascade: each paddle a little after the one before (left to right). */
export const CASCADE_GAP_MS = 100;

/**
 * The drawing's end, as the tutorial or lot 1 begins (the original's "all paddles down" and the
 * hourglass rising away).
 */
function drawEnd(view: GoingOnceView): Moment[] {
  const g = view.game!;
  if (!g.drawEnded) return [];
  return [
    {
      id: `drawEnd:${g.drawEnded}`,
      at: g.drawEnded,
      steps: [
        ...g.players.flatMap((p) =>
          p.doneAt
            ? [
                anim(0, `pad:${p.id}`, 'paddle.DoneOff', { on: STAGE }),
                text(500, `pad:${p.id}.word`, '', { on: STAGE }),
              ]
            : [],
        ),
        anim(300, 'timer', 'timer.Disappear', { on: STAGE }),
        {
          t: 300 + TIMER_OUT_MS,
          kind: 'css',
          target: 'timer.gone',
          keyframes: [{ opacity: 0 }],
          ms: 150,
          on: STAGE,
        },
      ],
    },
  ];
}

/**
 * The tutorial on the table screen (`tutorialTimes`): the wall darkens, the projector comes on with
 * the logo slide and the Skip line, each slide slides up through the card with its line, and the
 * projector shuts off before the lights come up. A skip leaves the stage: the moment settles at
 * its end (lights up, projector off).
 */
function tutorial(view: GoingOnceView): Moment[] {
  const g = view.game!;
  const t = tutorialTimes(view);
  if (!t) return [];
  const at = (x: number) => Math.max(0, x - g.since);
  const slide = (n: number, from: number, to: number, when: number): Step => ({
    t: at(when),
    kind: 'css',
    target: `slide:${n}`,
    keyframes: [
      { transform: `translate(0px, ${from}px)` },
      { transform: `translate(0px, ${to}px)` },
    ],
    ms: SLIDE_MS,
    easing: 'ease-in-out',
    on: STAGE,
  });
  return [
    {
      id: `tutorial:${g.since}`,
      at: g.since,
      steps: [
        wall(at(t.dark), true, 567),
        anim(at(t.projector), 'projector.glow', 'tutorial-d1.Appear', { on: STAGE }),
        anim(at(t.projector), 'projector.dust', 'tutorial-d5.Appear', { on: STAGE }),
        anim(at(t.projector), 'projector.slides', 'tutorial-slide.Appear', { on: STAGE }),
        anim(at(t.projector), 'skip', 'skip.Appear', { on: STAGE }),
        // Slide 1 is up as the projector comes on; each next one pushes the last up and out.
        slide(1, 0, 0, t.projector),
        ...t.slides
          .slice(1)
          .flatMap((when, i) => [
            slide(i + 1, 0, -SLIDE_RISE, when),
            slide(i + 2, SLIDE_RISE, 0, when),
          ]),
        anim(at(t.off), 'projector.glow', 'tutorial-d1.Disappear', { on: STAGE }),
        anim(at(t.off), 'projector.dust', 'tutorial-d5.Disappear', { on: STAGE }),
        anim(at(t.off), 'projector.slides', 'tutorial-slide.Disappear', { on: STAGE }),
        anim(at(t.off), 'skip', 'skip.Disappear', { on: STAGE }),
        wall(at(t.light), false, 567),
        // Slide 10: the buzz on every phone as lot 1's tips arrive.
        { t: at(t.buzz), kind: 'haptic', pattern: [200, 100, 200], on: PHONES },
      ],
    },
  ];
}

/** A slide sliding up through the projector's card: 400 units in 667 ms (the original's strip). */
export const SLIDE_RISE = 400;
export const SLIDE_MS = 667;

/**
 * The 3-2-1 after Start, in the room's sign as the original's: the number takes the card's place
 * and the card bumps with each one (the clip's own beats).
 */
function countdown(view: GoingOnceView): Moment[] {
  const g = view.game!;
  if (g.stage !== 'countdown') return [];
  return [
    {
      id: `countdown:${g.since}`,
      at: g.since,
      steps: [
        text(0, 'easel.num', '3', { on: STAGE }),
        anim(0, 'easel.card', 'easel-content.Countdown', { on: STAGE }),
        text(1100, 'easel.num', '2', { on: STAGE }),
        anim(1100, 'easel.card', 'easel-content.Countdown', { on: STAGE }),
        text(2100, 'easel.num', '1', { on: STAGE }),
        anim(2100, 'easel.card', 'easel-content.Countdown', { on: STAGE }),
      ],
    },
  ];
}

/** A group of art at the end: one, two or three pictures (the original's layouts). */
export const endTrack = (n: number, k: number) => (n === 1 ? 'art1' : `art${n}-painting${k}`);

/**
 * The end, on `endTimes`' beats: each buyer's art slides in a group at a time, each title and
 * value pops, the values fly down into the buyer's total (counting up from their cash); then
 * everyone's totals line up, lowest first, the shark bites the debts off, and the winners spring
 * up in the light.
 */
function end(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game!;
  const times = endTimes(view);
  if (!times || !g.final) return [];
  const scale = view.rig?.scale ?? 1;
  const out: Moment[] = [];
  // The chairs drop away to show the floor as the end begins (the original's).
  out.push({
    id: `end:${g.since}:chairs`,
    at: g.since,
    steps: [
      // The bank's veil lifts (a game can end on a bank visit).
      dim(0, 0),
      anim(0, 'camera', 'stage.ZoomOut', { on: STAGE }),
      ...g.order.flatMap((id) => [
        anim(0, `endchair:${id}`, 'seat-d7.Disappear', { on: STAGE }),
        anim(0, `endchair:${id}.name`, 'seat-playerName.Disappear', { on: STAGE }),
      ]),
    ],
  });
  // Each buyer's paddle and total come up, then their art a group at a time, then they go.
  times.players.forEach((p, i) =>
    out.push({
      id: `end:${g.since}:buyer${i}`,
      at: p.in,
      steps: [
        {
          t: 0,
          kind: 'css',
          target: `endtotal:${i}`,
          keyframes: [{ opacity: 1 }],
          ms: 200,
          on: STAGE,
        },
        anim(0, `endtotal:${i}`, 'total-content.Appear', { on: STAGE }),
        anim(0, `endtotal:${i}.thump`, 'total-score.Appear', { on: STAGE }),
        anim(p.out - p.in, `endtotal:${i}`, 'total-content.Disappear', { on: STAGE }),
        anim(p.out - p.in, `endtotal:${i}.thump`, 'total-score.Disappear', { on: STAGE }),
      ],
    }),
  );
  times.groups.forEach((grp) => {
    const n = grp.items.length;
    const i = grp.buyer;
    const b = endBeats(n);
    const t = (ms: number) => ms * scale;
    out.push({
      id: `end:${g.since}:group${grp.index}`,
      at: grp.at,
      steps: [
        text(0, `endtotal:${i}.num`, money(grp.from), { on: STAGE }),
        ...grp.items.flatMap((_, k) => [
          anim(0, `end:${grp.index}:${k}`, `${endTrack(n, k)}.Appear`, { on: STAGE }),
          anim(t(b.names[k]!), `end:${grp.index}:${k}.name`, 'endpic-drawingName.NameOn', {
            on: STAGE,
          }),
          anim(t(b.values), `end:${grp.index}:${k}.price`, 'endpic-price.ValueOn', {
            on: STAGE,
          }),
          anim(t(b.fly), `end:${grp.index}:${k}.price`, 'endpic-price.Score', { on: STAGE }),
          anim(t(b.out), `end:${grp.index}:${k}`, `${endTrack(n, k)}.Disappear`, { on: STAGE }),
        ]),
        // The total counts up as the values fly into it, and thumps.
        {
          t: t(b.fly),
          kind: 'count',
          target: `endtotal:${i}.num`,
          from: grp.from,
          to: grp.to,
          ms: 700,
          format: 'money',
          on: STAGE,
        },
        anim(t(b.thump), `endtotal:${i}.thump`, 'total-score.RackUp', { on: STAGE }),
      ],
    });
  });
  const gap = FINALE_GAP_MS * scale;
  const byId = new Map(g.final.map((f) => [f.id, f]));
  out.push({
    id: `end:${g.since}:finale`,
    at: times.sum,
    steps: [
      ...times.finale.flatMap((id, i) => [
        text(0, `finale:${id}.score`, money(byId.get(id)!.score + byId.get(id)!.debt), {
          on: STAGE,
        }),
        anim(i * gap, `finale:${id}`, 'finale-content.Appear', { on: STAGE }),
        anim(i * gap, `finale:${id}.scoreL`, 'finale-score.Appear', { on: STAGE }),
        {
          t: i * gap + 300,
          kind: 'css' as const,
          target: `finale:${id}.name`,
          keyframes: [{ opacity: 1 }],
          ms: 200,
          on: STAGE,
        },
      ]),
      ...g.final.flatMap((f) => {
        const bite = times.debtAt - times.sum;
        return f.debt > 0
          ? [
              anim(bite, `finale:${f.id}.shark`, 'finale-d7.Debt', { on: STAGE }),
              anim(bite, `finale:${f.id}.debtL`, 'finale-debt.Debt', { on: STAGE }),
              anim(bite, `finale:${f.id}.scoreL`, 'finale-score.Debt', { on: STAGE }),
              text(bite + 300, `finale:${f.id}.score`, money(f.score), { on: STAGE }),
            ]
          : [];
      }),
      // With debts the loan sign comes back for the bite, as the original's.
      ...(times.debt
        ? [
            ...BANK_PARTS.map((p) =>
              anim(times.bankIn - times.sum, `bank-${p}`, `bank-${p}.Appear2`, { on: STAGE }),
            ),
            ...BANK_PARTS.flatMap((p) =>
              (ctx.swaps?.[`bank-${p}`]?.Appear2 ?? []).map(([ms, face]) =>
                set(times.bankIn - times.sum + ms, `bank-${p}`, 'data-show', face, { on: STAGE }),
              ),
            ),
            ...BANK_PARTS.map((p) =>
              anim(times.bankOut - times.sum, `bank-${p}`, `bank-${p}.Disappear`, { on: STAGE }),
            ),
          ]
        : []),
      // Everyone's totals drop away before the winner comes.
      ...g.final.map((f) =>
        anim(times.dismiss - times.sum, `finale:${f.id}`, 'finale-content.Disappear', {
          on: STAGE,
        }),
      ),
      ...g.final.map((f) =>
        anim(times.dismiss - times.sum, `finale:${f.id}.scoreL`, 'finale-score.Disappear', {
          on: STAGE,
        }),
      ),
      ...g.final.map((f) => ({
        t: times.dismiss - times.sum,
        kind: 'css' as const,
        target: `finale:${f.id}.name`,
        keyframes: [{ opacity: 0 }],
        ms: 300,
        on: STAGE,
      })),
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
      // The original's WinnerDarken: the wall to 40 % and the round beam coming down in the middle.
      wall(0, true, 367),
      anim(0, 'beam', 'beam.WinnerDarken', { on: STAGE }),
      ...g.winners.flatMap((id, i) => [
        anim(300 + i * 100, `win:${id}`, 'winning-content.Appear', { on: STAGE }),
        anim(300 + i * 100, `win:${id}.plate`, 'winning-d9.Appear', { on: STAGE }),
      ]),
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
  // The winner leaves (the original's `winner-out`: the light goes, the paddle slides down), then
  // the camera closes in on the credits' projector: the logo, the credits rolling up, and the line
  // that the host can play again.
  const away = times.winnerOut - times.winner;
  out.push({
    id: `end:${g.since}:credits`,
    at: times.winner,
    steps: [
      anim(away, 'beam', 'beam.WinnerLighten', { on: STAGE }),
      ...g.winners.map((id): Step => ({
        t: away - 500,
        kind: 'css',
        target: `win:${id}.out`,
        keyframes: [
          { transform: 'translate(0px, 0px)', opacity: 1 },
          { transform: 'translate(0px, 500px)', opacity: 0 },
        ],
        ms: 500,
        easing: 'ease-in',
        on: STAGE,
      })),
      anim(times.credits - times.winner, 'camera', 'stage.ZoomInCredits', { on: STAGE }),
      anim(times.credits - times.winner, 'credits.card', 'credits-d2.Appear', { on: STAGE }),
      anim(times.credits - times.winner, 'credits.glow', 'credits-d7.Appear', { on: STAGE }),
      anim(times.credits - times.winner, 'credits.slide', 'credits-slide.Appear', { on: STAGE }),
      {
        t: times.credits - times.winner + 400,
        kind: 'css',
        target: 'credits.again',
        keyframes: [{ opacity: 0 }, { opacity: 1 }],
        ms: 400,
        on: STAGE,
      },
    ],
  });
  return out;
}

/** How long the winners' moment takes to settle: the line fades in, the winners spring up. */
export const WINNERS_SETTLE_MS = 1500;

/**
 * When the end has settled on its winners, on the server clock (null before the end): from then
 * the stage renders the line and the winners itself, so a moment cut short by anything (a
 * re-render, a remount, a hidden tab) still leaves them on show.
 */
export function winnersShownAt(view: GoingOnceView): number | null {
  const times = endTimes(view);
  return times ? times.winner + WINNERS_SETTLE_MS : null;
}

/**
 * The lobby on the table screen, as the original's: once the screen opens it (`openedAt`), the logo
 * comes up and settles back small, the room's sign drops onto its easel with the join line and the
 * empty paddle slots; each joiner's paddle springs up in their slot with their name; the "press
 * Start" bar pops up once enough have joined.
 */
function lobby(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  if (view.phase !== 'lobby') return [];
  const seated = view.seats.filter((s) => s.playing);
  const open = ctx.openedAt;
  // A paddle springs up as its player sits down, but never before the lobby's logo has settled at
  // the top (`LOBBY.logins`): those already seated when the screen opened wait for it.
  const settled = open ? open + LOBBY.logins : 0;
  const out: Moment[] = seated.map((s) => ({
    id: `login:${s.id}`,
    at: Math.max(ctx.joined?.[s.id] ?? 0, settled),
    steps: [anim(0, `login:${s.id}`, 'login.Appear', { on: STAGE })],
  }));
  if (open)
    out.push({
      id: `lobby:${open}`,
      at: open,
      steps: [
        anim(0, 'logo', 'logo.Appear', { on: STAGE }),
        anim(LOBBY.logoBack, 'logo', 'logo.Shrink', { on: STAGE }),
        anim(LOBBY.sign, 'easel.stand', 'easel-d1.Appear', { on: STAGE }),
        anim(LOBBY.sign, 'easel.card', 'easel-content.Appear', { on: STAGE }),
        anim(LOBBY.sign, 'address', 'address.Appear', { on: STAGE }),
        ...[0, 1, 2, 3, 4, 5].map((i) =>
          anim(LOBBY.sign + i * 60, `circle:${i}`, 'circle.Appear', { on: STAGE }),
        ),
      ],
    });
  const third = seated[MIN_TO_START - 1];
  if (third)
    out.push({
      id: `press:${third.id}`,
      at: Math.max(open ? open + LOBBY.sign : 0, ctx.joined?.[third.id] ?? 0),
      steps: [anim(0, 'press', 'pressToPlay.Appear', { on: STAGE })],
    });
  return out;
}

/** Players needed to start (the bar asks the host to press Start from then). */
const MIN_TO_START = 3;

/**
 * Every moment the view calls for on this device, oldest first. Moments are built for every
 * profile; `schedule` (in `@vt/ui/show`) plays each step only where its `on` and `for` allow.
 */
export function moments(view: GoingOnceView, ctx: ShowCtx): Moment[] {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return lobby(view, ctx);
  const out: Moment[] = [
    ...countdown(view),
    ...drawing(view, ctx),
    ...drawEnd(view),
    ...tutorial(view),
  ];
  const l = lotOf(view);
  if (l) {
    out.push(lotIn(view, l));
    if (!l.intro) out.push(paintingIn(view, l));
    out.push(...bids(l, ctx), ...calls(l), ...screwAim(view), ...screwOutcome(view));
  }
  const sold = soldMoment(view);
  if (sold) out.push(sold);
  out.push(...halftime(view), ...bank(view, ctx), ...end(view, ctx));
  return out;
}

// ---- Where things stand (the table screen's layout, pure so it can be checked) ----

/**
 * The rig's silhouette for a paddle shape: the manifest's paddle pictures are named after the
 * original's shapes (`ui/paddles/thumbs-up.webp` is `shape.ThumbsUp`); one the rig lacks has none.
 */
export function shapeKey(
  manifest: unknown,
  rig: Pick<Rig, 'symbols'>,
  shape: number | undefined,
): string | null {
  const list = (manifest as { ui?: { paddles?: unknown } } | null)?.ui?.paddles;
  if (shape === undefined || !Array.isArray(list) || !list.length) return null;
  const path: unknown = list[shape % list.length];
  if (typeof path !== 'string') return null;
  const base = path
    .split('/')
    .pop()!
    .replace(/\.\w+$/, '');
  const key = `shape.${base.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())}`;
  return rig.symbols[key] ? key : null;
}

const COUNT = ['', 'Three', 'Three', 'Three', 'Four', 'Five', 'Six'];

/**
 * Where the row's seats go: across the room, centred (the lobby, the drawing, the end), or during
 * a lot right of the painting and its title, centred there; a raised paddle and its name stay
 * inside these bounds (seat centres).
 */
export const ROW_BOUNDS = { room: [100, 1180], lot: [550, 1200] } as const;
export type RowWhere = keyof typeof ROW_BOUNDS;
/** The original's seat spacing, at our scale. */
const ROW_SPREAD = 0.78;

/**
 * The x of each seat in a row of `n` (the original's layouts for three to six), centred in
 * `where`'s bounds at the original's spacing, closer together when that would not fit.
 */
export function rowOf(places: Rig['places'], n: number, where: RowWhere): number[] {
  const list = places[`row.${COUNT[Math.min(6, Math.max(3, n))]}`] as number[][] | undefined;
  const xs = (list ?? []).slice(0, n).map((m) => m[4]!);
  if (!xs.length) return [];
  const [lo, hi] = ROW_BOUNDS[where];
  const span = xs.at(-1)! - xs[0]!;
  const k = span ? Math.min(ROW_SPREAD, (hi - lo) / span) : 0;
  const mid = (xs[0]! + xs.at(-1)!) / 2;
  return xs.map((x) => (lo + hi) / 2 + (x - mid) * k);
}

/** Two affine matrices composed: `outer` applied after `inner` ([a b c d tx ty]). */
export function compose(outer: readonly number[], inner: readonly number[]): number[] {
  const [a, b, c, d, e, f] = outer as [number, number, number, number, number, number];
  const [A, B, C, D, E, F] = inner as [number, number, number, number, number, number];
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

/**
 * The chairs along the bottom of the room, as the original lays them out for three to six
 * (`row.Three`…`row.Six`, inside `row.at`): one matrix per seat, the same in every phase.
 */
/** How far down to hold a raised paddle on each frame of its track, and the track's length. */
export interface RaiseCap {
  ms: number;
  ys: number[];
}

/**
 * The next ask's room on the table screen, which a raised paddle must stay under: its left and
 * the bottom of its text box (160 units from 2, in `bidPrompt.at`), and its right edge at its
 * widest ("Going Twice…" in the amount face measures 1,039; 1,060 leaves room for the fallback
 * face).
 */
export function askBox(places: Rig['places']): { left: number; right: number; bottom: number } {
  const at = (places['bidPrompt.at'] as number[] | undefined) ?? [0.42, 0, 0, 0.42, 560, 380];
  return { left: at[4]!, right: 1060, bottom: at[5]! + at[3]! * (2 + 160) };
}
/**
 * The painting's room on the table screen (its canvas, 285 × 380 from `painting.at`), which a
 * raised paddle must stay under too: the owner's rule that nothing covers what matters.
 */
export function paintingBox(places: Rig['places']): {
  left: number;
  right: number;
  bottom: number;
} {
  const at = (places['painting.at'] as number[] | undefined) ?? [1, 0, 0, 1, 243, 96];
  return { left: at[4]!, right: at[4]! + 285, bottom: at[5]! + 380 };
}
/** The gap kept between a raised paddle's top and the ask or the painting. */
export const CAP_GAP = 6;

/** A rig symbol's bounds, [left, right, top, bottom], from its paths (null if it has none). */
export function symbolBox(src: string | undefined): [number, number, number, number] | null {
  if (!src) return null;
  const stack: number[][] = [[1, 0, 0, 1, 0, 0]];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const tokens = /<g transform="matrix\(([^)]*)\)">|<\/g>|<path [^>]*?d="([^"]*)"/g;
  for (const m of src.matchAll(tokens)) {
    if (m[1] !== undefined) stack.push(compose(stack.at(-1)!, m[1].split(',').map(Number)));
    else if (m[2] === undefined) stack.pop();
    else {
      const n = (m[2].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const t = stack.at(-1)!;
      for (let i = 0; i + 1 < n.length; i += 2) {
        const x = t[0]! * n[i]! + t[2]! * n[i + 1]! + t[4]!;
        const y = t[1]! * n[i]! + t[3]! * n[i + 1]! + t[5]!;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x0 === Infinity ? null : [x0, x1, y0, y1];
}

/**
 * A raised paddle's cap on the table screen: per frame of its track, how far down (in the seat's
 * units) to hold it so its silhouette (`box`, in `paddle.shape` units) stays under the next ask,
 * or null when it never reaches the ask at that seat. The original's paddles rise as high as
 * this too; it only shows them beside the ask, where ours can stand under it.
 */
export function raiseCap(
  places: Rig['places'],
  seat: readonly number[],
  box: readonly [number, number, number, number],
  frames: readonly Frame[],
  ms: number,
): RaiseCap | null {
  const keep = [askBox(places), paintingBox(places)];
  const base = compose(seat, (places['seat.paddle'] as number[] | undefined) ?? [1, 0, 0, 1, 0, 0]);
  const shape = (places['paddle.shape'] as number[] | undefined) ?? [1, 0, 0, 1, 0, 0];
  const ys = frames.map((f) => {
    const m = compose(compose(base, f.slice(0, 6)), shape);
    const pts = [box[0], box[1]].flatMap((x) =>
      [box[2], box[3]].map((y) => [m[0]! * x + m[2]! * y + m[4]!, m[1]! * x + m[3]! * y + m[5]!]),
    );
    const left = Math.min(...pts.map((p) => p[0]!));
    const right = Math.max(...pts.map((p) => p[0]!));
    const top = Math.min(...pts.map((p) => p[1]!));
    const over = keep.filter((b) => right > b.left && left < b.right);
    if (!over.length) return 0;
    const bottom = Math.max(...over.map((b) => b.bottom));
    // Room units to the seat's (the row is drawn at 0.95).
    return Math.max(0, (bottom + CAP_GAP - top) / (seat[3] || 1));
  });
  return ys.some((y) => y > 0) ? { ms, ys: ys.map((y) => Math.round(y * 10) / 10) } : null;
}

export function chairsOf(places: Rig['places'], n: number): number[][] {
  const list = places[`row.${COUNT[Math.min(6, Math.max(3, n))]}`] as number[][] | undefined;
  const at = (places['row.at'] as number[] | undefined) ?? [1, 0, 0, 1, 0, 0];
  return (list ?? []).slice(0, n).map((m) => compose(at, m));
}

/** A title's text style on its plate at the end of the table screen (`plateText`). */
export interface PlateText {
  fontSize: number;
  lineHeight?: number;
  width?: number;
  whiteSpace?: 'normal';
  textAlign?: 'center';
}

/** The room for a title on its plate at the end (the plate is about 272 stage units wide). */
const PLATE_TEXT_W = 250;
/** A bold glyph's width, roughly, in ems (a little over the average, to be safe). */
const GLYPH_EM = 0.47;

/**
 * A title's text on its plate: 26 units, smaller for a long title so it stays on one line inside
 * the plate, and in two smaller lines when even that would be too small to read.
 */
export function plateText(title: string): PlateText {
  const fits = PLATE_TEXT_W / (Math.max(1, title.length) * GLYPH_EM);
  if (fits >= 26) return { fontSize: 26 };
  if (fits >= 18) return { fontSize: Math.floor(fits) };
  return {
    fontSize: 17,
    lineHeight: 1.05,
    width: PLATE_TEXT_W,
    whiteSpace: 'normal',
    textAlign: 'center',
  };
}
