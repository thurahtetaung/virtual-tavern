import { ProtectedImage, cn } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../logic/types.ts';
import type { BombView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { haptics } from './haptics.ts';
import { player } from './sound.ts';
import { useServerNow } from './time.ts';

/**
 * The results page of the binder (`ResultFreeplayExplodedPage`, `ResultFreeplayDefusedPage`) in
 * the black after the bomb ends, on every screen: the explosion is 4 s of black, then the page
 * fades in over 2 s (`SceneManager.BombExploded`); a defuse keeps the room 6 s, fades out over 3 s,
 * waits 1 s, then fades the page in (`BombDefused`). 2.5 s into the page the stamp is punched on,
 * 1 s later the result is typed out a letter every 0.08 s with 0.4 s between lines. A tap shows
 * it all at once, as the original's buttons do while it types.
 */
export const BINDER = {
  exploded: { black: 4000, fade: 2000 },
  /** After the room's 9 s; screens that never showed the room wait 1 s. */
  defused: { black: 10_000, fade: 2000, noRoom: 1000 },
  stamp: 2500,
  afterStamp: 1000,
  letter: 80,
  between: 400,
};

/** When the page starts to fade in after the bomb's end (`room`: this screen showed the room). */
export const binderAt = (end: NonNullable<BombView['end']>, room: boolean) =>
  end.at +
  (end.how !== 'defused'
    ? BINDER.exploded.black
    : room
      ? BINDER.defused.black
      : BINDER.defused.noRoom);

/** `Util.GetResultsFormattedTimeRemaining`: minutes and seconds. */
const remaining = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Text on the page: its place on the 1024-px page texture, alignment and TextMeshPro size. */
interface Line {
  x: number;
  y: number;
  size: number;
  align: 'left' | 'centre' | 'bottom' | 'top';
}

const L = {
  exploded: {
    labels: [93, 192, 295, 396],
    mission: { x: 522, y: 134, size: 12.5, align: 'bottom' },
    time: { x: 355, y: 238, size: 12.5, align: 'centre' },
    modules: { x: 702, y: 238, size: 12.5, align: 'centre' },
    needy: { x: 359, y: 340, size: 12.5, align: 'centre' },
    hardcore: { x: 702, y: 340, size: 12.5, align: 'centre' },
    leftTitle: { x: 524, y: 618, size: 12.5, align: 'bottom' },
    left: { x: 524, y: 668, size: 20, align: 'centre' },
    causeTitle: { x: 524, y: 752, size: 12.5, align: 'bottom' },
    cause: { x: 524, y: 806, size: 12.5, align: 'bottom' },
    stamp: { x: 514, y: 454, w: 410, rot: -3.2 },
    buttons: [
      { x: 391, y: 933, label: 'BACK', what: 'back' },
      { x: 662, y: 933, label: 'RETRY', what: 'retry' },
    ],
  },
  defused: {
    labels: [129, 227, 331, 432],
    mission: { x: 530, y: 168, size: 12.5, align: 'bottom' },
    time: { x: 355, y: 270, size: 12.5, align: 'centre' },
    modules: { x: 702, y: 270, size: 12.5, align: 'centre' },
    needy: { x: 355, y: 375, size: 12.5, align: 'centre' },
    hardcore: { x: 702, y: 375, size: 12.5, align: 'centre' },
    leftTitle: { x: 524, y: 671, size: 12.5, align: 'bottom' },
    left: { x: 524, y: 722, size: 20, align: 'centre' },
    causeTitle: null,
    cause: null,
    stamp: { x: 680, y: 807, w: 307, rot: 5 },
    buttons: [{ x: 524, y: 906, label: 'CONTINUE', what: 'back' }],
  },
} as const;

const LABELS = ['1. Identifier', '2. Bomb Configuration', '3. Advanced Options', '4. Result'];

/** One TextMeshPro em in page widths: size × 0.1 × the text's 0.01 scale × 3.537 px per metre. */
const em = (size: number) => size * 0.003537 * 100;

function Text({ l, text, font }: { l: Line; text: string; font: string }) {
  const shift = {
    left: 'translate(0,-50%)',
    centre: 'translate(-50%,-50%)',
    bottom: 'translate(-50%,-100%)',
    top: 'translate(-50%,0)',
  }[l.align];
  return (
    <span
      className="absolute whitespace-nowrap leading-none text-black/95"
      style={{
        left: `${(l.x / 1024) * 100}%`,
        top: `${(l.y / 1024) * 100}%`,
        transform: shift,
        fontSize: `${em(l.size)}cqw`,
        fontFamily: font,
      }}
    >
      {text}
    </span>
  );
}

export interface BinderProps {
  b: BombView;
  settings: Settings;
  art: Art;
  offset: number;
  /** The device plays the stamp (the defuser's and the table screen). */
  sound: boolean;
  /** This screen showed the 3D room up to the end (its defused room fades out first). */
  room: boolean;
  /** Retry: the host's next bomb with the same settings (null for everyone else). */
  retry: (() => void) | null;
  /** Back / Continue: the binder closes on this screen and the results show. */
  close: () => void;
}

/** The binder's results page, full screen in the black. */
export function Binder({ b, settings, art, offset, sound, room, retry, close }: BinderProps) {
  const end = b.end!;
  const how = end.how === 'defused' ? 'defused' : 'exploded';
  const lay = L[how];
  const from = binderAt(end, room);
  const [skip, setSkip] = useState(false);
  const now = useServerNow(offset, 40, !skip);
  const t = skip ? Number.POSITIVE_INFINITY : now - from;
  const stampAt = BINDER.stamp;
  const typing = stampAt + BINDER.afterStamp;
  const names = art.names;
  const cause =
    end.how === 'time'
      ? 'Time Ran Out'
      : names[b.modules.find((m) => m.id === end.by)?.kind ?? 'wires'];
  const lines: [keyof typeof lay, string][] = [
    ['leftTitle', 'Time Remaining:'],
    ['left', remaining(end.left)],
    ...(how === 'exploded'
      ? ([
          ['causeTitle', 'Cause of Explosion:'],
          ['cause', cause],
        ] as [keyof typeof lay, string][])
      : []),
  ];
  // Each typed line: when it starts and how many letters show.
  let at = typing;
  const typed = lines.map(([key, text]) => {
    const start = at;
    at += text.length * BINDER.letter + BINDER.between;
    return {
      key,
      text,
      shown: Math.max(0, Math.min(text.length, Math.floor((t - start) / BINDER.letter))),
    };
  });
  const done = t >= at;
  const stamped = t >= stampAt;
  // The stamp's thud and buzz (`HapticType.Stamp`, 0.15 s), once, only on time.
  const thud = useRef(false);
  useEffect(() => {
    if (!stamped || thud.current) return;
    thud.current = true;
    if (skip || now - from - stampAt > 1500) return;
    if (sound) player.play(art.effect('stamp'));
    if (sound) haptics.buzz('Interaction');
  }, [stamped, skip, now, from, stampAt, sound, art]);
  const font = art.fonts.manual ?? 'ui-serif, Georgia, serif';
  const page = art.results(how === 'defused' ? 'freeplay-defused' : 'freeplay-exploded');
  const stamp = art.stamp(how);
  const opacity = t < 0 ? 0 : Math.min(1, t / BINDER[how].fade);
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black"
      onClick={() => {
        if (!done) setSkip(true);
      }}
      data-testid="binder"
      data-done={done ? 'yes' : 'no'}
    >
      <div
        className="relative aspect-square w-[min(100vw,100dvh)]"
        style={{ containerType: 'size', opacity }}
        data-testid="binder-page"
      >
        {page ? (
          <ProtectedImage src={page} alt="" className="absolute inset-0 size-full select-none" />
        ) : (
          <div className="absolute inset-[3%_11%] bg-stone-100" />
        )}
        {lay.labels.map((y, i) => (
          <span
            key={y}
            className="absolute whitespace-nowrap text-black/90"
            style={{
              left: `${(195 / 1024) * 100}%`,
              top: `${(y / 1024) * 100}%`,
              transform: 'translate(0,-50%)',
              fontSize: `${em(9.5)}cqw`,
              fontFamily: '"Liberation Sans", Arial, sans-serif',
            }}
          >
            {LABELS[i]}
          </span>
        ))}
        <Text l={lay.mission} text="Free Play" font={font} />
        <Text
          l={lay.time}
          text={`${Math.floor(settings.time / 60)}:${String(settings.time % 60).padStart(2, '0')}`}
          font={font}
        />
        <Text
          l={lay.modules}
          text={settings.modules === 1 ? '1 Module' : `${settings.modules} Modules`}
          font={font}
        />
        <Text l={lay.needy} text={settings.needy ? 'Needy: ON' : 'Needy: OFF'} font={font} />
        <Text
          l={lay.hardcore}
          text={settings.hardcore ? 'Hardcore: ON' : 'Hardcore: OFF'}
          font={font}
        />
        {typed.map(({ key, text, shown }) =>
          shown > 0 ? (
            <Text key={key} l={lay[key] as Line} text={text.slice(0, shown)} font={font} />
          ) : null,
        )}
        {stamped && (
          <div
            className="absolute"
            style={{
              left: `${(lay.stamp.x / 1024) * 100}%`,
              top: `${(lay.stamp.y / 1024) * 100}%`,
              width: `${(lay.stamp.w / 1024) * 100}%`,
              transform: `translate(-50%,-50%) rotate(${lay.stamp.rot}deg)`,
              animation: skip ? undefined : 'vt-defuse-stamp 180ms ease-out',
            }}
            data-testid="binder-stamp"
          >
            <style>{`@keyframes vt-defuse-stamp{from{transform:translate(-50%,-50%) rotate(${lay.stamp.rot}deg) scale(1.35);opacity:.2}to{transform:translate(-50%,-50%) rotate(${lay.stamp.rot}deg) scale(1);opacity:1}}`}</style>
            {stamp ? (
              <ProtectedImage src={stamp} alt="" className="w-full" />
            ) : (
              <span
                className={cn(
                  'block border-[0.6cqw] px-[2cqw] text-center font-black uppercase tracking-widest',
                  'border-current',
                  how === 'defused' ? 'text-success-ink' : 'text-danger-ink',
                )}
                style={{ fontSize: '7cqw' }}
              >
                {how}
              </span>
            )}
          </div>
        )}
        <span className="sr-only" data-testid="binder-outcome">
          {how === 'defused' ? 'Defused' : 'Exploded'}
        </span>
        {done &&
          lay.buttons
            .filter((x) => x.what !== 'retry' || retry)
            .map((x) => (
              <button
                key={x.label}
                type="button"
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[0.6cqw] bg-[#1d1d1b] px-[2.2cqw] py-[0.9cqw] font-mono font-bold tracking-[0.25em] text-white/80 ring-[0.35cqw] ring-[#e8d23a]/0 hover:ring-[#e8d23a] focus-visible:ring-[#e8d23a]"
                style={{
                  left: `${(x.x / 1024) * 100}%`,
                  top: `${(x.y / 1024) * 100}%`,
                  fontSize: `${em(12)}cqw`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (x.what === 'retry') retry?.();
                  else close();
                }}
                data-testid={`binder-${x.what}`}
              >
                {x.label}
              </button>
            ))}
      </div>
      {done && !retry && how === 'exploded' && (
        <p className="pointer-events-none absolute inset-x-0 bottom-[max(8px,env(safe-area-inset-bottom))] text-center text-xs text-stone-300">
          The host starts the next bomb.
        </p>
      )}
    </div>
  );
}
