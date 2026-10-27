import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../cn.ts';
import { Button } from '../components.tsx';
import { Modal } from '../modal.tsx';
import type { PreviewHandle } from './engine.ts';
import { type SoundKind, type VolumeKey, type Volumes, gainOf, tableVolumes } from './volumes.ts';

// The sound panel every game with sound shares: a volume slider per sound type the game has (and
// a master one when it has more than one), each with a ▶ that plays a short real clip of that
// type at its level. Previews only play on a tap, one at a time.

/** How long a preview plays. */
export const PREVIEW_MS = 4000;

export interface SoundChannel {
  kind: SoundKind;
  label: string;
  /** What it covers, in a few words ("the auctioneer's calls"). */
  help?: string;
  /**
   * Plays a short clip of this type at `gain` (called inside the tap); null when there is
   * nothing to play (no clip for it on this page). Without it, the type has no ▶.
   */
  preview?: (gain: number) => PreviewHandle | null;
  /** The ▶ can play now (the game's clips are here). */
  canPreview?: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** A short summary of the volumes: "Off", "80 %", or "Music 0 % · Effects 80 %". */
export function volumeSummary(v: Volumes, kinds: readonly SoundKind[]): string {
  if (v.master === 0 || kinds.every((k) => v[k] === 0)) return 'off';
  // One slider (no master shown): its own level.
  if (kinds.length === 1) return pct(gainOf(v, kinds[0]!));
  const off = kinds.filter((k) => v[k] === 0);
  return off.length ? `${pct(v.master)}, ${off.join(' and ')} off` : pct(v.master);
}

/** The sliders: master (with more than one type), then each type, each with its preview. */
export function SoundSliders({
  volumes,
  setVolume,
  channels,
  testId = 'sound-panel',
}: {
  volumes: Volumes;
  setVolume: (which: VolumeKey, level: number) => void;
  channels: readonly SoundChannel[];
  testId?: string;
}) {
  const [playing, setPlaying] = useState<SoundKind | null>(null);
  const handle = useRef<{
    kind: SoundKind;
    h: PreviewHandle;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const stop = () => {
    const now = handle.current;
    if (!now) return;
    clearTimeout(now.timer);
    now.h.stop();
    handle.current = null;
    setPlaying(null);
  };
  useEffect(() => stop, []);
  // The volume applies live to a preview that is playing.
  useEffect(() => {
    const now = handle.current;
    if (now) now.h.volume(gainOf(volumes, now.kind));
  }, [volumes]);

  const play = (c: SoundChannel) => {
    const again = handle.current?.kind === c.kind;
    stop();
    if (again || !c.preview) return;
    const h = c.preview(gainOf(volumes, c.kind));
    if (!h) return;
    const timer = setTimeout(stop, PREVIEW_MS);
    handle.current = { kind: c.kind, h, timer };
    setPlaying(c.kind);
  };

  const rows: { key: VolumeKey; label: string; help?: string; channel?: SoundChannel }[] = [
    ...(channels.length > 1 ? [{ key: 'master' as const, label: 'All sound' }] : []),
    ...channels.map((c) => ({ key: c.kind, label: c.label, help: c.help, channel: c })),
  ];
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      {rows.map(({ key, label, help, channel }) => {
        const value = volumes[key];
        const id = `${testId}-${key}`;
        return (
          <div key={key} className="flex items-center gap-2" data-testid={`sound-row-${key}`}>
            <label htmlFor={id} className="w-24 shrink-0 text-sm leading-tight sm:w-28">
              <span className="block font-semibold">{label}</span>
              {help && <span className="block text-xs text-ink-muted">{help}</span>}
            </label>
            <input
              id={id}
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(value * 100)}
              onChange={(e) => {
                setVolume(key, Number(e.target.value) / 100);
              }}
              aria-valuetext={value === 0 ? 'off' : pct(value)}
              data-testid={`sound-slider-${key}`}
              className="h-11 min-w-0 flex-1 cursor-pointer accent-accent"
            />
            <span className="w-11 shrink-0 text-right text-xs text-ink-muted tabular-nums">
              {value === 0 ? 'Off' : pct(value)}
            </span>
            {channel?.preview ? (
              <Button
                variant="secondary"
                size="sm"
                className="size-11 shrink-0 p-0"
                disabled={channel.canPreview === false}
                aria-pressed={playing === key}
                aria-label={
                  playing === key
                    ? `Stop the ${label.toLowerCase()} preview`
                    : `Preview ${label.toLowerCase()}`
                }
                title={channel.canPreview === false ? 'Nothing to preview here yet' : undefined}
                onClick={() => {
                  play(channel);
                }}
                data-testid={`sound-preview-${key}`}
              >
                <span aria-hidden>{playing === key ? '■\uFE0E' : '▶\uFE0E'}</span>
              </Button>
            ) : (
              <span aria-hidden className="size-11 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One group of sliders: this device's own, or (for the host) the table screen's. */
export interface SoundSection {
  /** A heading when there is more than one ("This phone", "Table screen"). */
  title?: string;
  volumes: Volumes;
  setVolume: (which: VolumeKey, level: number) => void;
  channels: readonly SoundChannel[];
  testId?: string;
}

/** The sections, and the line saying where the room's sound plays. */
export function SoundSections({
  sections,
  note,
}: {
  sections: readonly SoundSection[];
  note?: ReactNode;
}) {
  const shown = sections.filter((s) => s.channels.length);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((s, i) => (
        <section key={s.testId ?? i} className="flex flex-col gap-1">
          {s.title && shown.length > 1 && (
            <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {s.title}
            </h3>
          )}
          <SoundSliders {...s} />
        </section>
      ))}
      {note && (
        <p className="text-sm text-ink-muted" data-testid="sound-where">
          {note}
        </p>
      )}
    </div>
  );
}

const silent = (sections: readonly SoundSection[]) =>
  sections.every((s) => s.channels.every((c) => gainOf(s.volumes, c.kind) === 0));

/** The lobby's "Sound" section: folded, and every player's own (not only the host's). */
export function LobbySound({
  sections,
  note,
  children,
}: {
  sections: readonly SoundSection[];
  /** Where the room's sound plays (shown alone when nothing plays on this device). */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const mine = sections[0];
  const any = sections.some((s) => s.channels.length);
  return (
    <details
      data-testid="lobby-sound"
      className="group rounded-2xl bg-card/85 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-semibold">
          <span aria-hidden>{any && !silent(sections) ? '🔊 ' : '🔇 '}</span>
          Sound
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-muted" data-testid="lobby-sound-summary">
          {mine?.channels.length
            ? `Your volume: ${volumeSummary(
                mine.volumes,
                mine.channels.map((c) => c.kind),
              )}`
            : any
              ? 'Table screen volume'
              : note}
        </span>
        <span
          aria-hidden
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">
        <SoundSections sections={sections} note={note} />
        {children}
      </div>
    </details>
  );
}

/** The in-play sound corner: a 🔊 button that opens the sliders in a sheet. */
export function SoundButton({
  sections,
  note,
  className,
  testId = 'sound-button',
}: {
  sections: readonly SoundSection[];
  note?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const off = !sections.some((s) => s.channels.length) || silent(sections);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn('min-h-11 min-w-11', className)}
        onClick={() => {
          setOpen(true);
        }}
        title="Sound"
        data-testid={testId}
      >
        <span aria-hidden>{off ? '🔇' : '🔊'}</span>
        <span className="sr-only">Sound volume</span>
      </Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Sound"
        size="sm"
      >
        {open && <SoundSections sections={sections} note={note} />}
      </Modal>
    </>
  );
}

/** How long a table-screen slider waits for the drag to settle before telling the room. */
export const TABLE_SEND_MS = 250;

/**
 * The table screen's volumes, which the host sets (the table has no input) and the room keeps:
 * the slider moves at once here, and the room hears of it once the drag settles.
 */
export function useTableVolumes(
  stored: Partial<Volumes> | undefined,
  send: (v: Volumes) => void,
  defaults?: Volumes,
): [Volumes, (which: VolumeKey, level: number) => void] {
  const room = tableVolumes(stored, defaults);
  const [draft, setDraft] = useState<Volumes | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const set = (which: VolumeKey, level: number) => {
    const next = { ...(draft ?? room), [which]: Math.max(0, Math.min(1, level)) };
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      sendRef.current(next);
      setDraft(null);
    }, TABLE_SEND_MS);
  };
  return [draft ?? room, set];
}
