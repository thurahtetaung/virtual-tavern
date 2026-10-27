// The browser half of a game's sound: one AudioContext, started by the player's first tap, plays every
// effect and voice clip from decoded buffers (so they start on time, overlap freely and need no
// further taps on phones), and two music players crossfade and duck (through it on iPhones, where
// an element's own volume can't be set). Clips are fetched ahead as compressed files, kept
// in Cache Storage (so a second game downloads nothing, even where the HTTP cache dropped them),
// and decoded only shortly before they play: decoded audio is about ten times larger. Nothing here
// decides what plays: each game's own sound hook does, from its pure rules.

/** A one-sample silent WAV: played once in the first tap so the music players may play later. */
const SILENT =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';
/** Decoded clips kept (besides the pinned ones), oldest use dropped first. */
const DECODED = 40;
/** Background fetches at once. */
const FETCHES = 2;
export const CROSSFADE_MS = 1000;
export const DUCK_FADE_MS = 250;

/** A game's private sound file, by its path in the game's manifest. */
export const soundUrl = (game: string, path: string) =>
  `/api/backroom/assets/${game}/${path.replace(/^\/+/, '')}`;

/** Plays a silent clip once inside a tap, so the element may play later without one. */
export function prime(el: Pick<HTMLAudioElement, 'src' | 'play' | 'pause'>, silent: string) {
  el.src = silent;
  const primer = el.src;
  void el.play().then(
    () => {
      if (el.src === primer) el.pause();
    },
    () => {},
  );
}

/** A clip being said: `cut` fades it out and stops it (its `onEnd` still runs once). */
export interface Saying {
  cut: (ms: number) => void;
}

interface MusicPlayer {
  el: HTMLAudioElement;
  gain: GainNode | null;
  src: string | null;
  /** The object URL it plays from Cache Storage, revoked when it stops. */
  url?: string | null;
  stopTimer?: ReturnType<typeof setTimeout>;
  /** The element-volume fade running, where the volume does the fades. */
  fade?: ReturnType<typeof setInterval>;
}

export class SoundEngine {
  /** The game whose files it plays (each game's clips live in its own Cache Storage cache). */
  private readonly game: string;
  constructor(game: string) {
    this.game = game;
  }
  private ctx: AudioContext | null = null;
  private decoded = new Map<string, Promise<AudioBuffer | null>>();
  private pinned = new Set<string>();
  /** Compressed files fetched this visit where Cache Storage is missing (an insecure page). */
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private stored = new Set<string>();
  private fetching = new Map<string, Promise<boolean>>();
  private waiting: string[] = [];
  private running = 0;
  private cache: Promise<Cache | null> | null = null;
  private music: MusicPlayer[] = [];
  private current: MusicPlayer | null = null;
  private track: string | null = null;
  private level = 0;

  /** Starts (or restarts) the audio; call it inside a tap or key press. */
  unlock() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      for (let i = 0; i < 2; i++) this.music.push(this.musicPlayer());
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    // A silent buffer started inside the tap is what lets older iPhones play at all.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start();
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private musicPlayer(): MusicPlayer {
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    // Played once inside the tap, so this player may start tracks later without one.
    prime(el, SILENT);
    // Where an element's volume can be set, it does the fades. Where it can't (iPhones), the
    // player runs through the audio context for them.
    el.volume = 0.5;
    if (el.volume === 0.5) {
      el.volume = 0;
      return { el, gain: null, src: null };
    }
    try {
      const ctx = this.ctx!;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain);
      gain.connect(ctx.destination);
      return { el, gain, src: null };
    } catch {
      return { el, gain: null, src: null };
    }
  }

  private openCache(): Promise<Cache | null> {
    this.cache ??= (
      typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(`vt-${this.game}-audio`)
    ).catch(() => null);
    return this.cache;
  }

  /** Makes sure a clip's file is here (Cache Storage, else memory); true when it is. */
  private fetchFile(src: string): Promise<boolean> {
    if (this.stored.has(src)) return Promise.resolve(true);
    const known = this.fetching.get(src);
    if (known) return known;
    const url = soundUrl(this.game, src);
    const done = this.openCache()
      .then(async (cache) => {
        if (cache && (await cache.match(url))) return true;
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return false;
        if (cache) await cache.put(url, res);
        else this.bytes.set(src, res.arrayBuffer());
        return true;
      })
      .catch(() => false)
      .then((ok) => {
        this.fetching.delete(src);
        if (ok) this.stored.add(src);
        return ok;
      });
    this.fetching.set(src, done);
    return done;
  }

  /** A clip's file: from Cache Storage (or memory), else straight from the network. */
  private async fileResponse(src: string): Promise<Response | null> {
    const url = soundUrl(this.game, src);
    if (await this.fetchFile(src)) {
      const kept = this.bytes.get(src);
      if (kept) return new Response((await kept).slice(0));
      const res = await (await this.openCache())?.match(url);
      if (res) return res;
    }
    // The cache lost it (or never kept it): the network, as a browser without the cache would.
    this.stored.delete(src);
    const res = await fetch(url, { credentials: 'same-origin' }).catch(() => null);
    return res?.ok ? res : null;
  }

  private async fileBytes(src: string): Promise<ArrayBuffer | null> {
    return (await this.fileResponse(src))?.arrayBuffer() ?? null;
  }

  /**
   * Fetches clips ahead in the background, a couple at a time, behind anything wanted now.
   * Nothing is decoded.
   */
  prefetch(srcs: readonly string[]) {
    for (const src of srcs)
      if (!this.stored.has(src) && !this.fetching.has(src) && !this.waiting.includes(src))
        this.waiting.push(src);
    this.pumpFetches();
  }

  private pumpFetches() {
    while (this.running < FETCHES && this.waiting.length) {
      const src = this.waiting.shift()!;
      this.running++;
      void this.fetchFile(src).then(() => {
        this.running--;
        this.pumpFetches();
      });
    }
  }

  /** Keeps these decoded for good (the sounds wanted at a moment's notice: the paddles). */
  pin(srcs: readonly string[]) {
    for (const src of srcs) {
      this.pinned.add(src);
      void this.load(src);
    }
  }

  /** A clip's decoded audio: fetched if it isn't here yet, decoded now (null when it can't be had). */
  load(src: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(null);
    const known = this.decoded.get(src);
    if (known) {
      this.decoded.delete(src);
      this.decoded.set(src, known);
      return known;
    }
    const loading = this.fileBytes(src)
      .then((data) =>
        data
          ? new Promise<AudioBuffer>((resolve, reject) => {
              // Older Safari only has the callback form.
              const p = ctx.decodeAudioData(data, resolve, reject) as
                Promise<AudioBuffer> | undefined;
              p?.then(resolve, reject);
            })
          : null,
      )
      .catch(() => null)
      .then((buffer) => {
        if (!buffer) this.decoded.delete(src);
        return buffer;
      });
    this.decoded.set(src, loading);
    let extra = this.decoded.size - this.pinned.size - DECODED;
    for (const key of this.decoded.keys()) {
      if (extra <= 0) break;
      if (this.pinned.has(key) || key === src) continue;
      this.decoded.delete(key);
      extra--;
    }
    return loading;
  }

  /** A playable URL for a file: from Cache Storage when it is there, else its own URL. */
  private async fileUrl(src: string): Promise<string> {
    const res = await this.fileResponse(src);
    return res ? URL.createObjectURL(await res.blob()) : soundUrl(this.game, src);
  }

  /** The audio clock's time for a moment on this device's clock (ms). */
  private when(localAt: number) {
    return this.ctx!.currentTime + Math.max(0, localAt - Date.now()) / 1000;
  }

  private source(buffer: AudioBuffer, volume: number) {
    const ctx = this.ctx!;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, volume));
    node.connect(gain);
    gain.connect(ctx.destination);
    return { node, gain };
  }

  /**
   * Plays an effect at `localAt` (this device's clock), cut off after `maxMs` when set; skipped
   * when it couldn't load before `latest`.
   */
  async effect(src: string, localAt: number, volume: number, latest: number, maxMs?: number) {
    const buffer = await this.load(src);
    if (!buffer || !this.ctx || Date.now() > latest) return;
    const { node, gain } = this.source(buffer, volume);
    const start = this.when(localAt);
    node.start(start);
    if (maxMs) {
      const end = start + maxMs / 1000;
      gain.gain.setValueAtTime(gain.gain.value, Math.max(start, end - 0.08));
      gain.gain.linearRampToValueAtTime(0, end);
      node.stop(end);
    }
  }

  /**
   * Says a decoded clip from `localAt`; `onEnd` runs once when it has ended or been cut. Returns
   * null when the audio isn't running.
   */
  say(
    buffer: AudioBuffer,
    localAt: number,
    volume: number,
    onEnd: () => void,
    skipMs = 0,
  ): Saying | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const { node, gain } = this.source(buffer, volume);
    let done = false;
    node.onended = () => {
      if (done) return;
      done = true;
      gain.disconnect();
      onEnd();
    };
    node.start(this.when(localAt), skipMs / 1000);
    return {
      cut: (ms) => {
        if (done) return;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
        try {
          node.stop(t + ms / 1000);
        } catch {
          node.onended?.(new Event('ended'));
        }
      },
    };
  }

  private ramp(p: MusicPlayer, to: number, ms: number) {
    if (!p.gain) {
      clearInterval(p.fade);
      const from = p.el.volume;
      const start = Date.now();
      p.fade = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / ms);
        p.el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
        if (t >= 1) clearInterval(p.fade);
      }, 50);
      return;
    }
    const t = this.ctx!.currentTime;
    const g = p.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(to, t + ms / 1000);
  }

  /** The music: `src` crossfaded in at `level` (null fades out what plays). */
  setMusic(src: string | null, level: number) {
    if (!this.ctx || this.track === src) return;
    this.track = src;
    this.level = level;
    const old = this.current;
    if (old) {
      this.ramp(old, 0, CROSSFADE_MS);
      clearTimeout(old.stopTimer);
      old.stopTimer = setTimeout(() => {
        old.el.pause();
        old.src = null;
        if (old.url) URL.revokeObjectURL(old.url);
        old.url = null;
      }, CROSSFADE_MS);
    }
    this.current = null;
    if (!src) return;
    const next = this.music.find((p) => p !== old) ?? this.music[0]!;
    clearTimeout(next.stopTimer);
    next.src = src;
    void this.fileUrl(src).then((url) => {
      if (this.track !== src || next.src !== src) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      if (next.url) URL.revokeObjectURL(next.url);
      next.url = url.startsWith('blob:') ? url : null;
      next.el.src = url;
      clearInterval(next.fade);
      if (next.gain) next.gain.gain.value = 0;
      else next.el.volume = 0;
      void next.el.play().catch(() => {});
      this.current = next;
      this.ramp(next, this.level, CROSSFADE_MS);
    });
  }

  /** The music's volume now (ducked under the voice, or the device's volume changed). */
  setMusicLevel(level: number) {
    this.level = level;
    if (this.current) this.ramp(this.current, level, DUCK_FADE_MS);
  }
}

const engines = new Map<string, SoundEngine>();
/** A game's one sound engine on this page (shared by every room of it the tab visits). */
export function soundEngineFor(game: string): SoundEngine {
  let e = engines.get(game);
  if (!e) engines.set(game, (e = new SoundEngine(game)));
  return e;
}
