import type { Profile } from '@vt/game-sdk/show';
import {
  type LoadedRig,
  LowEffectsNotice,
  ShowTargetsProvider,
  symbolSource,
  Stamp,
  useShow,
  useShowSettings,
  useShowTargets,
  useRig,
} from '@vt/ui/show';
import {
  type ReactNode,
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GoingOnceView } from '../logic/types.ts';
import { GAME_ID } from './assets.ts';
import { moments } from './show.ts';

// The phone's share of the show: its own small rig (the stamp, the LOT disc, the canvas frame and
// the hourglass; a couple of KB), fetched only once the drawing starts, and the same moments as
// the table screen, which `schedule` trims to this phone's profile: with a table screen in the
// room only the short stamp and this player's own cues, without one the fuller show.

const PhoneRig = createContext<LoadedRig | null>(null);

/** The phone's rig, for overlays inside the game. */
export const usePhoneRig = () => useContext(PhoneRig);

export function PhoneShow({
  view,
  you,
  clockOffset,
  profile,
  children,
}: {
  view: GoingOnceView;
  you: string;
  clockOffset: number;
  profile: Profile;
  children: ReactNode;
}) {
  const g = view.game;
  // Nothing in the lobby; the rig comes with the drawing (the canvas frame) and stays.
  const phase =
    !g || view.phase === 'lobby'
      ? 'lobby'
      : g.stage === 'draw' || g.stage === 'intro'
        ? 'draw'
        : g.stage === 'practice'
          ? 'practice'
          : 'auction';
  const rig = useRig(GAME_ID, 'phone', phase, phase === 'draw' ? 'auction' : undefined);
  const targets = useShowTargets();
  const { reduced, low } = useShowSettings();
  const list = useMemo(
    () => (rig ? moments(view, { you, profile }) : []),
    [rig, view, you, profile],
  );
  useShow(list, {
    clock: () => Date.now() + clockOffset,
    profile,
    you,
    reduced,
    low,
    tracks: rig?.tracks ?? {},
    el: targets.el,
  });
  // The battery saver keeps the art (it is still) and only stills the motion (`schedule`).
  return (
    <ShowTargetsProvider targets={targets}>
      <PhoneRig.Provider value={rig}>
        <LowEffectsNotice className="mb-2" />
        {children}
      </PhoneRig.Provider>
    </ShowTargetsProvider>
  );
}

/** The stage's painting is 264 px wide: a picture overlay is scaled to the picture's own width. */
const PAINTING_W = 264;

/**
 * The Sold stamp over a lot's picture on the phone, hidden until the Sold moment slams it on.
 * Without the art nothing: the Sold card says it all.
 */
export function PictureStamp() {
  const rig = usePhoneRig();
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / PAINTING_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [rig]);
  if (!rig) return null;
  return (
    <div
      ref={box}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-testid="go-picture-stamp"
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{ transform: `scale(${k})`, transformOrigin: '0 0' }}
      >
        <Stamp rig={rig} />
      </div>
    </div>
  );
}

/**
 * A rig symbol as a small picture: fitted into its box from its own bounds (measured once, when
 * it mounts; nothing is read while the show plays).
 */
export function RigIcon({ symbol, className }: { symbol: string; className?: string }) {
  const rig = usePhoneRig();
  const svg = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<string | null>(null);
  const html = useMemo(() => (rig ? symbolSource(rig, symbol) : ''), [rig, symbol]);
  useLayoutEffect(() => {
    const g = svg.current?.firstElementChild as SVGGraphicsElement | null;
    if (!g?.getBBox) return;
    const b = g.getBBox();
    if (b.width && b.height) setBox(`${b.x} ${b.y} ${b.width} ${b.height}`);
  }, [html]);
  if (!rig || !html) return null;
  return (
    <svg
      ref={svg}
      aria-hidden
      className={className}
      viewBox={box ?? '0 0 1 1'}
      style={{ visibility: box ? 'visible' : 'hidden' }}
      dangerouslySetInnerHTML={{ __html: `<g>${html}</g>` }}
    />
  );
}

/** The painting's canvas in the original: 240 × 320 at 1.1875; its paper, shadow and strings. */
const CANVAS_W = 285;
const CANVAS_H = 380;
const FRAME_AT = [136.2, 117.25];

/**
 * The drawing pad hung like a painting: the original's paper, shadow and strings behind the pad,
 * stretched to its box. Without the art, just the pad.
 */
export function PadFrame({ children }: { children: ReactNode }) {
  const rig = usePhoneRig();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !rig) return;
    const fit = () => setSize([el.clientWidth, el.clientHeight]);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [rig]);
  const html = useMemo(() => (rig ? symbolSource(rig, 'painting.frame') : ''), [rig]);
  // One tree whether or not the art has come: the pad must never remount (a drawing in progress).
  const sx = size ? size[0] / CANVAS_W : 0;
  const sy = size ? size[1] / CANVAS_H : 0;
  return (
    <div ref={box} className={rig ? 'relative mt-6' : 'relative'} data-testid="go-pad-frame">
      {rig && size && (
        // The strings show a short way above the pad, never up into the page; the frame's shadow
        // a little beyond it. Clipped by paint only: a box wider than the pad would scroll the
        // page sideways.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ clipPath: 'inset(-24px -40px -40px -40px)' }}
        >
          <svg
            className="absolute left-0 top-0 overflow-visible"
            width="1"
            height="1"
            dangerouslySetInnerHTML={{
              __html: `<g transform="matrix(${sx},0,0,${sy},${FRAME_AT[0]! * sx},${FRAME_AT[1]! * sy})">${html}</g>`,
            }}
          />
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
