import {
  type GoingOnceView,
  type HostClip,
  type HostLine,
  SCREW_NUDGE_MS,
  SCREW_PICK_MS,
  type Sender,
  type SoundMode,
} from '../logic/types.ts';
import { CLIP_GAP_MS } from '../logic/voice.ts';

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

/** Volume out of the box, as a share of full volume; the music plays at a share of that. */
export const DEFAULT_VOLUME = 0.8;
export const MUSIC_SHARE = 0.35;
/** Music drops to this share of its volume while the auctioneer speaks. */
export const DUCK_RATIO = 0.3;
export const CROSSFADE_MS = 1000;
export const DUCK_FADE_MS = 250;
/** A voice clip cut off by a newer line (a chant when a new bid lands) fades out this fast. */
export const CUT_MS = 200;
/** A cue seen more than this long after its moment is dropped. */
export const STALE_MS = 1500;
/** A hint's ring is cut short after this long (the clips are whole ringtones). */
export const RING_MS = 1800;
/** The Sold card's beats (stamp, price, value, profit, artist) and the end rack-up's. */
export const SOLD_BEAT_MS = 800;
export const RACKUP_BEAT_MS = 1800;

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

/** Whether this device plays the room's sound: the host's choice. */
export function deviceSounds(mode: SoundMode, isHost: boolean): boolean {
  return mode === 'all' || (mode === 'host' && isHost);
}

/** The music a moment plays: a key of the manifest's `music` and which of its tracks. */
/**
 * The end's rack-up on the server clock (its beats as `RackUp` shows them): when everyone's
 * totals rack up together, and when the winner takes the centre.
 */
export function endTimes(
  view: GoingOnceView,
): { buyers: number; debt: boolean; sum: number; winner: number } | null {
  const g = view.game;
  if (!g || g.stage !== 'done' || g.ended || !g.final) return null;
  const step = RACKUP_BEAT_MS * (view.rig?.scale ?? 1);
  const buyers = g.final.filter((f) => f.bought.length > 0).length;
  const debt = g.final.some((f) => f.debt > 0);
  return {
    buyers,
    debt,
    sum: g.since + buyers * step,
    winner: g.since + (buyers + 1 + (debt ? 1 : 0)) * step,
  };
}

/**
 * The music a moment plays (`now` on the server clock matters only at the end: the scores' loop
 * through each buyer's art, the drumroll while everyone's totals rack up, then the credits once
 * the winner is shown).
 */
export function musicFor(view: GoingOnceView, now = 0): { key: string; pick: number } | null {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return { key: 'lobby', pick: 0 };
  switch (g.stage) {
    case 'intro':
      return { key: 'tutorial', pick: 0 };
    case 'draw':
      // Every device picks the same track from when the drawing began.
      return { key: 'draw', pick: Math.floor(g.since / 1000) };
    case 'practice':
      return { key: 'auction', pick: 0 };
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
 * Where each clip of a voiced host line starts, on the server clock: one after the other from
 * when it was said, as the server timed them (`CLIP_GAP_MS` apart).
 */
export function clipTimes(host: Pick<HostLine, 'at' | 'clips'>): number[] {
  const out: number[] = [];
  let t = host.at ?? 0;
  for (const c of host.clips ?? []) {
    out.push(t);
    t += c.ms + CLIP_GAP_MS;
  }
  return out;
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

/** The sound of a bid: the paddle, then the bidder's own yelp (a screwed bid drills first). */
function bidCues(view: GoingOnceView, id: string, at: number, by: string, forced: boolean) {
  return [
    ...(forced ? [sfx(`${id}:drill`, at, 'screw-drill')] : []),
    sfx(`${id}:paddle`, at, 'bid'),
    sfx(`${id}:yelp`, at + (forced ? 600 : 80), 'bidder-voice', { pick: yelp(view, by) }),
  ];
}

/** The Sold card's beats: the bell, the value spin, profit or loss, the commission, the artist. */
function soldCues(
  id: string,
  at: number,
  sale: { buyer: string | null; price: number; value: number; commission: number; artist: boolean },
) {
  if (!sale.buyer) return [sfx(`${id}:unsold`, at + 600, 'unsold-out')];
  const profit = sale.value - sale.price;
  const spin = profit > 0 ? 'value-under' : profit < 0 ? 'value-over' : 'value-even';
  const out = profit > 0 ? 'profit-out' : profit < 0 ? 'loss-out' : 'even-out';
  return [
    sfx(`${id}:sold`, at, 'sold'),
    sfx(`${id}:spin`, at + SOLD_BEAT_MS * 2, spin),
    sfx(`${id}:out`, at + SOLD_BEAT_MS * 3, out),
    ...(sale.commission ? [sfx(`${id}:cash`, at + SOLD_BEAT_MS * 3 + 400, 'cha-ching')] : []),
    ...(sale.artist ? [sfx(`${id}:artist`, at + SOLD_BEAT_MS * 4, 'paddle-flip')] : []),
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
  switch (g.stage) {
    case 'draw': {
      const id = `draw:${g.since}`;
      if (g.introSkipped) out.push(sfx(`${id}:skip`, g.since, 'skip'));
      out.push(sfx(`${id}:in`, g.since, 'timer-in'));
      for (let s = 10; s >= 1; s--) {
        const at = g.until - s * 1000 * scale;
        if (at > g.since) out.push(sfx(`${id}:tick${s}`, at, 'tick'));
      }
      out.push(sfx(`${id}:out`, g.until, 'timer-out'));
      break;
    }
    case 'practice': {
      const p = g.practice;
      if (!p) break;
      const id = `practice:${g.since}`;
      if (p.step === 'hint' && view.mine)
        out.push(
          sfx(`${id}:ring`, p.since + 250, 'message', {
            pick: RING[view.mine.contact],
            maxMs: RING_MS,
            local: true,
          }),
        );
      if (p.step === 'bid') {
        if (!p.bid && p.close === 'open') out.push(sfx(`${id}:in`, p.since, 'painting-in'));
        const last = p.recent.at(-1);
        if (p.close === 'quiet' && last)
          out.push(...bidCues(view, `${id}:bid${p.seq}`, p.since, last.by, false));
        if (p.close === 'once') out.push(sfx(`${id}:once${p.seq}`, p.since, 'going-once'));
        if (p.close === 'twice') out.push(sfx(`${id}:twice${p.seq}`, p.since, 'going-twice'));
      }
      if (p.step === 'sold' && p.bid)
        out.push(
          ...soldCues(`${id}:sold`, p.since, {
            buyer: p.bid.by,
            price: p.bid.amount,
            value: p.value,
            commission: 0,
            artist: false,
          }),
        );
      if (p.step === 'screw') out.push(sfx(`${id}:screw`, p.since + 300, 'screw-lost'));
      break;
    }
    case 'auction': {
      const a = g.auction;
      if (!a) break;
      const id = `lot${a.lot}`;
      if (a.close === 'intro') {
        out.push(sfx(`${id}:in`, a.since, 'lot-in'));
        const m = view.mine?.messages.at(-1);
        if (m && m.lot === a.lot)
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
      if (a.close === 'open' && !a.bid) out.push(sfx(`${id}:open`, a.since, 'painting-in'));
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
        ...soldCues(`sold${r.index}`, g.since, {
          buyer: r.buyer,
          price: r.price,
          value: r.value,
          commission: r.commission,
          artist: r.artistKnown && r.artist !== null,
        }),
      );
      break;
    }
    case 'halftime':
      out.push(sfx(`half:${g.since}:out`, g.since, 'screws-out'));
      out.push(sfx(`half:${g.since}:in`, g.since + 700, 'screws-in'));
      break;
    case 'bank': {
      out.push(sfx(`bank:${g.since}`, g.since, 'bank-ring'));
      // Voiced: the loan people's bumper on their first visit, and their jingle once they've spoken.
      const host = g.host;
      if (g.voiced && host?.clips?.length && host.at !== undefined) {
        if (host.clips[0]!.key === 'bank-first')
          out.push(sfx(`bank:${g.since}:bumper`, host.at + host.clips[0]!.ms, 'bank-bumper'));
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
      const step = RACKUP_BEAT_MS * scale;
      out.push(sfx(`${id}:in`, g.since, 'player-in'));
      for (let i = 1; i < end.buyers; i++)
        out.push(sfx(`${id}:art${i}`, g.since + i * step, 'painting-value'));
      out.push(sfx(`${id}:sum`, end.sum, 'score-rackup'));
      if (end.debt) out.push(sfx(`${id}:shark`, end.sum + step, 'debt-shark'));
      out.push(sfx(`${id}:winner`, end.winner, 'winner-centre'));
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

/** Cues due now that haven't played: their moment has come and isn't too long gone. */
export function dueCues(cues: readonly Cue[], now: number, played: ReadonlySet<string>): Cue[] {
  return cues
    .filter((c) => !played.has(c.id) && c.at <= now && now <= (c.until ?? c.at + STALE_MS))
    .sort((a, b) => a.at - b.at);
}

/** Whether this device plays a cue: local rings always (unless sound is off), the rest as chosen. */
export function cuePlays(
  cue: Cue,
  opts: { mode: SoundMode; isHost: boolean; effects: boolean; voice: boolean },
): boolean {
  if (opts.mode === 'off') return false;
  if (cue.kind === 'voice') return opts.voice && deviceSounds(opts.mode, opts.isHost);
  if (!opts.effects) return false;
  return cue.local === true || deviceSounds(opts.mode, opts.isHost);
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
