import { storageKey } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nextMove } from '../../logic/bot.ts';
import { type CaseDial, turnDial } from '../../logic/game.ts';
import type { Look as DefuserLook, ModuleOp, Settings } from '../../logic/types.ts';
import type { BombView } from '../../logic/view.ts';
import type { Art } from '../assets.ts';
import { haptics } from '../haptics.ts';
import { SIMON_TONES, player } from '../sound.ts';
import { serverNow } from '../time.ts';
import { type Device, HINTS, type HintStep, doneBy, hintFor } from './controls.ts';
import { type Pack, type Quality, loadPack } from './rig.ts';
import type { EdgeArrows } from './glance.ts';
import { type RoomPack, roomLook } from './room.ts';
import { BombScene, type Mirror, type Pose, sharedRenderer } from './scene.ts';

const HINTS_KEY = 'vt.defuse.hints-3d';
export const VIEW_KEY = 'vt.defuse.view';
const LITE_KEY = 'vt.defuse.lite';

const read = (key: string) => {
  try {
    return localStorage.getItem(storageKey(key));
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(storageKey(key), value);
  } catch {
    // a private window: the choice lasts for this page
  }
};

/** The player's own choice of defuser view: the 3D bomb (the default) or the flat one. */
export function useViewMode(): ['3d' | '2d', (m: '3d' | '2d') => void] {
  const [mode, setMode] = useState<'3d' | '2d'>(() => (read(VIEW_KEY) === '2d' ? '2d' : '3d'));
  return [
    mode,
    (m) => {
      write(VIEW_KEY, m);
      setMode(m);
    },
  ];
}

/** The lighter setting: half the render scale and half-size textures, only when chosen. */
const lite = () => read(LITE_KEY) === '1';

const packs = new Map<string, Promise<Pack | null>>();
function packFor(
  base: string | null,
  quality: Quality,
  renderer: ReturnType<typeof sharedRenderer>,
) {
  const k = `${base}|${quality}`;
  let p = packs.get(k);
  if (!p) {
    p = base ? loadPack(base, renderer, quality).catch(() => null) : Promise.resolve(null);
    packs.set(k, p);
  }
  return p;
}

const rooms = new Map<string, Promise<RoomPack | null>>();
function roomFor(
  base: string | null,
  scene: string | null,
  quality: Quality,
  renderer: ReturnType<typeof sharedRenderer>,
) {
  const k = `${base}|${quality}`;
  let p = rooms.get(k);
  if (!p) {
    p =
      base && scene
        ? (loadPack(base, renderer, quality, 'room', `${scene}basis/`) as Promise<RoomPack>).catch(
            () => null,
          )
        : Promise.resolve(null);
    rooms.set(k, p);
  }
  return p;
}

async function fontsReady(families: (string | null)[]) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const wait = Promise.all(
    families.flatMap((f) =>
      f ? [document.fonts.load(`64px ${f.split(',')[0]}`).catch(() => [])] : [],
    ),
  );
  await Promise.race([wait, new Promise((r) => setTimeout(r, 3000))]);
}

const touchDevice = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export interface Bomb3DProps {
  /** The bomb, or null for the briefcase on the desk (the lobby). */
  b: BombView | null;
  /**
   * The briefcase: the host's settings on its displays, its keys and switches (`change`, null
   * for anyone but the host), and its Start.
   */
  briefcase?: {
    settings: Settings;
    start: () => void;
    change: ((settings: Partial<Settings>) => void) | null;
  } | null;
  /** The defuser presses the alarm clock's snooze. */
  snooze?: () => void;
  /** Back to the lobby from the desk (the briefcase). */
  leave?: () => void;
  art: Art;
  offset: number;
  /** null on a read-only screen (the table screen). */
  act: ((module: string, op: ModuleOp) => void) | null;
  /** The table screen follows the defuser's pose. */
  mirror?: DefuserLook | null;
  /** The defuser's pose, for a table screen showing the bomb. */
  onPose?: (m: Mirror) => void;
  /** The corner controls: the sound switch, the rules, the view switch. */
  corner?: ReactNode;
  /** Browser tests: the scene's hooks on `window.__defuse3d`. */
  test?: boolean;
  /** The bomb has ended on this device (the slap: dark and the boom, or the defused bomb). */
  fullScreen?: boolean;
}

/** The defuser's 3D bomb, full screen, with only the original's overlay. */
export function Bomb3D({
  b,
  briefcase,
  snooze,
  leave,
  art,
  offset,
  act,
  mirror,
  onPose,
  corner,
  test,
  fullScreen = true,
}: Bomb3DProps) {
  const box = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BombScene | null>(null);
  const [ready, setReady] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [pose, setPose] = useState<Pose>('desk');
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [vibration, setVibration] = useState(() => haptics.enabled);
  const [embedded, setEmbedded] = useState(false);
  const [touch] = useState(touchDevice);
  const device: Device = touch ? 'touch' : 'mouse';
  const readOnly = !act;
  const [done, setDone] = useState<Set<HintStep>>(() => {
    try {
      return new Set(JSON.parse(read(HINTS_KEY) ?? '[]') as HintStep[]);
    } catch {
      return new Set();
    }
  });
  const [portrait, setPortrait] = useState(false);
  const bRef = useRef(b);
  const actRef = useRef(act);
  const onPoseRef = useRef(onPose);
  const caseRef = useRef(briefcase);
  const snoozeRef = useRef(snooze);
  /** The briefcase's line: null, or a key and when it was set (the non-host's note). */
  const [caseNote, setCaseNote] = useState<string | null>(null);
  /** The edge arrows and bars for the cursor (`NonVRHUD`): 0, ½ or full strength. */
  const [edges, setEdges] = useState<EdgeArrows>({ left: 0, right: 0, top: 0, bottom: 0 });
  /** The settings the host's briefcase shows while their turns are on the way. */
  const caseNow = useRef<Settings | null>(null);
  const [starting, setStarting] = useState(false);
  useLayoutEffect(() => {
    bRef.current = b;
    actRef.current = act;
    onPoseRef.current = onPose;
    caseRef.current = briefcase;
    snoozeRef.current = snooze;
  });

  // One scene per mount, on the page's one renderer.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const light = lite();
    const renderer = sharedRenderer(light ? 1 : 2);
    el.prepend(renderer.domElement);
    let live = true;
    let scene: BombScene | null = null;
    const ro = new ResizeObserver(() => {
      scene?.resize();
      setPortrait(el.clientHeight > el.clientWidth);
    });
    ro.observe(el);
    void Promise.all([
      packFor(art.scene, light ? 'lo' : 'hi', renderer),
      roomFor(art.room, art.scene, light ? 'lo' : 'hi', renderer),
      fontsReady([art.fonts.digits, art.fonts.labels, art.fonts.morse]),
    ]).then(([pack, room]) => {
      if (!live) return;
      const brief = caseRef.current;
      scene = new BombScene(renderer, {
        pack,
        room,
        briefcase: brief
          ? {
              settings: brief.settings,
              start: () => {
                setStarting(true);
                caseRef.current?.start();
              },
              turn: (dial) => {
                const c = caseRef.current;
                if (!c?.change) {
                  setCaseNote(`only-host:${Date.now()}`);
                  return;
                }
                // The host's own displays move at once; the room's settings follow.
                const now = caseNow.current ?? c.settings;
                const step = turnDial(now, dial);
                if (!step) return;
                caseNow.current = { ...now, ...step };
                sceneRef.current?.setCase(caseNow.current);
                c.change(step);
              },
            }
          : null,
        snooze: () => snoozeRef.current?.(),
        edges: (a) =>
          setEdges((e) =>
            e.left === a.left && e.right === a.right && e.top === a.top && e.bottom === a.bottom
              ? e
              : a,
          ),
        readOnly,
        ctx: {
          touch,
          beep: (freq, ms, gain) => {
            if (!readOnly) player.tone(freq, ms, gain);
          },
          glyph: (n) => art.glyph(n),
          fonts: {
            digits: art.fonts.digits ?? 'ui-monospace, monospace',
            labels: art.fonts.labels ?? 'system-ui, sans-serif',
            morse: art.fonts.morse ?? 'ui-monospace, monospace',
          },
        },
        act: (module, op) => actRef.current?.(module, op),
        sound: (name, gain) => {
          if (!readOnly) player.play(art.effect(name), gain);
        },
        tone: (i, ms) => player.tone(SIMON_TONES[i]!, ms),
        vibrate: (type, modifier) => {
          if (!readOnly) haptics.buzz(type, modifier);
        },
        hint: (e) => {
          const steps = doneBy(e);
          if (!steps.length) return;
          setDone((d) => {
            if (steps.every((s) => d.has(s))) return d;
            const next = new Set([...d, ...steps]);
            write(HINTS_KEY, JSON.stringify([...next]));
            return next;
          });
        },
        scan: (offset) => {
          // `Scanline.UpdatePosition`: the line's middle at y = 1 − offset × 1.33 from the bottom.
          const el = band.current;
          if (!el) return;
          el.style.opacity = offset === null ? '0' : '1';
          if (offset !== null) el.style.top = `${(offset * 1.33 * 100).toFixed(2)}%`;
        },
        onPose: (m) => {
          setPose(m.pose);
          onPoseRef.current?.(m);
        },
        now: () => serverNow(offset),
      });
      scene.onDrag = setDragging;
      sceneRef.current = scene;
      setReady(pack || !art.scene ? 'ready' : 'failed');
      setPortrait(el.clientHeight > el.clientWidth);
    });
    return () => {
      live = false;
      ro.disconnect();
      scene?.dispose();
      sceneRef.current = null;
      renderer.domElement.remove();
    };
    // The scene is built once per mount; the bomb and pose arrive through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.scene]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !b) return;
    s.setBomb(b);
    s.setEnded(!!b.end);
  }, [b, ready]);

  // The non-host's note stays a few seconds.
  useEffect(() => {
    if (!caseNote) return;
    const t = setTimeout(() => setCaseNote(null), 3000);
    return () => {
      clearTimeout(t);
    };
  }, [caseNote]);

  const caseSettings = briefcase ? JSON.stringify(briefcase.settings) : '';
  useEffect(() => {
    caseNow.current = null;
    if (briefcase) sceneRef.current?.setCase(briefcase.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSettings, ready]);

  useEffect(() => {
    if (mirror && mirror.mode === '3d') sceneRef.current?.setMirror(mirror);
  }, [mirror, ready]);

  // Test hooks (browser tests only, never in production: the server sends `test` then).
  useEffect(() => {
    if (!test || ready !== 'ready') return;
    const w = window as unknown as { __defuse3d?: unknown };
    w.__defuse3d = {
      where: (id: string, i?: number) => sceneRef.current?.where(id, i) ?? null,
      focus: (id: string) => sceneRef.current?.focusById(id),
      press: (i: number) => sceneRef.current?.pressPart(i),
      release: () => sceneRef.current?.releasePart(),
      back: () => sceneRef.current?.back(),
      pickUp: () => sceneRef.current?.pickUp(),
      glance: () => sceneRef.current?.glanceNow() ?? [0, 0],
      dial: (d: CaseDial) => sceneRef.current?.turnCase(d),
      turn: (d: 'up' | 'down' | 'left' | 'right') => sceneRef.current?.turnBy(d),
      edges: () => sceneRef.current?.edges() ?? [],
      pose: () => ({
        pose: sceneRef.current?.pose,
        module: sceneRef.current?.focused?.id ?? null,
        face: sceneRef.current?.face() ?? 0,
      }),
      info: () => sceneRef.current?.info(),
      lit: () => sceneRef.current?.lit() ?? [],
      middle: (id: string) => sceneRef.current?.middle(id) ?? null,
      look: (id: string) => sceneRef.current?.lookOf(id) ?? null,
      partFor: (id: string, op: ModuleOp) => sceneRef.current?.partFor(id, op) ?? -1,
      next: () => (bRef.current ? nextMove(bRef.current, serverNow(offset)) : null),
      thing: (name: 'case' | 'start' | 'clock' | 'snooze') =>
        sceneRef.current?.whereThing(name) ?? null,
      config: () => sceneRef.current?.configNow() ?? null,
      configAt: (t: number) => roomLook(bRef.current, t).config,
      pickAt: (x: number, y: number) => {
        const p = sceneRef.current?.pick(x, y);
        return p ? { kind: p.kind, path: (p.node.userData.path as string) ?? null } : null;
      },
      room: () => !!sceneRef.current?.room,
      bomb: () => bRef.current,
      haptics: () => haptics.log,
      zoom: () => sceneRef.current?.zoomState() ?? null,
    };
    return () => {
      delete w.__defuse3d;
    };
  }, [test, ready, offset]);

  // The round Back button, on touch away from the desk; the desk's Lobby button moves beside it.
  const backShown = touch && pose !== 'desk' && !b?.end;
  const step =
    readOnly || b?.end || briefcase ? null : hintFor(pose === 'clock' ? 'desk' : pose, done);
  const scene = sceneRef.current;
  const exploded = !!b?.end && b.end.how !== 'defused';
  // `GameplayState.StartRound`: Start fades to black, then the dark room with the timer. Worked
  // out once per bomb, so later renders never restart the fades.
  const startedAt = b?.startedAt ?? null;
  const fadeIn = useMemo(() => {
    const now = serverNow(offset);
    return startedAt !== null && now < startedAt + 1600 ? Math.max(0, startedAt + 500 - now) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);
  // Defused: the room stays 6 s, then fades to black over 3 s (`SceneManager.BombDefused`).
  const defusedAt = b?.end?.how === 'defused' ? b.end.at : null;
  const fadeOut = useMemo(() => {
    const now = serverNow(offset);
    return defusedAt !== null && now < defusedAt + 9000
      ? { delay: defusedAt + 6000 - now, ms: 3000 }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defusedAt]);
  return (
    <div
      className={cn(
        'overflow-hidden bg-[#0b0b0d] text-stone-100 select-none',
        fullScreen && !embedded
          ? 'fixed inset-0 z-[60]'
          : readOnly
            ? 'relative size-full rounded-xl'
            : 'relative h-[70vh] w-full rounded-xl',
      )}
      style={{ touchAction: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      data-testid="bomb-3d"
      data-pose={pose}
      data-ready={ready}
    >
      <div ref={box} className="absolute inset-0" />
      {/* The touch hint's scanline (the original's sprite: white, at most 10 % opaque). */}
      <div
        ref={band}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 h-[12%] -translate-y-1/2 opacity-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.1) 50%, rgba(255,255,255,0))',
        }}
        data-testid="scanline"
      />
      {ready === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center text-lg text-stone-300">
          Loading the bomb…
        </div>
      )}
      {ready === 'failed' && (
        <div className="absolute inset-x-0 top-1/3 text-center text-sm text-stone-300">
          The bomb’s pictures didn’t load: it is shown plainly.
        </div>
      )}
      {exploded && <div className="absolute inset-0 bg-black" data-testid="explode-black" />}
      <style>{`@keyframes vt-defuse-out{from{opacity:1}to{opacity:0}}@keyframes vt-defuse-in{from{opacity:0}to{opacity:1}}`}</style>
      {fadeIn !== null && (
        <div
          className="pointer-events-none absolute inset-0 bg-black"
          style={{ animation: `vt-defuse-out 1s ease ${fadeIn}ms forwards` }}
          data-testid="start-fade"
        />
      )}
      {(starting || fadeOut) && (
        <div
          className="pointer-events-none absolute inset-0 bg-black opacity-0"
          style={{
            animation: fadeOut
              ? `vt-defuse-in ${fadeOut.ms}ms ease ${fadeOut.delay}ms forwards`
              : 'vt-defuse-in 1.5s ease forwards',
          }}
          data-testid="end-fade"
        />
      )}
      {!readOnly && !touch && (
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          data-testid="glance-edges"
        >
          {(['left', 'right', 'top', 'bottom'] as const).map((d) => (
            <div
              key={d}
              className={cn(
                'absolute flex items-center justify-center text-2xl text-white transition-opacity duration-150',
                d === 'left' && 'inset-y-0 left-0 w-8 bg-gradient-to-r from-white/25',
                d === 'right' && 'inset-y-0 right-0 w-8 bg-gradient-to-l from-white/25',
                d === 'top' && 'inset-x-0 top-0 h-8 bg-gradient-to-b from-white/25',
                d === 'bottom' && 'inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white/25',
              )}
              style={{ opacity: edges[d] }}
            >
              {{ left: '‹', right: '›', top: '︿', bottom: '﹀' }[d]}
            </div>
          ))}
        </div>
      )}
      {briefcase && !starting && (
        <>
          {leave && (
            <button
              type="button"
              onClick={leave}
              className={cn(
                'absolute rounded-full bg-stone-900/70 px-4 py-2.5 text-sm',
                // Beside the round Back button while it shows (the briefcase held on touch).
                backShown
                  ? 'left-[calc(max(12px,env(safe-area-inset-left))+60px)] top-[calc(max(12px,env(safe-area-inset-top))+6px)]'
                  : 'left-[max(12px,env(safe-area-inset-left))] top-[max(12px,env(safe-area-inset-top))]',
              )}
              data-testid="desk-lobby"
            >
              ‹ Lobby
            </button>
          )}
          <p
            className="pointer-events-none absolute inset-x-0 bottom-[max(10px,env(safe-area-inset-bottom))] truncate px-4 text-center text-[min(17px,3.8vw)] text-[#ffe066] [text-shadow:0_1px_3px_#000,0_0_8px_#000]"
            data-testid="case-hint"
          >
            {caseNote
              ? 'Only the host can change the settings'
              : pose === 'desk'
                ? touch
                  ? 'Tap the briefcase to pick it up'
                  : 'Click the briefcase to pick it up'
                : 'Press START to begin'}
          </p>
        </>
      )}
      {!readOnly && (
        <>
          <button
            type="button"
            aria-label="Back"
            onClick={() => scene?.back()}
            className={cn(
              'absolute left-[max(12px,env(safe-area-inset-left))] top-[max(12px,env(safe-area-inset-top))] size-13 rounded-full bg-stone-900/55 text-3xl leading-none transition-opacity active:bg-stone-700/80',
              backShown ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            data-testid="bomb-back"
          >
            ‹
          </button>
          {(['up', 'down', 'left', 'right'] as const).map((d) => (
            <button
              key={d}
              type="button"
              aria-label={`Turn ${d}`}
              onClick={() => scene?.turnBy(d)}
              className={cn(
                'absolute size-13 rounded-full bg-stone-900/55 text-2xl leading-none transition-opacity active:bg-stone-700/80',
                d === 'up' && 'left-[calc(50%-26px)] top-[max(14px,env(safe-area-inset-top))]',
                d === 'down' &&
                  'bottom-[max(14px,env(safe-area-inset-bottom))] left-[calc(50%-26px)]',
                d === 'left' && 'left-[max(12px,env(safe-area-inset-left))] top-[calc(50%-26px)]',
                d === 'right' &&
                  'right-[max(12px,env(safe-area-inset-right))] top-[calc(50%-26px)]',
                touch && pose === 'held' && !dragging && !b?.end && !briefcase
                  ? 'opacity-100'
                  : 'pointer-events-none opacity-0',
              )}
              data-testid={`turn-${d}`}
            >
              {{ up: '▴', down: '▾', left: '◂', right: '▸' }[d]}
            </button>
          ))}
          <div className="absolute right-[max(12px,env(safe-area-inset-right))] top-[max(12px,env(safe-area-inset-top))] flex items-center gap-2">
            {embedded && (
              <button
                type="button"
                onClick={() => setEmbedded(false)}
                className="rounded-full bg-stone-900/70 px-3 py-2 text-sm"
              >
                Full screen
              </button>
            )}
            <button
              type="button"
              aria-label="Controls and settings"
              onClick={() => setSheet(true)}
              className="size-11 rounded-full bg-stone-900/55 text-xl leading-none active:bg-stone-700/80"
              data-testid="bomb-help"
            >
              ?
            </button>
          </div>
          {step && (
            <p
              className={cn(
                // One line in the bottom band, under the bomb and clear of what is tapped and of
                // the corner buttons: centred, except while the bomb is held on a phone, when the
                // turn-down arrow has the bottom middle. Upright the line sits just above that
                // arrow; sideways (no room above it) it sits beside it, to its left.
                'pointer-events-none absolute truncate whitespace-nowrap text-[min(17px,3.8vw)] text-[#ffe066] [text-shadow:0_1px_3px_#000,0_0_8px_#000]',
                touch && pose === 'held' && portrait
                  ? 'inset-x-0 bottom-[max(74px,calc(env(safe-area-inset-bottom)+66px))] px-4 text-center'
                  : touch && pose === 'held'
                    ? 'bottom-[max(28px,calc(env(safe-area-inset-bottom)+14px))] left-[max(12px,env(safe-area-inset-left))] right-[calc(50%+38px)] text-right text-[min(17px,1.9vw)]'
                    : 'inset-x-0 bottom-[max(10px,env(safe-area-inset-bottom))] px-4 text-center',
              )}
              data-testid="bomb-hint"
            >
              {HINTS[device][step]}
            </p>
          )}
          {sheet && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setSheet(false)}
              data-testid="bomb-sheet"
            >
              <div
                className="max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-[#1c1b1a] p-5 text-[15px] leading-normal text-stone-100"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="mb-2 text-lg font-semibold">Controls</h2>
                <table className="w-full">
                  <tbody>
                    {(touch ? TOUCH_CONTROLS : MOUSE_CONTROLS).map(([k, v]) => (
                      <tr key={k}>
                        <td className="whitespace-nowrap py-1 pr-3 align-top text-[#ffe066]">
                          {k}
                        </td>
                        <td className="py-1 align-top">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {corner}
                  {haptics.supported && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={vibration}
                      className="rounded-full bg-stone-800 px-3 py-2 text-sm"
                      onClick={() => {
                        haptics.enabled = !vibration;
                        setVibration(!vibration);
                        haptics.buzz('Interaction');
                      }}
                      data-testid="bomb-vibration"
                    >
                      Vibration: {vibration ? 'on' : 'off'}
                    </button>
                  )}
                  {haptics.supported && vibration && (
                    <span className="basis-full text-xs text-stone-300">
                      A phone on silent doesn’t vibrate.
                    </span>
                  )}
                  <button
                    type="button"
                    className="rounded-full bg-stone-800 px-3 py-2 text-sm"
                    onClick={() => {
                      write(LITE_KEY, lite() ? '0' : '1');
                      location.reload();
                    }}
                    data-testid="bomb-lite"
                  >
                    {lite() ? 'Full graphics' : 'Lighter graphics'}
                  </button>
                  {fullScreen && (
                    <button
                      type="button"
                      className="rounded-full bg-stone-800 px-3 py-2 text-sm"
                      onClick={() => {
                        setEmbedded(!embedded);
                        setSheet(false);
                      }}
                    >
                      {embedded ? 'Full screen' : 'Show the room'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ml-auto rounded-full bg-[#ffe066] px-4 py-2 text-sm font-semibold text-stone-950"
                    onClick={() => setSheet(false)}
                  >
                    Back to the bomb
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const TOUCH_CONTROLS: [string, string][] = [
  ['Tap', 'pick up the bomb, look at a module, cut, press'],
  ['Drag', 'turn the bomb (it settles square when you let go)'],
  ['Pinch', 'zoom in and out, on any side; move both fingers to look around'],
  ['Drag off the bomb', 'drag outside the bomb to look around the room'],
  ['‹ or two-finger tap', 'step back: module → bomb → desk (or tap off the bomb)'],
  ['▴ ▾ ◂ ▸', 'a quarter turn, to read the edges'],
];
const MOUSE_CONTROLS: [string, string][] = [
  ['Click', 'pick up, look at a module, cut, press (hold for the big button)'],
  ['Right-drag', 'turn the bomb (Ctrl+drag on a one-button mouse); it settles square'],
  ['Wheel, + −', 'zoom (the wheel toward the cursor)'],
  ['Screen edge', 'move to the screen edge and hold the button to look around'],
  ['Right-click, Esc', 'step back: module → bomb → desk'],
  ['← → ↑ ↓, WASD', 'a quarter turn; F turns it over'],
  ['Tab, Enter', 'next module, look at it; 1–9 use its parts in order'],
];
