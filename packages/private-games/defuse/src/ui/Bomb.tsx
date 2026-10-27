import { Button, cn } from '@vt/ui';
import { Pic } from './Pic.tsx';
import { type ReactNode, useRef, useState } from 'react';
import { leftAt, needyLeft, timerText } from '../logic/bomb.ts';
import { AREAS } from '../logic/edgework.ts';
import {
  type ModuleOp,
  type NeedyModule,
  type Side,
  type Widget,
  isNeedy,
} from '../logic/types.ts';
import type { BombView, ModuleView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { ModuleFace, PAINT, type Send, TimerFace } from './Modules.tsx';

export type View = 'front' | 'rear' | Side;
export const VIEWS: View[] = ['front', 'rear', 'top', 'right', 'bottom', 'left'];
export const VIEW_NAME: Record<View, string> = {
  front: 'Front',
  rear: 'Back',
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

/** The modules in reading order: front face first, by anchor. */
export const ordered = (b: BombView) =>
  [...b.modules].sort((x, y) => x.face - y.face || x.anchor - y.anchor);

/** Timer, strikes and the needy modules that are running: always on top of the defuser's screen. */
export function TopBar({
  b,
  now,
  onNeedy,
  extra,
}: {
  b: BombView;
  now: number;
  onNeedy?: (id: string) => void;
  extra?: ReactNode;
}) {
  const lit = now >= b.startedAt + 2000;
  const lamps = Math.max(0, b.strikeLimit - 1);
  const needy = b.modules.filter(
    (m): m is ModuleView & NeedyModule => isNeedy(m.kind) && 'state' in m && m.state === 'running',
  );
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 rounded-xl bg-stone-900 px-3 py-2 text-stone-100 shadow-md ring-1 ring-stone-700">
      <span
        data-testid="timer"
        className={cn('font-mono text-3xl font-bold tabular-nums', !lit && 'opacity-30')}
        style={{ color: PAINT.red }}
      >
        {timerText(leftAt(b, now))}
      </span>
      <span
        className="flex gap-1"
        aria-label={`${b.strikes} of ${b.strikeLimit} strikes`}
        data-testid="strikes"
        data-strikes={b.strikes}
      >
        {Array.from({ length: lamps }, (_, i) => (
          <span
            key={i}
            className="size-4 rounded-full ring-1 ring-stone-600"
            style={{ background: i < b.strikes ? PAINT.red : '#292524' }}
          />
        ))}
        {lamps === 0 && <span className="text-xs text-stone-400">Hardcore</span>}
      </span>
      {b.rate > 1 && <span className="text-xs text-stone-400">×{b.rate}</span>}
      <span className="ml-auto flex flex-wrap justify-end gap-1">
        {needy.map((m) => {
          const left = Math.max(0, Math.round(needyLeft(m, now) / 1000));
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onNeedy?.(m.id)}
              className="rounded-full bg-stone-800 px-2 py-0.5 text-xs font-semibold ring-1 ring-stone-600"
              style={{ color: left <= 5 ? PAINT.red : '#f97316' }}
            >
              ⚠ {left}
            </button>
          );
        })}
        {extra}
      </span>
    </div>
  );
}

function WidgetChip({ w, art }: { w: Widget; art: Art }) {
  const img = (name: string) => art.widget(name);
  const pic = (src: string | null, alt: string) =>
    src ? <Pic src={src} alt={alt} className="h-8 w-auto object-contain" /> : null;
  switch (w.kind) {
    case 'serial':
      return (
        <span
          className="flex flex-col items-start rounded-md bg-stone-100 px-2 py-1 text-stone-900 ring-1 ring-stone-400"
          data-testid="serial"
        >
          <span className="text-[10px] font-bold uppercase tracking-wide">Serial #</span>
          <span className="font-mono text-lg font-bold">{/* filled by the parent */}</span>
        </span>
      );
    case 'battery':
      return (
        <span
          className="flex items-center gap-1 rounded-md bg-stone-700 px-2 py-1 text-sm text-stone-100 ring-1 ring-stone-500"
          data-testid="battery"
          data-count={w.batteries}
        >
          {pic(
            img(w.batteries === 2 ? 'battery-aa' : 'battery-d'),
            w.batteries === 2 ? 'two AA batteries' : 'one D battery',
          ) ?? <span aria-hidden>🔋</span>}
          {w.batteries === 2 ? 'AA × 2' : 'D × 1'}
        </span>
      );
    case 'indicator':
      return (
        <span
          className="flex items-center gap-1.5 rounded-md bg-stone-950 px-2 py-1 font-mono text-sm font-bold text-stone-100 ring-1 ring-stone-600"
          data-testid="indicator"
          data-label={w.label}
          data-lit={w.lit ? '1' : '0'}
        >
          <span
            className="size-3 rounded-full ring-1 ring-stone-500"
            style={{
              background: w.lit ? '#fef3c7' : '#292524',
              boxShadow: w.lit ? '0 0 8px #fef3c7' : undefined,
            }}
          />
          {w.label}
          <span className="font-sans text-[10px] font-normal text-stone-400">
            {w.lit ? 'lit' : 'unlit'}
          </span>
        </span>
      );
    case 'ports':
      return (
        <span
          className="flex flex-wrap items-center gap-1 rounded-md bg-stone-600 px-2 py-1 text-xs text-stone-100 ring-1 ring-stone-400"
          data-testid="ports"
        >
          {w.ports.length ? (
            w.ports.map((p) => (
              <span key={p} className="rounded bg-stone-800 px-1.5 py-0.5 font-semibold">
                {PORT_NAME[p]}
              </span>
            ))
          ) : (
            <span className="italic text-stone-300">empty plate</span>
          )}
        </span>
      );
  }
}

export const PORT_NAME: Record<string, string> = {
  dvi: 'DVI-D',
  parallel: 'Parallel',
  ps2: 'PS/2',
  rj45: 'RJ-45',
  serial: 'Serial',
  rca: 'Stereo RCA',
};

/** A widget's render in its spot, with the words the original prints on it. */
function WidgetArt({ w, b, art }: { w: Widget; b: BombView; art: Art }) {
  const name =
    w.kind === 'serial'
      ? 'serial'
      : w.kind === 'battery'
        ? w.batteries === 2
          ? 'battery-aa'
          : 'battery-d'
        : w.kind === 'indicator'
          ? w.lit
            ? 'indicator-lit'
            : 'indicator'
          : 'plate';
  const src = art.widget(name);
  const test =
    w.kind === 'serial'
      ? { 'data-testid': 'serial' }
      : w.kind === 'battery'
        ? { 'data-testid': 'battery', 'data-count': w.batteries }
        : w.kind === 'indicator'
          ? { 'data-testid': 'indicator', 'data-label': w.label, 'data-lit': w.lit ? '1' : '0' }
          : { 'data-testid': 'ports' };
  const label =
    w.kind === 'serial'
      ? `Serial number ${b.serial}`
      : w.kind === 'battery'
        ? w.batteries === 2
          ? 'Two AA batteries'
          : 'One D battery'
        : w.kind === 'indicator'
          ? `${w.label}, ${w.lit ? 'lit' : 'unlit'}`
          : w.ports.length
            ? `Port plate: ${w.ports.map((p) => PORT_NAME[p]).join(', ')}`
            : 'An empty port plate';
  return (
    <div
      className="relative size-full"
      style={{ containerType: 'inline-size' }}
      role="img"
      aria-label={label}
      {...test}
    >
      {src && <Pic src={src} alt="" className="absolute inset-0 size-full object-contain" />}
      {w.kind === 'ports' &&
        w.ports.map((p) => {
          const img = art.widget(`port-${p}`);
          return img ? (
            <Pic key={p} src={img} alt="" className="absolute inset-0 size-full object-contain" />
          ) : null;
        })}
      {w.kind === 'serial' && (
        <span
          className="absolute inset-x-0 bottom-[14%] text-center font-mono font-bold tracking-wider text-stone-900"
          style={{ fontSize: '17cqw' }}
        >
          {b.serial}
        </span>
      )}
      {w.kind === 'indicator' && (
        <span
          className="absolute right-[12%] top-1/2 -translate-y-1/2 font-bold text-stone-100"
          style={{ fontSize: '19cqw' }}
        >
          {w.label}
        </span>
      )}
    </div>
  );
}

/** One side of the casing: its widget areas in order along it, each with its widgets. */
export function Edge({ b, side, art }: { b: BombView; side: Side; art: Art }) {
  const areas = AREAS.map((a, i) => ({ ...a, i }))
    .filter((a) => a.side === side)
    .sort((x, y) => x.x - y.x);
  const pic = art.casing(side);
  const boxes = art.areas(side);
  if (pic && boxes && boxes.length === areas.length) {
    return (
      <div className="relative overflow-hidden rounded-xl" data-testid={`edge-${side}`}>
        <Pic src={pic} alt="" className="block w-full" />
        {areas.map((a, k) => {
          const [bx, by, bw, bh] = boxes[k]!;
          // A tall area box is the zone grid turned: its columns run down the picture.
          const turned = bh > bw * 1.5 && (side === 'top' || side === 'bottom');
          return b.widgets
            .filter((w) => w.area === a.i)
            .map((w, j) => {
              const cw = turned ? bw / a.rows : bw / a.cols;
              const ch = turned ? bh / a.cols : bh / a.rows;
              const x = turned ? bx + w.z * cw : bx + w.x * cw;
              const y = turned ? by + w.x * ch : by + w.z * ch;
              const box = turned ? [x, y, cw, ch * 2] : [x, y, cw * 2, ch];
              return (
                <div
                  key={`${a.i}-${j}`}
                  className="absolute"
                  style={{
                    left: `${box[0]! * 100}%`,
                    top: `${box[1]! * 100}%`,
                    width: `${box[2]! * 100}%`,
                    height: `${box[3]! * 100}%`,
                  }}
                >
                  <WidgetArt w={w} b={b} art={art} />
                </div>
              );
            });
        })}
      </div>
    );
  }
  return (
    <div
      className="relative overflow-hidden rounded-xl bg-stone-700 p-2 ring-1 ring-stone-500"
      data-testid={`edge-${side}`}
    >
      <div className="relative flex min-h-16 items-stretch gap-2">
        {areas.map((a) => {
          const ws = b.widgets.filter((w) => w.area === a.i).sort((x, y) => x.z - y.z || x.x - y.x);
          return (
            <div
              key={a.i}
              className="flex flex-1 flex-col justify-center gap-1.5 rounded-lg bg-stone-800/60 p-1.5"
            >
              {ws.map((w, j) =>
                w.kind === 'serial' ? (
                  <span
                    key={j}
                    className="flex flex-col items-start rounded-md bg-stone-100 px-2 py-1 text-stone-900 ring-1 ring-stone-400"
                    data-testid="serial"
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wide">Serial #</span>
                    <span className="font-mono text-lg font-bold tracking-wider">{b.serial}</span>
                  </span>
                ) : (
                  <WidgetChip key={j} w={w} art={art} />
                ),
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A face of the bomb: 3 × 2 slots (anchors 0–2 above, 3–5 below) with modules, the timer and blanks. */
export function FaceGrid({
  b,
  face,
  art,
  now,
  onOpen,
  open,
}: {
  b: BombView;
  face: 0 | 1;
  art: Art;
  now: number;
  onOpen?: (id: string) => void;
  open?: string | null;
}) {
  const blank = art.casing('blank');
  const casing = art.casing(face === 0 ? 'front' : 'rear');
  const slots = art.slots(face === 0 ? 'front' : 'rear');
  const slot = (anchor: number) => {
    if (b.timer.face === face && b.timer.anchor === anchor)
      return <TimerFace b={b} now={now} art={art} />;
    const m = b.modules.find((x) => x.face === face && x.anchor === anchor);
    if (!m)
      return (
        <div
          className={cn(
            'relative aspect-square overflow-hidden rounded-lg',
            !blank && 'bg-stone-500/40 ring-1 ring-stone-500',
          )}
        >
          {blank && <Pic src={blank} alt="" className="absolute inset-0 size-full" />}
        </div>
      );
    return (
      <button
        type="button"
        onClick={() => onOpen?.(m.id)}
        className={cn(
          'block w-full rounded-lg text-left transition',
          open === m.id && 'ring-4 ring-accent',
        )}
        aria-label={`${art.names[m.kind]}${m.solved ? ', disarmed' : ''}`}
        data-testid={`slot-${m.id}`}
      >
        <ModuleFace m={m} b={b} art={art} now={now} send={null} mini />
      </button>
    );
  };
  if (casing && slots?.length === 6)
    return (
      <div className="relative overflow-hidden rounded-2xl" data-testid={`face-${face}`}>
        <Pic src={casing} alt="" className="block w-full" />
        {slots.map(([x, y, w, h], anchor) => (
          <div
            key={anchor}
            className="absolute flex items-center"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: `${w * 100}%`,
              height: `${h * 100}%`,
            }}
          >
            {slot(anchor)}
          </div>
        ))}
      </div>
    );
  return (
    <div
      className="grid grid-cols-3 gap-2 rounded-2xl bg-stone-600 p-2 ring-1 ring-stone-500 dark:bg-stone-700"
      data-testid={`face-${face}`}
    >
      {[0, 1, 2, 3, 4, 5].map((anchor) => (
        <div key={anchor}>{slot(anchor)}</div>
      ))}
    </div>
  );
}

/** A module opened big, with its neighbours a swipe or an arrow away. */
export function Zoom({
  b,
  id,
  art,
  now,
  send,
  onMove,
  onClose,
}: {
  b: BombView;
  id: string;
  art: Art;
  now: number;
  send: Send | null;
  onMove: (id: string) => void;
  onClose: () => void;
}) {
  const list = ordered(b);
  const i = list.findIndex((m) => m.id === id);
  const m = list[i];
  if (!m) return null;
  const step = (d: number) => onMove(list[(i + d + list.length) % list.length]!.id);
  return (
    <div className="space-y-2" data-testid="zoom">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onClose}>
          ◂ Bomb
        </Button>
        <span className="min-w-0 flex-1 truncate text-center font-semibold" data-testid="zoom-name">
          {art.names[m.kind]}
          <span className="ml-1 text-xs font-normal text-ink-muted">
            ({m.face === 0 ? 'front' : 'back'})
          </span>
        </span>
        <Button
          size="icon"
          variant="secondary"
          aria-label="previous module"
          onClick={() => step(-1)}
        >
          ‹
        </Button>
        <Button size="icon" variant="secondary" aria-label="next module" onClick={() => step(1)}>
          ›
        </Button>
      </div>
      <Swipe onLeft={() => step(1)} onRight={() => step(-1)}>
        <div className="mx-auto w-full max-w-[min(100%,62vh)]">
          <ModuleFace m={m} b={b} art={art} now={now} send={send} />
        </div>
      </Swipe>
    </div>
  );
}

/** Horizontal swipes on a part of the screen (taps still reach what is under them). */
export function Swipe({
  onLeft,
  onRight,
  children,
}: {
  onLeft: () => void;
  onRight: () => void;
  children: ReactNode;
}) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  return (
    <div
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)();
      }}
    >
      {children}
    </div>
  );
}

/** The defuser's bomb: one view at a time on a phone, everything at once on a wide screen. */
export function BombScreen({
  b,
  art,
  now,
  act,
  readOnly = false,
}: {
  b: BombView;
  art: Art;
  now: number;
  act: ((module: string, op: ModuleOp) => void) | null;
  readOnly?: boolean;
}) {
  const [view, setView] = useState<View>('front');
  const [open, setOpen] = useState<string | null>(null);
  const send = (id: string): Send | null => (act && !readOnly ? (op) => act(id, op) : null);
  const go = (d: number) =>
    setView(VIEWS[(VIEWS.indexOf(view) + d + VIEWS.length) % VIEWS.length]!);
  const openModule = (id: string) => {
    const m = b.modules.find((x) => x.id === id);
    if (m) setView(m.face === 0 ? 'front' : 'rear');
    setOpen(id);
  };
  const dark = !b.activated;
  return (
    <div className="space-y-3">
      <TopBar b={b} now={now} onNeedy={openModule} />
      {dark && (
        <p
          className="rounded-lg bg-stone-900 px-3 py-2 text-center text-sm text-stone-300"
          data-testid="lights"
        >
          The lights are coming on…
        </p>
      )}
      {/* Phones: one view at a time. */}
      <div className="lg:hidden">
        {open ? (
          <Zoom
            b={b}
            id={open}
            art={art}
            now={now}
            send={send(open)}
            onMove={setOpen}
            onClose={() => setOpen(null)}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Bomb side">
              {VIEWS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold ring-1',
                    view === v
                      ? 'bg-accent text-accent-fg ring-accent dark:bg-amber-500 dark:text-stone-950'
                      : 'bg-card ring-line dark:bg-stone-800 dark:ring-stone-700',
                  )}
                  data-testid={`view-${v}`}
                >
                  {VIEW_NAME[v]}
                </button>
              ))}
            </div>
            <Swipe onLeft={() => go(1)} onRight={() => go(-1)}>
              {view === 'front' || view === 'rear' ? (
                <FaceGrid
                  b={b}
                  face={view === 'front' ? 0 : 1}
                  art={art}
                  now={now}
                  onOpen={openModule}
                />
              ) : (
                <Edge b={b} side={view} art={art} />
              )}
            </Swipe>
            <p className="text-center text-xs text-ink-muted">
              Swipe to turn the bomb · tap a module to open it
            </p>
          </div>
        )}
      </div>
      {/* Wide screens: both faces and the edges, with the open module beside them. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <Edge b={b} side="top" art={art} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-ink-muted">Front</p>
              <FaceGrid b={b} face={0} art={art} now={now} onOpen={openModule} open={open} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-ink-muted">Back</p>
              <FaceGrid b={b} face={1} art={art} now={now} onOpen={openModule} open={open} />
            </div>
          </div>
          <Edge b={b} side="bottom" art={art} />
          <div className="grid grid-cols-2 gap-3">
            <Edge b={b} side="left" art={art} />
            <Edge b={b} side="right" art={art} />
          </div>
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          {open ? (
            <Zoom
              b={b}
              id={open}
              art={art}
              now={now}
              send={send(open)}
              onMove={setOpen}
              onClose={() => setOpen(null)}
            />
          ) : (
            <p className="rounded-xl bg-card p-6 text-center text-ink-muted ring-1 ring-line dark:bg-stone-900 dark:ring-stone-800">
              Click a module to open it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
