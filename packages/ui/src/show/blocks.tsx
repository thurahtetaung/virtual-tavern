import { type Track, matrixCss, trackEnd } from '@vt/game-sdk/show';
import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { symbolSource } from './art.ts';
import type { LoadedRig } from './rig.ts';

// The show's building blocks: HTML layers (absolutely placed, transform origin top left) holding
// inline SVG parts from a rig or live text. Nothing here animates layout or reads it during play;
// moments move the layers through their names (`useShowTargets`), and only transform and opacity
// ever change.

/** Names → elements, for a moment's `target`s. */
export class ShowTargets {
  private els = new Map<string, HTMLElement>();
  private refs = new Map<string, (el: HTMLElement | null) => void>();
  /** A stable ref callback that registers an element under `name`. */
  ref(name: string) {
    let r = this.refs.get(name);
    if (!r) {
      r = (el) => {
        if (el) this.els.set(name, el);
        else this.els.delete(name);
      };
      this.refs.set(name, r);
    }
    return r;
  }
  el = (name: string): HTMLElement | null => this.els.get(name) ?? null;
}

const Targets = createContext<ShowTargets | null>(null);

/** The scene's targets; pass `el` to the show's env. */
export function useShowTargets(): ShowTargets {
  return useMemo(() => new ShowTargets(), []);
}

export function ShowTargetsProvider({
  targets,
  children,
}: {
  targets: ShowTargets;
  children: ReactNode;
}) {
  return <Targets.Provider value={targets}>{children}</Targets.Provider>;
}

/** A ref that registers the element under `name` (nothing without a name or provider). */
export function useTarget(name: string | undefined) {
  const targets = useContext(Targets);
  return name && targets ? targets.ref(name) : undefined;
}

const LAYER: CSSProperties = { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0' };

/** A positioned layer: `m` is its resting matrix in its parent's stage units. */
export function Layer({
  m,
  name,
  moving,
  className,
  style,
  children,
}: {
  m?: readonly number[] | undefined;
  name?: string;
  /** It moves: give it its own compositor layer (static art never gets one). */
  moving?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useTarget(name);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...LAYER,
        ...(m && { transform: matrixCss(m) }),
        ...(moving && { willChange: 'transform, opacity' }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A rig symbol drawn at its own coordinates. */
export function RigArt({
  rig,
  symbol,
  tint,
}: {
  rig: LoadedRig;
  symbol: string;
  /**
   * A CSS colour for every path (the player's colour on a silhouette), or `true` to take `--c` from
   * the parent (a stamp's tone).
   */
  tint?: string | true;
}) {
  const html = useMemo(() => symbolSource(rig, symbol, !!tint), [rig, symbol, tint]);
  return (
    <svg
      width="1"
      height="1"
      aria-hidden="true"
      overflow="visible"
      style={{
        ...LAYER,
        overflow: 'visible',
        ...(typeof tint === 'string' && ({ '--c': tint } as CSSProperties)),
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A matrix from the rig's places (one, or the `i`th of a list). */
export function placeOf(rig: LoadedRig, key: string, i = 0): number[] | undefined {
  const p = rig.places[key];
  if (!p) return undefined;
  return Array.isArray(p[0]) ? (p as number[][])[i] : (p as number[]);
}

/** A part's resting pose at the end of a track (where the moment would have left it). */
export function restOf(track: Track | undefined): CSSProperties | undefined {
  if (!track) return undefined;
  const end = trackEnd(track);
  return { transform: end.transform, opacity: end.opacity };
}

const LABEL: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  transform: 'translate(-50%, -50%)',
  whiteSpace: 'nowrap',
  fontWeight: 900,
};

/** Live text centred on its layer's origin (never baked into art). */
export function Label({
  name,
  children,
  style,
  className,
}: {
  name?: string;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useTarget(name);
  return (
    <span ref={ref} className={className} style={{ ...LABEL, ...style }}>
      {children}
    </span>
  );
}

/**
 * The stage: `width` × `height` stage units scaled to fit its box (letterboxed), vectors sharp at
 * any size. Inside: the `camera` layer (zooms and darkens the room behind everything else), the
 * `scene` layer (shakes) with the children, the `dim` overlay and the `confetti` canvas.
 */
export function Scene({
  width = 1280,
  height = 720,
  background,
  children,
  overlay,
}: {
  width?: number;
  height?: number;
  /** The room behind everything: under the camera. */
  background?: ReactNode;
  children?: ReactNode;
  /** Above the dim overlay (a spotlit seat, the host strip). */
  overlay?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // Measured only when the box changes size, never during play.
    const fit = () => setK(Math.min(el.clientWidth / width, el.clientHeight / height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [width, height]);
  return (
    <div
      ref={box}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <div
        style={{
          ...LAYER,
          width,
          height,
          left: '50%',
          top: '50%',
          overflow: 'hidden',
          transform: `scale(${k}) translate(-50%, -50%)`,
          visibility: k ? 'visible' : 'hidden',
        }}
      >
        <Layer name="camera" moving>
          {background}
        </Layer>
        <Layer name="scene" style={{ width, height }}>
          {children}
        </Layer>
        <Dim />
        {overlay}
        <Confetti />
      </div>
    </div>
  );
}

/** The room's darken overlay (`dim`), moved by the camera's darken tracks or a css step. */
export function Dim({ name = 'dim' }: { name?: string }) {
  const ref = useTarget(name);
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000',
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

/** The `confetti` canvas, filling its parent; bursts draw on it and clear it. */
export function Confetti() {
  const ref = useTarget('confetti');
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}

const FLASH_CSS =
  '.vt-flash{position:fixed;inset:0;pointer-events:none;opacity:0;z-index:60;' +
  'box-shadow:inset 0 0 0 6px var(--fc),inset 0 0 48px 12px var(--fc)}' +
  '.vt-flash[data-colour=accent]{--fc:var(--color-accent)}' +
  '.vt-flash,.vt-flash[data-colour=danger]{--fc:var(--color-danger)}' +
  '.vt-flash[data-colour=success]{--fc:var(--color-success)}';

/** The screen-edge pulse (`flash`): an inset shadow on a fixed layer, only its opacity moves. */
export function EdgeFlash() {
  const ref = useTarget('flash');
  return (
    <>
      <style>{FLASH_CSS}</style>
      <div ref={ref} className="vt-flash" aria-hidden="true" />
    </>
  );
}

/**
 * A number a `count` step counts (on the table screen by default; a quiet phone sets it at once).
 * It shows `value` until a moment counts it.
 */
export function CountUp({
  name,
  value,
  format = 'int',
  style,
  className,
}: {
  name: string;
  value: number;
  format?: 'money' | 'int';
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useTarget(name);
  const text = format === 'money' ? '$' + Math.round(value).toLocaleString('en-US') : String(value);
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {text}
    </span>
  );
}

/**
 * A paddle: the rig's handle (`wood`), a silhouette (`shape.<shape>`) in the player's colour and
 * the live amount (`<name>.num`). It rests where `rest` leaves it (default: lowered).
 */
export function Paddle({
  rig,
  name,
  shape,
  colour,
  amount = '',
  rest = 'paddle.Unraise',
}: {
  rig: LoadedRig;
  name: string;
  shape: string;
  colour: string;
  amount?: string;
  rest?: string;
}) {
  const [part, label] = rest.split('.') as [string, string];
  return (
    <Layer name={name} moving style={restOf(rig.tracks[part]?.[label])}>
      <Layer m={placeOf(rig, 'paddle.wood')}>
        <RigArt rig={rig} symbol="wood" />
      </Layer>
      <Layer m={placeOf(rig, 'paddle.shape')}>
        <RigArt rig={rig} symbol={`shape.${shape}`} tint={colour} />
      </Layer>
      <Layer m={placeOf(rig, 'paddle.num')}>
        <Label
          name={`${name}.num`}
          style={{ color: '#fff', fontSize: 22, textShadow: '0 1px 0 rgba(0,0,0,.4)' }}
        >
          {amount}
        </Label>
      </Layer>
    </Layer>
  );
}

const STAMP_CSS =
  '.vt-slab{--c:#2e2e2e}.vt-slab[data-tone=good]{--c:#003300}.vt-slab[data-tone=bad]{--c:#660000}' +
  '[data-face=value] .vt-stamp-word{font-size:44px;top:-8px}';

/**
 * The stamp: a tinted slab (`<name>.slab`, `data-tone` good/bad), its word or value
 * (`<name>.word`, face swapped through the stamp's `data-face`) and a line under it
 * (`<name>.line` in the `<name>.lineL` layer). Hidden until a moment shows it.
 */
export function Stamp({
  rig,
  name = 'stamp',
  slab = 'slab',
}: {
  rig: LoadedRig;
  name?: string;
  slab?: string;
}) {
  const slabRef = useTarget(`${name}.slab`);
  return (
    <Layer name={name} moving style={{ opacity: 0 }}>
      <style>{STAMP_CSS}</style>
      <div ref={slabRef} className="vt-slab" style={LAYER}>
        <RigArt rig={rig} symbol={slab} tint />
      </div>
      <Label
        name={`${name}.word`}
        className="vt-stamp-word"
        style={{ color: '#fff', fontSize: 58, letterSpacing: -1 }}
      />
      <Layer m={placeOf(rig, `${name}.profit`)}>
        <Layer name={`${name}.lineL`} moving style={{ opacity: 0 }}>
          <Label name={`${name}.line`} style={{ color: '#fff', fontSize: 13 }} />
        </Layer>
      </Layer>
    </Layer>
  );
}

/** A spotlight cone (the rig's `spot`), hidden until a moment drops it on a seat. */
export function Spotlight({
  rig,
  name,
  m,
}: {
  rig: LoadedRig;
  name: string;
  m?: number[] | undefined;
}) {
  return (
    <Layer m={m}>
      <Layer name={name} moving style={{ opacity: 0 }}>
        <RigArt rig={rig} symbol="spot" />
      </Layer>
    </Layer>
  );
}

/**
 * Who speaks: a portrait with a talking bob while `talking` (a two-step loop, stopped at rest) and
 * the `subtitle` strip a moment's subtitle and voice steps fill. Phones show only the strip
 * (`portrait={false}`).
 */
export function HostPortrait({
  src,
  alt,
  talking,
  portrait = true,
  className,
}: {
  src?: string | null;
  alt: string;
  talking: boolean;
  portrait?: boolean;
  className?: string;
}) {
  const img = useRef<HTMLImageElement>(null);
  const sub = useTarget('subtitle');
  useEffect(() => {
    const el = img.current;
    if (!el || !talking || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = el.animate(
      [{ transform: 'none' }, { transform: 'scale(1.03) rotate(-1.5deg)' }, { transform: 'none' }],
      { duration: 360, iterations: Infinity },
    );
    return () => {
      a.cancel();
    };
  }, [talking]);
  return (
    <div className={className}>
      {portrait && src && (
        <img ref={img} src={src} alt={alt} style={{ display: 'block', willChange: 'transform' }} />
      )}
      <p ref={sub} aria-live="polite" />
    </div>
  );
}
