import {
  type Moment,
  type Profile,
  type Rig,
  STALE_MS,
  type Scheduled,
  type ShowKeyframe,
  type Step,
  countAt,
  momentEnd,
  schedule,
  trackEnd,
  trackKeyframes,
  trackOf,
} from '@vt/game-sdk/show';
import { burst } from './confetti.ts';

// The browser half of a moment: `schedule` (pure, in @vt/game-sdk/show) says which steps this device
// plays and how late each is; this turns them into Web Animations on HTML layers (transform and
// opacity only, so the compositor runs them), timers for state changes, sounds, haptics and
// flashes, and one animation frame loop for a count-up while it runs. Nothing is left running at
// rest: a finished animation writes its end pose into the element's style and is dropped.

/** Plays a sound `offsetMs` into the clip, so a late one still ends on time. */
export interface ShowAudio {
  play: (clip: string, offsetMs: number, gain?: number) => void;
}

export interface ShowEnv {
  /** The server clock: `Date.now()` corrected by the room's offset. */
  clock: () => number;
  profile: Profile;
  you: string | null;
  reduced: boolean;
  low: boolean;
  tracks: Rig['tracks'];
  /** The element a step names, or null (the step is skipped). */
  el: (target: string) => HTMLElement | null;
  audio?: ShowAudio | null;
  /** Fills a text's placeholders (`{p:id}`) for display. */
  words?: (text: string) => string;
  /** Draws a frame-sequence sheet (not in wave 1: sprites are skipped without it). */
  sprite?: (el: HTMLElement, sheet: string, offsetMs: number, ms: number) => void;
}

export interface Playing {
  cancel: () => void;
  /** Jumps every animation to its end (a hidden page coming back). */
  finish: () => void;
  /**
   * Stops and leaves everything where the moment would have left it (its state moved on before
   * it was over): what is still to come shows its end state, sounds and buzzes are dropped.
   */
  settle: () => void;
  pause: () => void;
}

/** A reduced-motion change still to come fades in over this long. */
const SETTLE_MS = 150;

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function countText(step: Extract<Step, { kind: 'count' }>, n: number): string {
  return step.format === 'money' ? money(n) : String(Math.round(n));
}

const toKeyframes = (kf: ShowKeyframe[]): Keyframe[] => kf as Keyframe[];

/** Plays a moment on this device from wherever the server clock says it is. */
export function play(m: Moment, env: ShowEnv): Playing {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const anims: Animation[] = [];
  const stops: (() => void)[] = [];
  let frame = 0;
  const counts = new Set<() => boolean>();

  const later = (ms: number, run: () => void) => {
    if (ms <= 0) run();
    else timers.push(setTimeout(run, ms));
  };
  const words = (t: string) => (env.words ? env.words(t) : t);
  /** Steps that leave nothing behind check again when they fire: a throttled tab may be late. */
  const fresh = (start: number) => env.clock() - (m.at + start) <= STALE_MS;

  const animate = (el: HTMLElement, kf: Keyframe[], opts: KeyframeAnimationOptions, at = 0) => {
    const a = el.animate(kf, { fill: 'forwards', ...opts });
    if (at > 0) a.currentTime = at;
    a.onfinish = () => {
      try {
        a.commitStyles();
      } catch {
        // A detached element keeps no style: nothing to commit.
      }
      a.cancel();
    };
    anims.push(a);
    return a;
  };

  const tick = () => {
    for (const run of counts) if (!run()) counts.delete(run);
    frame = counts.size ? requestAnimationFrame(tick) : 0;
  };

  const run = (s: Scheduled) => {
    const { step } = s;
    switch (step.kind) {
      case 'anim':
      case 'css': {
        const el = env.el(step.target);
        if (!el) return;
        const track = step.kind === 'anim' ? trackOf(env.tracks, step.track) : null;
        if (step.kind === 'anim' && !track) return;
        const kf = track ? trackKeyframes(track) : step.kind === 'css' ? step.keyframes : [];
        if (s.mode === 'end') {
          const end = track ? trackEnd(track) : (kf.at(-1) ?? {});
          later(s.delay, () => {
            if (end.transform) el.style.transform = end.transform;
            const to = String(end.opacity ?? 1);
            // A change still to come fades in; one already past is simply there.
            if (s.delay > 0) animate(el, [{ opacity: to }], { duration: SETTLE_MS });
            el.style.opacity = to;
          });
          return;
        }
        animate(
          el,
          toKeyframes(kf),
          {
            duration: s.ms,
            delay: s.delay,
            easing: step.kind === 'css' ? (step.easing ?? 'ease-out') : 'linear',
          },
          s.offset,
        );
        return;
      }
      case 'count': {
        const el = env.el(step.target);
        if (!el) return;
        if (s.mode === 'end') {
          later(s.delay, () => (el.textContent = countText(step, step.to)));
          return;
        }
        later(s.delay, () => {
          const t0 = performance.now() - s.offset;
          const go = () => {
            const k = (performance.now() - t0) / s.ms;
            el.textContent = countText(step, countAt(step.from, step.to, k));
            return k < 1;
          };
          if (go()) {
            counts.add(go);
            frame ||= requestAnimationFrame(tick);
          }
        });
        return;
      }
      case 'set':
        later(s.delay, () => env.el(step.target)?.setAttribute(step.attr, step.value));
        return;
      case 'text':
        later(s.delay, () => {
          const el = env.el(step.target);
          if (el) el.textContent = words(step.text);
        });
        return;
      case 'subtitle': {
        const text = words(step.text);
        later(s.delay, () => {
          const el = env.el('subtitle');
          if (!el) return;
          el.textContent = text;
          if (s.ms > 0) {
            later(s.ms - s.offset, () => {
              if (el.textContent === text) el.textContent = '';
            });
          }
        });
        return;
      }
      case 'sfx':
        later(s.delay, () => {
          if (fresh(step.t)) env.audio?.play(step.clip, s.offset, step.gain);
        });
        return;
      case 'voice': {
        const clip = s.clip;
        if (!clip) return;
        later(s.delay, () => {
          if (!fresh(step.t + elapsedTo(step, clip))) return;
          env.audio?.play(clip.clip, s.offset);
          const sub = clip.text && env.el('subtitle');
          if (sub) sub.textContent = words(clip.text!);
        });
        return;
      }
      case 'haptic':
        later(s.delay, () => {
          if (fresh(step.t) && env.profile !== 'stage') navigator.vibrate?.(step.pattern);
        });
        return;
      case 'flash': {
        const el = env.el('flash');
        if (!el) return;
        later(s.delay, () => {
          el.setAttribute('data-colour', step.colour);
          animate(
            el,
            [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }],
            { duration: s.ms },
            s.offset,
          );
        });
        return;
      }
      case 'shake': {
        const el = env.el(step.target);
        if (!el) return;
        const p = step.px;
        const kf = [0, p, -p, p * 0.6, -p * 0.6, p * 0.3, 0].map((x, i) => ({
          transform: `translate(${x}px,${i % 2 ? -x / 2 : x / 2}px)`,
        }));
        animate(el, kf, { duration: s.ms, delay: s.delay, fill: 'none' }, s.offset);
        return;
      }
      case 'confetti': {
        const el = env.el('confetti');
        if (el instanceof HTMLCanvasElement) {
          later(s.delay, () => stops.push(burst(el, step.n, s.offset)));
        }
        return;
      }
      case 'sprite': {
        const el = env.el(step.target);
        if (el) later(s.delay, () => env.sprite?.(el, step.sheet, s.offset, s.ms));
        return;
      }
    }
  };

  for (const s of schedule(m, env.clock(), env)) run(s);

  const cancel = () => {
    timers.forEach(clearTimeout);
    timers.length = 0;
    anims.forEach((a) => a.cancel());
    stops.forEach((stop) => stop());
    if (frame) cancelAnimationFrame(frame);
    counts.clear();
  };
  return {
    cancel,
    settle() {
      cancel();
      // As a device arriving after the end would: every state at its end, nothing transient.
      const after = m.at + momentEnd(m, env.tracks) + STALE_MS + 1;
      for (const s of schedule(m, after, env)) run(s);
    },
    finish() {
      anims.forEach((a) => a.playState !== 'idle' && a.finish());
      stops.forEach((stop) => stop());
    },
    pause() {
      anims.forEach((a) => a.playState === 'running' && a.pause());
    },
  };
}

/** Where a clip starts inside its voice step. */
function elapsedTo(step: Extract<Step, { kind: 'voice' }>, clip: { clip: string }): number {
  let t = 0;
  for (const c of step.clips) {
    if (c === clip) return t;
    t += c.ms;
  }
  return t;
}
