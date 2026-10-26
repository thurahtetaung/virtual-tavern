import {
  type GoingOnceView,
  type HostClip,
  type HostLine,
  SCREW_NUDGE_MS,
  SCREW_PICK_MS,
  SOLD_BEAT_MS,
  type Sender,
  type SoldBeats,
  type SoundMode,
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

/** Volume out of the box, as a share of full volume; the music plays at a share of that. */
export const DEFAULT_VOLUME = 0.8;
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
 * The Sold card's beats for this view: the server's (`GameView.soldBeats`), else (a room saved
 * before, the practice lot) a text game's, one `SOLD_BEAT_MS` apart.
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
  at: number;
  /** Their total before and after this group's values fly in (from their cash, as the original). */
  from: number;
  to: number;
}

/**
 * The end's rack-up on the server clock, as the original's: once the auctioneer's opening line is
 * said, each buyer's drawings in their groups (`endGroups`), one beat each, counting up from their
 * cash; then everyone's totals in a row, lowest first, one a second; the shark's bite on debts;
 * then the winners.
 */
export function endTimes(view: GoingOnceView): {
  buyers: number;
  debt: boolean;
  start: number;
  groups: EndGroup[];
  sum: number;
  /** The finale's players in the order they come up (lowest score before debt first). */
  finale: string[];
  debtAt: number;
  winner: number;
} | null {
  const g = view.game;
  if (!g || g.stage !== 'done' || g.ended || !g.final) return null;
  const step = RACKUP_BEAT_MS * (view.rig?.scale ?? 1);
  // Voiced, the rack-up waits for "Let's divide the winners from the losers!".
  const lead = g.voiced && g.host?.at === g.since && g.host.ms ? g.host.ms + 300 : 0;
  const start = g.since + lead;
  const values = new Map(g.results.map((r) => [r.item, r.value]));
  const buyers = g.final.filter((f) => f.bought.length > 0);
  const groups: EndGroup[] = [];
  buyers.forEach((f, buyer) => {
    let total = f.cash;
    for (const items of endGroups(f.bought)) {
      const from = total;
      total += items.reduce((n, item) => n + (values.get(item) ?? 0), 0);
      groups.push({
        buyer,
        index: groups.length,
        items,
        at: start + groups.length * step,
        from,
        to: total,
      });
    }
  });
  const debt = g.final.some((f) => f.debt > 0);
  const sum = start + groups.length * step;
  const finale = [...g.final]
    .sort((x, y) => x.score + x.debt - (y.score + y.debt))
    .map((f) => f.id);
  const debtAt = sum + finale.length * FINALE_GAP_MS * (view.rig?.scale ?? 1);
  return {
    buyers: buyers.length,
    debt,
    start,
    groups,
    sum,
    finale,
    debtAt,
    winner: debtAt + (debt ? step : 0) + step / 2,
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

/**
 * The Sold card's beats, in the original's order: the bell, the artist's paddle turning and the
 * commission paid, the value's spin, then profit or loss (`beats`, which voiced follow the lines).
 */
function soldCues(
  id: string,
  at: number,
  sale: { buyer: string | null; price: number; value: number; commission: number },
  beats: SoldBeats,
) {
  if (!sale.buyer) return [sfx(`${id}:unsold`, at + 600, 'unsold-out')];
  const profit = sale.value - sale.price;
  const spin = profit > 0 ? 'value-under' : profit < 0 ? 'value-over' : 'value-even';
  const out = profit > 0 ? 'profit-out' : profit < 0 ? 'loss-out' : 'even-out';
  return [
    sfx(`${id}:sold`, at, 'sold'),
    ...(beats.artist !== null ? [sfx(`${id}:artist`, at + beats.artist, 'paddle-flip')] : []),
    ...(sale.commission && beats.artist !== null
      ? [sfx(`${id}:cash`, at + beats.artist + 500, 'cha-ching')]
      : []),
    sfx(`${id}:spin`, at + beats.value, spin),
    sfx(`${id}:out`, at + beats.profit, out),
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
  if (g.introSkippedAt) out.push(sfx(`intro:skip`, g.introSkippedAt, 'skip'));
  switch (g.stage) {
    case 'draw': {
      const id = `draw:${g.since}`;
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
          ...soldCues(
            `${id}:sold`,
            p.since,
            { buyer: p.bid.by, price: p.bid.amount, value: p.value, commission: 0 },
            soldBeatsOf(view, false),
          ),
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
        ...soldCues(
          `sold${r.index}`,
          g.since,
          { buyer: r.buyer, price: r.price, value: r.value, commission: r.commission },
          soldBeatsOf(view, r.artistKnown && r.artist !== null),
        ),
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
      out.push(sfx(`${id}:in`, end.start, 'player-in'));
      for (const grp of end.groups.slice(1))
        out.push(sfx(`${id}:art${grp.index}`, grp.at, 'painting-value'));
      out.push(sfx(`${id}:sum`, end.sum, 'score-rackup'));
      if (end.debt) out.push(sfx(`${id}:shark`, end.debtAt, 'debt-shark'));
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
      case 'intro':
      case 'draw':
      case 'practice':
        next.push({ key: 'auction', pick: 0 });
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
