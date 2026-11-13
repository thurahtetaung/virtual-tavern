import {
  type GoingOnceView,
  type HostClip,
  type HostLine,
  PROJECTOR_WAIT_MS,
  SCREW_NUDGE_MS,
  SCREW_PICK_MS,
  SOLD_BEAT_MS,
  type Sender,
  type SoldBeats,
  type SoundMode,
  SLIDE_ONE_MS,
  TUTORIAL_END_MS,
} from '../logic/types.ts';
import { CHANT_GAP_MS, clipTimes } from '../logic/voice.ts';

export { SOLD_BEAT_MS, clipTimes };
import { GAME_COLORS } from '../logic/types.ts';

// The pure half of the sound: which music plays, which clips play when, and how loud. The React
// hook in `useSound.ts` only turns these decisions into audio elements, so everything here is
// testable without a browser. Every device works these out from the same view and the server
// clock, so devices that play sound play the same clips at the same moments; a cue a device sees
// too late (it was asleep, or reconnecting) is dropped rather than played late.

/** The manifest's `audio`: clip paths by key (a list means "pick one"), their lengths and words. */
export interface AudioManifest {
  music?: Record<string, string[]>;
  sfx?: Record<string, string[]>;
  voice?: Record<string, string[]>;
  /** Clip lengths in ms, by path. */
  durations?: Record<string, number>;
  /** What each voice clip says, by path: the voice plays the clip whose words are on screen. */
  text?: Record<string, string>;
}

/** The music plays at this share of the device's music volume. */
export const MUSIC_SHARE = 0.35;
/** Music drops to this share of its volume while the auctioneer speaks. */
export const DUCK_RATIO = 0.3;
export const CROSSFADE_MS = 1000;
export const DUCK_FADE_MS = 250;
/** A voice clip cut off by a newer line (a chant when a new bid lands) fades out this fast. */
export const CUT_MS = 200;
/**
 * A cue seen more than this long after its moment is dropped. A voice clip waiting behind the one
 * being said counts from when the voice came free, so only a device that was away drops clips.
 */
export const STALE_MS = 1500;
/** Effects due this soon are started now, on the audio clock, so they land on their moment. */
export const LOOKAHEAD_MS = 250;
/** A hint's ring is cut short after this long (the clips are whole ringtones). */
export const RING_MS = 1800;
/** The end rack-up's beat. */
export const RACKUP_BEAT_MS = 1800;

/**
 * The table screen's beats that a sound lands with (the motion in `show.ts` uses the same
 * numbers): the original's clip lengths at 30 fps, and where ours put each beat.
 */
export const BEAT = {
  /** The LOT disc's drop, and its rise away. */
  lotIn: 867,
  lotOut: 600,
  /** The painting sliding in: the opening bid follows once it has landed. */
  paintingIn: 933,
  /** The Sold stamp leaving (bought under its value it shrinks away, else it spins off), the painting. */
  stampGood: 733,
  stampBad: 600,
  paintingOut: 633,
  /** A bidder's paddle coming back down behind the chair after it went up (the original's). */
  paddleDown: 1000,
  /** The artist's paddle turned edge-on (its new words swap in). */
  flipEdge: 267,
  /** The drawing's sign coming down, ms into the drawing. */
  sign: 300,
  /** Half-time's screws drilling into the chairs, ms into it. */
  screwsIn: 1200,
  /** Each end group: its titles, then its values pop. */
  endName: 450,
  endValue: 650,
} as const;

/** When the LOT disc leaves, ms after the lot's intro began: as the intro ends, once it landed. */
export const lotOutAt = (a: { closeAt: number; since: number }) =>
  Math.max(BEAT.lotIn, a.closeAt - a.since - BEAT.lotOut);

/**
 * When the Sold card's stamp and picture leave, ms after it began (a beat or so before the card
 * ends, so they are gone as the next lot comes).
 */
export function soldOutAt(view: GoingOnceView, profit: number): number {
  const g = view.game!;
  const len = Math.max(SOLD_BEAT_MS * (view.rig?.scale ?? 1) * 5, g.until - g.since);
  return len - Math.max(BEAT.paintingOut, profit > 0 ? BEAT.stampGood : BEAT.stampBad) - 150;
}

/**
 * The Sold card's beats for this view: the server's (`GameView.soldBeats`), else (a room saved
 * before) a text game's, one `SOLD_BEAT_MS` apart.
 */
export function soldBeatsOf(view: GoingOnceView, artist: boolean): SoldBeats {
  if (view.game?.soldBeats) return view.game.soldBeats;
  const beat = SOLD_BEAT_MS * (view.rig?.scale ?? 1);
  const value = (artist ? 3 : 2) * beat;
  return { artist: artist ? 2 * beat : null, value, profit: value + beat };
}

export interface Cue {
  /** Unique per game and moment. */
  id: string;
  /** When it plays, on the server clock. */
  at: number;
  kind: 'sfx' | 'voice';
  key: string;
  /** Which clip of the key's list (wrapped); a voice cue picks by `text` first. */
  pick?: number;
  /** A voice cue: the words on screen. */
  text?: string;
  /** The latest moment it may still start (a voice cue waits behind the one before it). */
  until?: number;
  /** Cut it off after this long. */
  maxMs?: number;
  /** Only on this player's own device, whatever the room's sound mode (a hint's ring). */
  local?: boolean;
}

/**
 * The sound the room plays: the host's choice, except that a paired table screen takes the sound
 * until the host picks one, and "Table screen" without one plays on every device.
 */
export function soundModeIn(
  settings: { sound: SoundMode; soundChosen?: boolean },
  stagePresent: boolean,
): SoundMode {
  if (stagePresent && !settings.soundChosen) return 'stage';
  if (settings.sound === 'stage' && !stagePresent) return 'all';
  return settings.sound;
}

/** Whether this device plays the room's sound (`isStage`: it is the table screen). */
export function deviceSounds(mode: SoundMode, isHost: boolean, isStage = false): boolean {
  if (mode === 'stage') return isStage;
  return mode === 'all' || (mode === 'host' && isHost && !isStage);
}

/** The music a moment plays: a key of the manifest's `music` and which of its tracks. */
/** The finale's players come up one a second (the original's `secondsBetween`). */
export const FINALE_GAP_MS = 1000;

/**
 * A buyer's drawings in the end's groups, as the original's (threes and twos, never one alone):
 * 4 is 2 + 2, 5 is 3 + 2, 7 is 3 + 2 + 2.
 */
export function endGroups<T>(items: readonly T[]): T[][] {
  const n = items.length;
  if (n <= 3) return n ? [[...items]] : [];
  const k = Math.ceil(n / 3);
  const sizes = Array.from({ length: k }, (_, i) => 2 + (i < n - 2 * k ? 1 : 0));
  let at = 0;
  return sizes.map((size) => items.slice(at, (at += size)));
}

/** One group of a buyer's drawings racked up at the end. */
export interface EndGroup {
  /** The buyer's place among those who bought something, and this group's among all groups. */
  buyer: number;
  index: number;
  items: string[];
  /** When its drawings slide in; then, ms after that, the beats in `endBeats`. */
  at: number;
  /** Their total before and after this group's values fly in (from their cash, as the original). */
  from: number;
  to: number;
}

/**
 * The beats of one end group (`n` drawings), ms after its drawings slide in, timed from the
 * original's (one buyer with three drawings takes about nine seconds): each title pops a little
 * after the last, then the values together, then they fly into the total, which thumps; then the
 * drawings slide away.
 */
export function endBeats(n: number) {
  const names = Array.from({ length: n }, (_, k) => 1300 + 450 * k);
  const values = names.at(-1)! + 1000;
  const fly = values + 1500;
  const out = fly + 1500;
  return { names, values, fly, thump: fly + 500, out, len: out + 800 };
}

/** The end: a buyer's paddle and total come up this long before their first drawings. */
export const END_PLAYER_IN_MS = 1000;
/** After a buyer's last drawings slide away: their paddle drops, then the next buyer comes up. */
export const END_PLAYER_OUT_MS = 1000;

/**
 * The end's rack-up on the server clock, at the original's pace: once the auctioneer's opening
 * line is said, each buyer's paddle and total come up (`players`), then their drawings in groups
 * (`endGroups`, `endBeats`), counting up from their cash; then everyone's totals in a row, lowest
 * first, one a second; the shark's bite on debts; then the winners.
 */
export function endTimes(view: GoingOnceView): {
  buyers: number;
  debt: boolean;
  start: number;
  groups: EndGroup[];
  /** Each buyer's paddle coming up and going down (`buyer` order). */
  players: { in: number; out: number }[];
  sum: number;
  /** The finale's players in the order they come up (lowest score before debt first). */
  finale: string[];
  /** With debts: the loan sign back, the shark's bite, the sign leaving. */
  bankIn: number;
  debtAt: number;
  bankOut: number;
  /** Everyone's totals dropping away. */
  dismiss: number;
  winner: number;
  winnerOut: number;
  credits: number;
} | null {
  const g = view.game;
  if (!g || g.stage !== 'done' || g.ended || !g.final) return null;
  const scale = view.rig?.scale ?? 1;
  // Voiced, the rack-up waits for "Let's divide the winners from the losers!".
  const lead = g.voiced && g.host?.at === g.since && g.host.ms ? g.host.ms + 300 : 0;
  const start = g.since + lead;
  const values = new Map(g.results.map((r) => [r.item, r.value]));
  const buyers = g.final.filter((f) => f.bought.length > 0);
  const groups: EndGroup[] = [];
  const players: { in: number; out: number }[] = [];
  let t = start;
  buyers.forEach((f, buyer) => {
    const enter = t;
    t += END_PLAYER_IN_MS * scale;
    let total = f.cash;
    for (const items of endGroups(f.bought)) {
      const from = total;
      total += items.reduce((n, item) => n + (values.get(item) ?? 0), 0);
      groups.push({ buyer, index: groups.length, items, at: t, from, to: total });
      t += endBeats(items.length).len * scale;
    }
    players.push({ in: enter, out: t });
    t += END_PLAYER_OUT_MS * scale;
  });
  const debt = g.final.some((f) => f.debt > 0);
  const sum = t;
  const finale = [...g.final]
    .sort((x, y) => x.score + x.debt - (y.score + y.debt))
    .map((f) => f.id);
  // The original's finale (measured on its video): everyone's totals one a second; two seconds
  // after the last, with debts, the loan sign comes back and the shark bites ¾ s later, the sign
  // goes at 2½ s; the totals drop away (two seconds after the last without debts); the winner
  // springs up a second and a half later, leaves two and a half seconds on, and the credits come.
  const last = sum + Math.max(0, finale.length - 1) * FINALE_GAP_MS * scale;
  const bankIn = last + 2000 * scale;
  const dismiss = debt ? bankIn + 3000 * scale : last + 2000 * scale;
  const winner = dismiss + 1500 * scale;
  return {
    buyers: buyers.length,
    debt,
    start,
    groups,
    players,
    sum,
    finale,
    bankIn,
    debtAt: bankIn + 750 * scale,
    bankOut: bankIn + 2500 * scale,
    dismiss,
    winner,
    winnerOut: winner + WINNER_OUT_MS * scale,
    credits: winner + CREDITS_MS * scale,
  };
}

/** The winner's light and paddle leave this long after they came (the original's `winner-out`). */
export const WINNER_OUT_MS = 2500;
/** The credits' projector comes down this long after the winner. */
export const CREDITS_MS = 3750;

/** When a clip of the auctioneer's current line starts (server ms), or null when he doesn't say it. */
export function clipStart(host: Pick<HostLine, 'at' | 'clips'> | null | undefined, key: string) {
  const i = host?.clips?.findIndex((c) => c.key === key) ?? -1;
  return i < 0 ? null : (clipTimes(host!)[i] ?? null);
}

/** The opening's beats when the voice says nothing to key them to (text games, a redraw). */
const OPENING = { cascade: 1500, logoOut: 2500, prompt: 1200, signHold: 8000 } as const;
/** The rig's sign and hourglass leaving and dropping in. */
export const SIGN_OUT_MS = 533;

/**
 * The drawing's opening on the table screen, as the original's flowchart, keyed to what the
 * auctioneer says when he speaks: the logo enlarges and the chairs pop up as it starts, the paddles
 * cascade as he teases the guests, the logo goes and the sign drops in with "we'll need some art"
 * (its example drawing itself), the "draw using your device" line comes with the instructions, and
 * the sign rises away as the hourglass drops in with "you'll need to draw two drawings".
 */
export function openingTimes(view: GoingOnceView) {
  const g = view.game;
  if (!g || g.stage !== 'draw') return null;
  const host = g.host;
  const at = (key: string) => clipStart(host, key);
  if (g.redraw) {
    const timerIn = g.drawFrom > g.since + 3000 ? g.drawFrom : g.since + 6000;
    return {
      redraw: true,
      cascade: null,
      logoOut: g.since,
      signIn: g.since,
      prompt: g.since + OPENING.prompt,
      signOut: timerIn - SIGN_OUT_MS,
      timerIn,
    };
  }
  const signIn = at('need-art') ?? g.since + OPENING.logoOut;
  const timerIn =
    at('two-drawings') ?? (g.drawFrom > signIn + 4000 ? g.drawFrom : signIn + OPENING.signHold);
  return {
    redraw: false,
    cascade: at('guest-tease') ?? g.since + OPENING.cascade,
    logoOut: signIn,
    signIn,
    prompt: at('draw-instructions') ?? signIn + OPENING.prompt,
    signOut: timerIn - SIGN_OUT_MS,
    timerIn,
  };
}

/** The tutorial's slides that come on a line of their own (2, 3, … 13: slides 7 and 8 follow 6). */
const SLIDE_LINES: (string | null)[] = [
  null,
  'auction-count',
  'worth-a-lot',
  'worth-less',
  'starting-money',
  'buyers-info',
  null,
  null,
  'buyers-more',
  'first-message',
  'buy-advice',
  'buy-advice-also',
  'how-to-win',
];

/**
 * The tutorial on the table screen, as the original's flowchart: the room darkens with "A few
 * quick words…", the projector comes on half a second after it with its logo slide, then each
 * slide slides up with its line (the three buyers two seconds apart on theirs; slide 10, "check
 * your devices", as lot 1's tips arrive), and the projector shuts off after the last line before
 * the lights come up. Times on the server clock; null outside the tutorial.
 */
export function tutorialTimes(view: GoingOnceView) {
  const g = view.game;
  if (!g || g.stage !== 'intro') return null;
  const host = g.host;
  const keys = host?.clips?.map((c) => c.key) ?? [];
  const start = (prefix: string) => {
    const i = keys.findIndex((k) => k === prefix || k.startsWith(`${prefix}-`));
    return i < 0 ? null : clipTimes(host!)[i]!;
  };
  const count = start('auction-count');
  const off = g.until - TUTORIAL_END_MS;
  const dark = start('tutorial-start') ?? g.since;
  const projector = count !== null ? count - SLIDE_ONE_MS : dark + PROJECTOR_WAIT_MS + 2900;
  const slides: number[] = [projector];
  for (let n = 2; n <= 13; n++) {
    const key = SLIDE_LINES[n - 1];
    const at = key ? start(key) : slides[5]! + (n - 6) * 2000;
    slides.push(at ?? slides.at(-1)! + 3000);
  }
  return { dark, projector, slides, buzz: g.firstAt || slides[9]!, off, light: off + 400 };
}

/**
 * The music a moment plays (`now` on the server clock matters only at the end: the scores' loop
 * through each buyer's art, the drumroll while everyone's totals rack up, then the credits once
 * the winner is shown).
 */
export function musicFor(view: GoingOnceView, now = 0): { key: string; pick: number } | null {
  const g = view.game;
  // Nothing musical plays in the lobby (the ▶ previews still do).
  if (view.phase === 'lobby') return null;
  if (!g) return { key: 'lobby', pick: 0 };
  switch (g.stage) {
    case 'intro': {
      // The projector's loop, from just after it comes on until it shuts off (as the original).
      const t = tutorialTimes(view);
      if (t && now && (now < t.projector + 500 || now >= t.off)) return null;
      return { key: 'tutorial', pick: 0 };
    }
    case 'draw':
      // Every device picks the same track from when the drawing began.
      return { key: 'draw', pick: Math.floor(g.since / 1000) };
    case 'countdown':
      // The 3-2-1 has its own sound; the drawing's music starts after it.
      return null;
    case 'auction':
    case 'sold':
    case 'halftime': {
      const a = g.auction;
      if (g.stage === 'auction' && a?.screw) return { key: 'screw', pick: 0 };
      return { key: 'auction', pick: a?.lot ?? 0 };
    }
    case 'bank':
      return { key: 'bank', pick: 0 };
    case 'done': {
      const end = endTimes(view);
      if (!end) return null;
      // As the original: the drumroll stops as the winner comes; the credits' loop 3 s later.
      if (now >= end.winner && now < end.winner + 3000 * (view.rig?.scale ?? 1)) return null;
      const key = now < end.sum ? 'scores' : now < end.winner ? 'drumroll' : 'credits';
      return { key, pick: 0 };
    }
  }
}

/** A clip from a key's list, or null. */
export function clipOf(
  lists: Record<string, string[]> | undefined,
  key: string,
  pick = 0,
): string | null {
  const list = lists?.[key]?.filter((p) => typeof p === 'string' && p) ?? [];
  if (!list.length) return null;
  return list[((pick % list.length) + list.length) % list.length]!;
}

/**
 * The clip being said at `now` that has words (a chant has none, so the line before it stays on
 * screen), or null before the first or once the last has ended.
 */
export function clipNow(
  host: Pick<HostLine, 'at' | 'clips'> | null | undefined,
  now: number,
  hasWords: (c: HostClip) => boolean,
): HostClip | null {
  const clips = host?.clips ?? [];
  const times = clipTimes(host ?? {});
  let shown: HostClip | null = null;
  for (let i = 0; i < clips.length; i++) {
    if (times[i]! > now) break;
    if (hasWords(clips[i]!)) shown = clips[i]!;
  }
  const last = clips.length ? times.at(-1)! + clips.at(-1)!.ms + 2000 : 0;
  return now <= last ? shown : null;
}

/** Each sender's ring (a list index into the manifest's `message` effects). */
export const RING: Record<Sender, number> = {
  buyer1: 1,
  buyer2: 2,
  buyer3: 3,
  bank: 4,
  dog: 5,
  caller: 6,
};

/** A player's own bid yelp: one of the bidder voices, by their paddle (the same on every device). */
const yelp = (view: GoingOnceView, by: string) =>
  by.startsWith('~') ? 19 : (view.game?.paddles[by] ?? view.game!.order.indexOf(by));

const sfx = (id: string, at: number, key: string, more: Partial<Cue> = {}): Cue => ({
  id,
  at,
  kind: 'sfx',
  key,
  ...more,
});

/**
 * The sound of a bid: the paddle, then the bidder's own yelp (a screwed bid drills first); the
 * amount racking up, the next ask swapping in, and the paddle going back down.
 */
function bidCues(view: GoingOnceView, id: string, at: number, by: string, forced: boolean) {
  return [
    ...(forced ? [sfx(`${id}:drill`, at, 'screw-drill')] : []),
    sfx(`${id}:paddle`, at, 'bid'),
    sfx(`${id}:rackup`, at, 'bid-rackup'),
    sfx(`${id}:yelp`, at + (forced ? 600 : 80), 'bidder-voice', { pick: yelp(view, by) }),
    sfx(`${id}:next`, at + 300, 'next-bid'),
    sfx(`${id}:down`, at + BEAT.paddleDown, 'paddle-down'),
  ];
}

/**
 * The Sold card's beats, in the original's order: the bell, the artist's paddle turning and the
 * commission paid, the value's spin, then profit or loss (`beats`, which voiced follow the lines).
 */
function soldCues(
  id: string,
  at: number,
  sale: { buyer: string | null; price: number; value: number; commission: number },
  beats: SoldBeats,
  leave: number,
) {
  if (!sale.buyer) return [sfx(`${id}:unsold`, at + 600, 'unsold-out')];
  const profit = sale.value - sale.price;
  const spin = profit > 0 ? 'value-under' : profit < 0 ? 'value-over' : 'value-even';
  const out = profit > 0 ? 'profit-out' : profit < 0 ? 'loss-out' : 'even-out';
  return [
    sfx(`${id}:sold`, at, 'sold'),
    ...(beats.artist !== null
      ? [
          sfx(`${id}:artist`, at + beats.artist, 'paddle-flip'),
          // ARTIST turning to face the room, then the pay (or the nothing an unsold artist gets).
          sfx(`${id}:artistWord`, at + beats.artist + BEAT.flipEdge, 'artist'),
          sale.commission
            ? sfx(`${id}:cash`, at + beats.artist + 500, 'cha-ching')
            : sfx(`${id}:nothing`, at + beats.artist + 500, 'zero-commission'),
        ]
      : []),
    sfx(`${id}:spin`, at + beats.value, spin),
    sfx(`${id}:out`, at + beats.profit, out),
    sfx(`${id}:away`, at + leave + 100, 'painting-out'),
  ];
}

/** The lobby on the table screen, ms after it opens there: the logo settling, the sign dropping. */
export const LOBBY = { logoBack: 600, sign: 1200, logins: 1200 } as const;
/** The logo shrinking back to the top (the rig's `logo.Shrink`). */
export const LOGO_SHRINK_MS = 500;

/**
 * The table screen's lobby (it has no server moment of its own: it opens when the screen shows
 * it, `openedAt`): the logo settling back, the room's sign dropping onto its easel, and each
 * joiner's yelp as their paddle springs up (`joined`, when the screen saw each seat taken).
 */
export function lobbyCues(
  view: GoingOnceView,
  openedAt: number,
  joined: Readonly<Record<string, number>>,
): Cue[] {
  if (view.phase !== 'lobby') return [];
  const id = `lobby:${openedAt}`;
  const out = [
    sfx(`${id}:logo`, openedAt + LOBBY.logoBack, 'logo-back'),
    sfx(`${id}:sign`, openedAt + LOBBY.sign, 'sign-drop'),
  ];
  view.seats
    .filter((s) => s.playing)
    .forEach((s, i) => {
      const at = joined[s.id];
      // With the paddle springing up (never before the logo has settled).
      if (at)
        out.push(
          sfx(`${id}:yelp:${s.id}`, Math.max(at, openedAt + LOBBY.logins) + 100, 'bidder-voice', {
            pick: i,
          }),
        );
    });
  return out;
}

/**
 * The drawing's end, as the tutorial or lot 1 begins: the done paddles drop ("all paddles
 * down") and the hourglass rises away.
 */
function drawEndCues(view: GoingOnceView): Cue[] {
  const g = view.game!;
  if (!g.drawEnded) return [];
  return [
    sfx(`drawEnd:${g.drawEnded}:down`, g.drawEnded, 'paddles-down'),
    sfx(`drawEnd:${g.drawEnded}:timer`, g.drawEnded + 300, 'timer-out'),
  ];
}

/**
 * The effects of what is happening now, on the server clock: the current stage's beats (some of
 * them still to come, like the drawing clock's last ticks). Cues of moments already gone by are
 * no longer in the list; the hook plays each cue once.
 */
export function effectCues(view: GoingOnceView, you: string | null): Cue[] {
  const g = view.game;
  if (!g || view.phase === 'lobby') return [];
  const scale = view.rig?.scale ?? 1;
  const out: Cue[] = [];
  if (g.introSkippedAt)
    out.push(
      sfx(`intro:skip`, g.introSkippedAt, 'skip'),
      sfx(`intro:skipOff`, g.introSkippedAt, 'projector-stop'),
    );
  switch (g.stage) {
    case 'countdown':
      out.push(sfx(`countdown:${g.since}`, g.since, 'countdown'));
      break;
    case 'draw': {
      const id = `draw:${g.since}`;
      const o = openingTimes(view)!;
      // The 3-2-1 card leaving and the chairs popping up (not again on a redraw), the sign
      // dropping in, the hourglass after it.
      if (!o.redraw)
        out.push(sfx(`${id}:start`, g.since, 'start'), sfx(`${id}:chairs`, g.since, 'chairs'));
      out.push(sfx(`${id}:sign`, o.signIn, 'sign'));
      out.push(sfx(`${id}:in`, o.timerIn, 'timer-in'));
      // Each player's paddle springing up as their drawings are all in.
      for (const p of g.players)
        if (p.doneAt) out.push(sfx(`${id}:done:${p.id}`, p.doneAt, 'drawing-done'));
      for (let s = 10; s >= 1; s--) {
        const at = g.until - s * 1000 * scale;
        if (at > g.since) out.push(sfx(`${id}:tick${s}`, at, 'tick'));
      }
      // The hourglass rising away is the drawing's end (`drawEndCues`, in the stage after it).
      break;
    }
    case 'intro': {
      const t = tutorialTimes(view)!;
      const id = `intro:${g.since}`;
      out.push(...drawEndCues(view));
      out.push(sfx(`${id}:projector`, t.projector, 'projector-start'));
      t.slides.forEach((at, i) => out.push(sfx(`${id}:slide${i + 1}`, at, 'slide', { pick: i })));
      // Slide 10, "check your devices now": the phone buzz, and each player's first tip ringing.
      out.push(sfx(`${id}:buzz`, t.buzz, 'vibrate'));
      const m = view.mine?.messages.at(-1);
      if (m && m.lot === 0 && g.firstAt)
        out.push(
          sfx(`${id}:ring${m.id}`, g.firstAt, 'message', {
            pick: RING[m.from],
            maxMs: RING_MS,
            local: true,
          }),
        );
      out.push(sfx(`${id}:off`, t.off, 'projector-stop'));
      break;
    }
    case 'auction': {
      const a = g.auction;
      if (!a) break;
      const id = `lot${a.lot}`;
      if (a.close === 'intro') {
        if (a.lot === 0) out.push(...drawEndCues(view));
        out.push(sfx(`${id}:in`, a.since, 'lot-in'));
        out.push(sfx(`${id}:out`, a.since + lotOutAt(a), 'lot-out'));
        const m = view.mine?.messages.at(-1);
        // Lot 1's tips rang at the tutorial's slide 10 when it got that far.
        if (m && m.lot === a.lot && !(a.lot === 0 && g.tipsEarly))
          out.push(
            sfx(`${id}:ring${m.id}`, a.since + 250, 'message', {
              pick: RING[m.from],
              maxMs: RING_MS,
              local: true,
            }),
          );
        break;
      }
      if (a.screw) {
        out.push(sfx(`${id}:aim${a.since}`, a.since, 'screw-select'));
        // Voiced: the auctioneer clears his throat at the original's moment, the last few seconds
        // of the pick (`SCREW_PICK_MS - SCREW_NUDGE_MS` before it runs out), from its known deadline.
        if (g.voiced)
          out.push({
            id: `${id}:nudge${a.since}`,
            at: a.screw.until - (SCREW_PICK_MS - SCREW_NUDGE_MS) * scale,
            kind: 'voice',
            key: 'nudge',
            pick: a.since,
          });
        break;
      }
      // A screw that failed or was wasted (the clock restarts as it happens).
      const last = view.log.at(-1);
      if (last?.kind === 'screw' && last.lot === a.lot && last.outcome !== 'forced')
        out.push(sfx(`${id}:lost${last.id}`, a.since, 'screw-lost'));
      if (a.close === 'open' && !a.bid)
        out.push(
          sfx(`${id}:open`, a.since, 'painting-in'),
          sfx(`${id}:opening`, a.since + BEAT.paintingIn, 'opening-bid'),
        );
      const top = a.recent.at(-1);
      if (a.close === 'quiet' && top && a.bid)
        out.push(...bidCues(view, `${id}:bid${a.seq}`, a.since, top.by, top.forced));
      if (a.close === 'once') out.push(sfx(`${id}:once${a.seq}`, a.since, 'going-once'));
      if (a.close === 'twice') out.push(sfx(`${id}:twice${a.seq}`, a.since, 'going-twice'));
      break;
    }
    case 'sold': {
      const r = g.results.at(-1);
      if (!r) break;
      out.push(
        ...soldCues(
          `sold${r.index}`,
          g.since,
          { buyer: r.buyer, price: r.price, value: r.value, commission: r.commission },
          soldBeatsOf(view, r.artistKnown && r.artist !== null),
          soldOutAt(view, r.value - r.price),
        ),
      );
      break;
    }
    case 'halftime':
      out.push(sfx(`half:${g.since}:out`, g.since, 'screws-out'));
      out.push(sfx(`half:${g.since}:in`, g.since + BEAT.screwsIn, 'screws-in'));
      break;
    case 'bank': {
      out.push(sfx(`bank:${g.since}`, g.since, 'bank-ring'));
      // The bank's sign going away and its music cut off as its time runs out (a beat early, so
      // they still play as the next stage takes over).
      if (g.until > g.since)
        out.push(
          sfx(`bank:${g.since}:away`, g.until - 200, 'bank-away'),
          sfx(`bank:${g.since}:cutoff`, g.until - 200, 'bank-cutoff'),
        );
      // Voiced: the loan people's bumper on their first visit, and their jingle once they've spoken.
      const host = g.host;
      if (g.voiced && host?.clips?.length && host.at !== undefined) {
        if (host.clips[0]!.key === 'bank-first')
          out.push(
            sfx(`bank:${g.since}:bumper`, clipTimes(host)[0]! + host.clips[0]!.ms, 'bank-bumper'),
          );
        out.push(
          sfx(`bank:${g.since}:tag`, host.at + (host.ms ?? 0) + 200, 'bank-tag', { pick: host.id }),
        );
      }
      break;
    }
    case 'done': {
      const end = endTimes(view);
      if (!end) break;
      const id = `end:${g.since}`;
      end.players.forEach((p, i) => {
        out.push(sfx(`${id}:in${i}`, p.in, 'player-in'));
        out.push(sfx(`${id}:out${i}`, p.out, 'player-out'));
      });
      for (const grp of end.groups) {
        const b = endBeats(grp.items.length);
        out.push(sfx(`${id}:art${grp.index}`, grp.at, 'painting-in-end'));
        b.names.forEach((t, k) =>
          out.push(sfx(`${id}:name${grp.index}:${k}`, grp.at + t * scale, 'painting-name')),
        );
        out.push(
          sfx(`${id}:value${grp.index}`, grp.at + b.values * scale, 'painting-value'),
          sfx(`${id}:sum${grp.index}`, grp.at + b.fly * scale, 'score-rackup'),
          sfx(`${id}:artOut${grp.index}`, grp.at + b.out * scale, 'painting-out'),
        );
      }
      end.finale.forEach((_, i) =>
        out.push(sfx(`${id}:finale${i}`, end.sum + i * FINALE_GAP_MS * scale, 'player-in')),
      );
      if (end.debt) out.push(sfx(`${id}:shark`, end.debtAt, 'debt-shark'));
      out.push(sfx(`${id}:dismiss`, end.dismiss, 'player-out'));
      out.push(sfx(`${id}:winner`, end.winner, 'winner-centre'));
      // The WINNER! plate springing up with the winner's paddle; the winner leaving.
      out.push(sfx(`${id}:plate`, end.winner + 300, 'winner'));
      out.push(sfx(`${id}:winnerOut`, end.winnerOut - 500 * scale, 'winner-out'));
      break;
    }
  }
  return you === null ? out.filter((c) => !c.local) : out;
}

/**
 * What the auctioneer says, as voice cues: each clip the server picked, at the moment it is due.
 * A clip a device can't start in time is dropped (a newer line replaces the rest).
 */
export function voiceCues(view: GoingOnceView): Cue[] {
  const host = view.game?.host;
  if (!host?.clips?.length || host.at === undefined) return [];
  const times = clipTimes(host);
  return host.clips.map((c, i) => ({
    id: `host${host.id}:${i}`,
    at: times[i]!,
    kind: 'voice' as const,
    key: c.key,
    pick: c.i,
    until: times[i]! + Math.min(STALE_MS, c.ms),
  }));
}

/**
 * Cues due now (or within `lead` ms) that haven't played: their moment has come and isn't too
 * long gone.
 */
export function dueCues(
  cues: readonly Cue[],
  now: number,
  played: ReadonlySet<string>,
  lead = 0,
): Cue[] {
  return cues
    .filter((c) => !played.has(c.id) && c.at <= now + lead && now <= (c.until ?? c.at + STALE_MS))
    .sort((a, b) => a.at - b.at);
}

// ---- The voice's queue ----

/** One clip waiting to be said, on the server clock. */
export interface VoiceClip {
  id: string;
  /** The host line it belongs to (a lone cue is its own line). */
  line: string;
  key: string;
  pick: number;
  at: number;
  /** The game's stage when its line was said: a Skip moves it on. */
  stage: string;
  /** When the server timed its line to end. */
  lineEnd: number;
}

/** A host line's clips (every clip, those to come included), as the voice queue takes them. */
export function voiceLine(view: GoingOnceView): VoiceClip[] {
  const host = view.game?.host;
  if (!host?.clips?.length || host.at === undefined) return [];
  const times = clipTimes(host);
  const lineEnd = times.at(-1)! + host.clips.at(-1)!.ms;
  return host.clips.map((c, i) => ({
    id: `host${host.id}:${i}`,
    line: `host${host.id}`,
    key: c.key,
    pick: c.i,
    at: times[i]!,
    stage: view.game!.stage,
    lineEnd,
  }));
}

/** A lone voice cue (the throat-clear) as a line of its own. */
export function voiceClipOf(cue: Cue, stage: string): VoiceClip {
  return {
    id: cue.id,
    line: cue.id,
    key: cue.key,
    pick: cue.pick ?? 0,
    at: cue.at,
    stage,
    lineEnd: cue.at,
  };
}

/**
 * The queue once a new line arrives: what is left of older lines gives way (the server has moved
 * on), the new line's clips wait in order.
 */
export function enqueueLine(queue: readonly VoiceClip[], clips: readonly VoiceClip[]): VoiceClip[] {
  const line = clips[0]?.line;
  if (!line) return [...queue];
  const queued = new Set(queue.map((c) => c.id));
  return [...queue.filter((c) => c.line === line), ...clips.filter((c) => !queued.has(c.id))];
}

/** Stages that only end before their line does when the host skips them. */
const SKIPPABLE = new Set(['sold', 'halftime']);

/**
 * Whether a new line cuts off the clip being said rather than waiting for it to end: only a chant
 * (a new bid lands on it), or a Skip: the welcome skipped, or the host skipping a Sold or the
 * half-time before its line was done. Anything else (everyone's drawings in early, the bank done
 * early) waits for the clip to end.
 */
export function cutsOff(saying: VoiceClip, next: VoiceClip): boolean {
  if (saying.line === next.line) return false;
  // A new bid (or a screw) cuts a chant; the close's own call waits for it (`callStart`).
  if (saying.key.startsWith('chant')) return !isCall(next);
  // The screwer picked while being asked to: the pick's line follows at once.
  if (saying.key.startsWith('screw-pick')) return true;
  if (next.key === 'skipped') return true;
  return SKIPPABLE.has(saying.stage) && next.stage !== saying.stage && next.at < saying.lineEnd;
}

/**
 * How long a clip may wait for its own file to load once its turn has come: its lateness is
 * judged when its turn comes, so loading never makes a clip too late, but a file that takes
 * longer than this (a stalled network) gives its turn to the next clip.
 */
export const LOAD_WAIT_MS = 4000;

/** Whether a clip whose turn came at `takenAt` loaded too slowly to still be said at `loadedAt`. */
export const loadedTooLate = (takenAt: number, loadedAt: number) =>
  loadedAt - takenAt > LOAD_WAIT_MS;

/** A clip too late to say: its moment (or, waiting behind another clip, the voice's) is long gone. */
export const voiceLate = (clip: VoiceClip, now: number, freeSince: number) =>
  now - Math.max(clip.at, freeSince) > STALE_MS;

/**
 * The next clip to say once the voice is free (since `freeSince`), or null while none is due
 * (within `lead` ms); clips too late for their moment are dropped on the way.
 */
export function nextVoice(
  queue: readonly VoiceClip[],
  now: number,
  freeSince: number,
  lead = 0,
): { clip: VoiceClip | null; rest: VoiceClip[] } {
  const rest = [...queue];
  while (rest.length && voiceLate(rest[0]!, now, freeSince)) rest.shift();
  const first = rest[0];
  if (!first || first.at > now + lead) return { clip: null, rest };
  return { clip: first, rest: rest.slice(1) };
}

/**
 * Whether a clip keeps its server time whatever comes before it: a chant, which "going once"
 * follows by the server's clock (`CHANT_GAP_MS` after its end), so it must end on time.
 */
export const keepsTime = (c: Pick<VoiceClip, 'key'>) => c.key.startsWith('chant');

/**
 * A clip of `line` started `by` ms late: the rest of its line moves back to keep its pauses,
 * except a chant, which keeps its time (`keepsTime`).
 */
export function shiftLine(queue: readonly VoiceClip[], line: string, by: number): VoiceClip[] {
  if (by <= 0) return [...queue];
  return queue.map((c) => (c.line === line && !keepsTime(c) ? { ...c, at: c.at + by } : c));
}

/** The close's calls that come after a chant: "going once" (fast or not) and "No one?". */
export const isCall = (c: Pick<VoiceClip, 'key'>) => /^(going-once|no-bids)/.test(c.key);

/**
 * When a call may start, as the original sequences it: one second (`CHANT_GAP_MS`) after the
 * chant before it has actually ended on this device, whatever the server's clock assumed (a
 * device that starts its clips a little late would otherwise talk over its own chant).
 */
export function callStart(clip: VoiceClip, start: number, chantEnded: number | null): number {
  return isCall(clip) && chantEnded !== null ? Math.max(start, chantEnded + CHANT_GAP_MS) : start;
}

/** The least of a chant worth saying. */
export const MIN_CHANT_MS = 500;

/**
 * How far into a clip to start it at `start` (ms into it), or null when it would end too soon to
 * be worth saying: a chant whose turn came late (the amount before it waited for another clip, or
 * its file was slow) skips its head so that it still ends when the server timed it to; any other
 * clip starts at its beginning.
 */
export function clipSkip(clip: VoiceClip, start: number, lengthMs: number): number | null {
  if (!keepsTime(clip)) return 0;
  const skip = Math.max(0, start - clip.at);
  return lengthMs - skip < MIN_CHANT_MS ? null : skip;
}

/** Whether the voice counts as speaking for the music's ducking: saying a clip, or one due soon. */
export const voiceBusy = (saying: boolean, queue: readonly VoiceClip[], now: number) =>
  saying || queue.some((c) => c.at <= now + 1000);

/** Whether this device plays a cue: local rings always (unless sound is off), the rest as chosen. */
export function cuePlays(
  cue: Cue,
  opts: { mode: SoundMode; isHost: boolean; effects: boolean; voice: boolean; isStage?: boolean },
): boolean {
  if (opts.mode === 'off') return false;
  const shared = deviceSounds(opts.mode, opts.isHost, opts.isStage);
  if (cue.kind === 'voice') return opts.voice && shared;
  if (!opts.effects) return false;
  return cue.local === true || shared;
}

/**
 * Sounds for this player's own actions, from the change between two views: a drawing sent, a
 * loan taken. Played at once, on this device only.
 */
export function ownCues(prev: GoingOnceView | null, next: GoingOnceView, now: number): Cue[] {
  const a = prev?.mine;
  const b = next.mine;
  if (!a || !b) return [];
  const out: Cue[] = [];
  const sent = (v: typeof a) => v.prompts.filter((p) => p.sent).length;
  if (sent(b) > sent(a))
    out.push(sfx(`drawn:${sent(b)}:${now}`, now, 'drawing-done', { local: true }));
  if (b.loans > a.loans) out.push(sfx(`loan:${b.loans}:${now}`, now, 'loan', { local: true }));
  return out;
}

/** The music's volume: its share of this device's volume, ducked while the voice speaks. */
export const musicLevel = (volume: number, speaking: boolean) =>
  Math.max(0, Math.min(1, volume)) * MUSIC_SHARE * (speaking ? DUCK_RATIO : 1);

/** A linear ramp from `from` to `to` over `ms`, sampled `elapsed` ms in. */
export function ramp(from: number, to: number, elapsed: number, ms: number): number {
  if (ms <= 0 || elapsed >= ms) return to;
  if (elapsed <= 0) return from;
  return from + ((to - from) * elapsed) / ms;
}

// ---- Fetching ahead ----

/** A key said to one player: it ends in a player colour. */
const colourOf = (key: string) => GAME_COLORS.find((c) => key.endsWith(`-${c}`)) ?? null;
const isChant = (key: string) => key.startsWith('chant');

/**
 * What a device that plays the room's sound fetches once the sound starts, in the background:
 * every effect and every voice line but the chants, the lines said to a player only for the
 * colours at the table (each only when its switch is on). Effects come first: they are small and
 * wanted at once.
 */
export function startupClips(
  audio: AudioManifest | undefined,
  colours: readonly string[],
  on: { effects: boolean; voice: boolean },
): string[] {
  const seated = new Set(colours);
  const effects = on.effects ? Object.values(audio?.sfx ?? {}).flat() : [];
  const voice = Object.entries(on.voice ? (audio?.voice ?? {}) : {})
    .filter(([key]) => !isChant(key) && (colourOf(key) === null || seated.has(colourOf(key)!)))
    .flatMap(([, list]) => list);
  return [...new Set([...effects, ...voice].filter((p) => typeof p === 'string' && p))];
}

/**
 * What a device that only rings fetches ahead: the ring of this player's own art buyer, who sends
 * most of their tips (a tip from the bank, the dog or a wrong number loads its ring when it comes).
 */
export const ringClips = (audio: AudioManifest | undefined, contact: Sender | undefined) => {
  const ring = contact ? clipOf(audio?.sfx, 'message', RING[contact]) : null;
  return ring ? [ring] : [];
};

/** The chant key the server says after a bid of `amount` (its long version is `chant-long-…`). */
const chantTag = (amount: number) => (amount <= 4000 ? String(amount) : 'high');

/** Effects kept decoded all game: wanted the instant a bid lands or a call is made. */
export const INSTANT_EFFECTS = ['bid', 'bidder-voice', 'going-once', 'going-twice', 'tick'];

/** How many of the next bid amounts have their chants fetched ahead. */
export const CHANTS_AHEAD = 3;

/**
 * The chants worth fetching now: those for the next few amounts a bid could bring (the opening's
 * three before the first bid). The chant the server picked for a bid comes with its line.
 */
export function chantClips(audio: AudioManifest | undefined, view: GoingOnceView): string[] {
  const g = view.game;
  const a = g?.auction;
  if (!g?.voiced || g.stage !== 'auction' || !a) return [];
  const top = a.bid?.amount;
  const amounts = top
    ? Array.from({ length: CHANTS_AHEAD }, (_, i) => top + 100 * (i + 1))
    : [400, 500, 600];
  const tags = [...new Set(amounts.map(chantTag))];
  return tags.flatMap((t) => audio?.voice?.[`chant-${t}`] ?? []);
}

/** The tracks to have ready: the one playing now and the one most likely next. */
export function musicClips(audio: AudioManifest | undefined, view: GoingOnceView): string[] {
  const g = view.game;
  const now = musicFor(view, g?.since ?? 0);
  const next: { key: string; pick: number }[] = [];
  if (view.phase === 'lobby' || !g) next.push({ key: 'tutorial', pick: 0 });
  else
    switch (g.stage) {
      case 'countdown':
        next.push({ key: 'draw', pick: 0 });
        break;
      case 'intro':
      case 'draw':
        next.push({ key: 'tutorial', pick: 0 }, { key: 'auction', pick: 0 });
        break;
      case 'auction':
      case 'sold':
      case 'halftime':
      case 'bank':
        next.push({ key: 'auction', pick: (g.auction?.lot ?? 0) + 1 });
        break;
      case 'done':
        next.push({ key: 'drumroll', pick: 0 }, { key: 'credits', pick: 0 });
        break;
    }
  return [
    ...new Set([now, ...next].flatMap((m) => (m ? [clipOf(audio?.music, m.key, m.pick)] : []))),
  ].filter((p): p is string => !!p);
}

/** The bits of an audio element the primer touches. */
export interface Primable {
  src: string;
  play: () => Promise<void>;
  pause: () => void;
}

/**
 * Plays `silent` on a music player inside the tap, so it may start tracks later without one, then
 * stops it. A track set on the player before that play has settled (a cached one comes that fast)
 * is left playing: only the primer itself is paused.
 */
export function prime(el: Primable, silent: string) {
  el.src = silent;
  const primer = el.src;
  void el.play().then(
    () => {
      if (el.src === primer) el.pause();
    },
    () => {},
  );
}

// ---- Settings previews ----

/** The clips a settings preview tries for each type, first found first: real ones from the game. */
const PREVIEW_KEYS = {
  music: ['lobby', 'auction', 'draw'],
  effects: ['going-once', 'bid', 'sold'],
  voice: ['welcome', 'congrats', 'regulars'],
} as const;

/**
 * The clip a ▶ preview plays for a sound type: a few seconds of the lobby's music, a typical
 * effect (a phone that only rings hears its own buyer's ring), one of the auctioneer's lines.
 * Null when the manifest has none.
 */
export function previewClip(
  audio: AudioManifest | undefined,
  kind: 'music' | 'effects' | 'voice',
  { ringsOnly = false, contact }: { ringsOnly?: boolean; contact?: Sender } = {},
): string | null {
  if (kind === 'effects' && ringsOnly)
    return clipOf(audio?.sfx, 'message', contact ? RING[contact] : 0);
  const lists = kind === 'music' ? audio?.music : kind === 'effects' ? audio?.sfx : audio?.voice;
  for (const key of PREVIEW_KEYS[kind]) {
    const src = clipOf(lists, key);
    if (src) return src;
  }
  // Any line not said to one player (those end in a colour).
  const any = Object.entries(lists ?? {}).find(([key]) => colourOf(key) === null);
  return any ? clipOf(lists, any[0]) : null;
}
