import type {
  GameRecap,
  HallOfFame,
  NightSummary,
  RecapLine,
  RecapTone,
  RoomRecap,
} from '@vt/protocol';
import { Badge, Button, cn } from '@vt/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useToast } from '../lib/toast.tsx';
import { type GameInfo, chatText, duration, nightDate, playedMs } from './copyText.ts';
import { deviceTheme, imageCard, imageName, renderRecapImage, saveImage } from './image.ts';
import { type Labeler, resolveSegments, resolveText } from './resolve.ts';

/** Award lines shown before "+N more". */
const AWARDS_SHOWN = 6;
/** No game started this long ago: it was last night, not tonight. */
const TONIGHT_MS = 3 * 60 * 60_000;

export const recapHeading = (recap: RoomRecap | null, now = Date.now()) =>
  recap && recap.games.length && now - recap.endedAt > TONIGHT_MS && !recap.running
    ? 'Last night at the tavern'
    : 'Tonight at the tavern';

/** Server text with names in bold and private ids named. */
function Rich({
  text,
  names,
  labels,
}: {
  text: string;
  names: ReadonlyMap<string, string>;
  labels: Labeler | null;
}) {
  return (
    <>
      {resolveSegments(text, names, labels).map((s, i) =>
        s.name ? (
          <b key={i} className="text-amber-800 dark:text-amber-300">
            {s.text}
          </b>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Copies text, falling back to a hidden textarea, then to a toast that shows it. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    // The old way still works where the clipboard API is refused.

    const ok = (() => {
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    })();
    area.remove();
    return ok;
  }
}

/** What every view of a night card needs to show names, places and games. */
export interface CardContext {
  gameInfo: (gameId: string) => GameInfo;
  names: ReadonlyMap<string, string>;
  labels: Labeler | null;
}

/** The image's heading for a card. */
const imageHeading = (recap: RoomRecap, current: boolean) =>
  current
    ? `Virtual Tavern · ${recapHeading(recap) === 'Last night at the tavern' ? 'Last night' : 'Tonight'}`
    : 'Virtual Tavern · A night to remember';

/**
 * The PNG for a card, drawn as soon as it is shown: a tap on "Save image" then still counts as
 * the user's own action when it reaches the share sheet (iOS forgets after a few seconds).
 */
function usePrerendered(recap: RoomRecap | null, heading: string, ctx: CardContext, on: boolean) {
  const [image, setImage] = useState<{ for: RoomRecap; heading: string; blob: Blob } | null>(null);
  const { names, labels, gameInfo } = ctx;
  useEffect(() => {
    if (!on || !recap?.games.length || typeof document === 'undefined') return;
    let live = true;
    // A beat later, so opening the sheet stays smooth.
    const timer = window.setTimeout(() => {
      renderRecapImage(imageCard(recap, { heading, names, labels, gameInfo }), deviceTheme())
        .then((blob) => {
          if (live) setImage({ for: recap, heading, blob });
        })
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [on, recap, heading, names, labels, gameInfo]);
  return image && image.for === recap && image.heading === heading ? image.blob : null;
}

/** The room's recap drawer: tonight's card, the Hall of fame and earlier nights (read-only). */
export function RecapSheet({
  open,
  recap,
  ctx,
  isHost,
  onTone,
  onWrap,
  onShared,
  onSameCrew,
  hall,
  pastNight,
}: {
  open: boolean;
  recap: RoomRecap | null;
  ctx: CardContext;
  isHost: boolean;
  onTone: (tone: RecapTone) => void;
  onWrap: () => void;
  onShared: (how: 'copy' | 'share' | 'image') => void;
  /** "Same crew, new game" (the host only). */
  onSameCrew?: () => void;
  hall: () => Promise<HallOfFame | null>;
  pastNight: (nightKey: string) => Promise<RoomRecap | null>;
}) {
  const [tab, setTab] = useState<'tonight' | 'hall'>('tonight');
  const [past, setPast] = useState<RoomRecap | null>(null);
  const hasHall = (recap?.previous?.length ?? 0) > 0;
  // Closing the sheet brings it back to tonight's card next time.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setPast(null);
      setTab('tonight');
    }
  }

  if (!recap) {
    return <p className="py-10 text-center text-stone-500 dark:text-stone-400">Pouring…</p>;
  }
  const showHall = hasHall && tab === 'hall';
  const shown = showHall ? past : recap;

  return (
    <div className="flex min-h-full flex-col gap-4">
      {hasHall && (
        <div
          role="tablist"
          aria-label="Recap"
          className="inline-flex self-start rounded-lg bg-stone-200 p-0.5 dark:bg-stone-800"
        >
          {(
            [
              ['tonight', '🍻 Tonight'],
              ['hall', '🏆 Hall of fame'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
                setPast(null);
              }}
              className={cn(
                'min-h-9 rounded-md px-3 text-sm font-semibold',
                tab === id
                  ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-600 dark:text-stone-50'
                  : 'text-stone-600 dark:text-stone-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showHall && !past && (
        <HallView
          hall={hall}
          ctx={ctx}
          onOpen={async (key) => {
            const night = await pastNight(key);
            if (night) setPast(night);
          }}
        />
      )}
      {showHall && past && (
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setPast(null)}>
            ← Hall of fame
          </Button>
        </div>
      )}
      {shown && (
        <NightCard
          recap={shown}
          ctx={ctx}
          header={!showHall && isHost ? <ToneSwitch tone={recap.tone} onTone={onTone} /> : null}
        />
      )}

      {shown && (
        <ActionBar
          recap={shown}
          current={!showHall}
          open={open}
          ctx={ctx}
          onShared={onShared}
          {...(!showHall && isHost && { onWrap })}
          {...(!showHall && onSameCrew && { onSameCrew })}
        />
      )}
    </div>
  );
}

/** Copy, share, save, and (tonight) the host's wrap-up and "Same crew, new game". */
function ActionBar({
  recap,
  current,
  open,
  ctx,
  onShared,
  onWrap,
  onSameCrew,
}: {
  recap: RoomRecap;
  current: boolean;
  open: boolean;
  ctx: CardContext;
  onShared: (how: 'copy' | 'share' | 'image') => void;
  onWrap?: () => void;
  onSameCrew?: () => void;
}) {
  const toast = useToast();
  const empty = recap.games.length === 0;
  const heading = imageHeading(recap, current);
  const blob = usePrerendered(recap, heading, ctx, open);
  const saving = useRef(false);
  const touch =
    typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const text = () => chatText(recap, ctx);

  const copy = async () => {
    const t = text();
    if (await copyToClipboard(t)) {
      toast('Recap copied. Paste it in your group chat!', 'info');
      onShared('copy');
    } else toast(t, 'info');
  };
  const share = async () => {
    try {
      await navigator.share({ text: text() });
      onShared('share');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      await copy();
    }
  };
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      const png =
        blob ?? (await renderRecapImage(imageCard(recap, { heading, ...ctx }), deviceTheme()));
      const how = await saveImage(png, imageName(recap.startedAt));
      if (how === 'cancelled') return;
      if (how === 'opened') toast('Long-press the picture to save it.', 'info');
      else if (how === 'downloaded') toast('Saved! Find it in your downloads.', 'info');
      onShared('image');
    } catch {
      toast("Couldn't draw the picture on this device. Copy for chat still works!");
    } finally {
      saving.current = false;
    }
  };

  if (empty && !onSameCrew) return null;
  return (
    <div className="sticky bottom-0 -mx-4 mt-auto -mb-4 flex flex-wrap gap-2 border-t border-stone-200 bg-stone-50/95 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/95">
      {!empty && (
        <Button className="min-h-11 flex-1" onClick={() => void copy()}>
          📋 Copy for chat
        </Button>
      )}
      {!empty && (
        <Button variant="secondary" className="min-h-11 flex-1" onClick={() => void save()}>
          🖼️ Save image
        </Button>
      )}
      {!empty && touch && (
        <Button variant="secondary" className="min-h-11" onClick={() => void share()}>
          📤 Share
        </Button>
      )}
      {onSameCrew && current && !empty && (
        <Button variant="secondary" className="min-h-11" onClick={onSameCrew}>
          🎲 Same crew, new game
        </Button>
      )}
      {onWrap && current && !empty && recap.status === 'live' && !recap.running && (
        <Button variant="secondary" className="min-h-11" onClick={onWrap}>
          🍻 Wrap up the night
        </Button>
      )}
    </div>
  );
}

/** One night's card: its numbers, awards and games. Read-only; used by the room and the admin. */
export function NightCard({
  recap,
  ctx,
  header,
}: {
  recap: RoomRecap;
  ctx: CardContext;
  header?: ReactNode;
}) {
  const [allAwards, setAllAwards] = useState(false);
  const rich = (text: string) => <Rich text={text} names={ctx.names} labels={ctx.labels} />;
  const awards = allAwards ? recap.awards : recap.awards.slice(0, AWARDS_SHOWN);
  const hidden = recap.awards.length - awards.length;
  const empty = recap.games.length === 0;

  return (
    <>
      <header className="space-y-2">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {empty ? (
            'No finished games yet tonight.'
          ) : (
            <>
              {nightDate(recap.startedAt)} · {recap.games.length}{' '}
              {recap.games.length === 1 ? 'game' : 'games'} · {duration(playedMs(recap))}
            </>
          )}
          {recap.status === 'wrapped' && <Badge className="ml-2">Wrapped up</Badge>}
        </p>
        {header}
      </header>

      {empty ? (
        <div className="py-8 text-center">
          <p className="text-4xl" aria-hidden>
            📜
          </p>
          <p className="mt-2 font-semibold">No tales yet. Go play something!</p>
        </div>
      ) : (
        <>
          {recap.moment && (
            <section aria-label="Moment of the night">
              <h3 className={SECTION}>🎬 Moment of the night</h3>
              <p className="rounded-xl border-l-4 border-amber-400 bg-amber-100 px-4 py-3 font-medium text-amber-950 dark:bg-stone-800 dark:text-stone-100">
                <span aria-hidden>{recap.moment.emoji} </span>
                {rich(recap.moment.text)}
              </p>
            </section>
          )}
          {recap.mvp && (
            <section aria-label="Night MVP">
              <AwardRow line={recap.mvp} rich={rich} highlight />
            </section>
          )}
          {recap.awards.length > 0 && (
            <section aria-label="Awards">
              <h3 className={SECTION}>Awards</h3>
              <ul className="divide-y divide-stone-200 rounded-xl bg-white ring-1 ring-stone-200 dark:divide-stone-800 dark:bg-stone-900 dark:ring-stone-800">
                {awards.map((a) => (
                  <li key={`${a.awardId}:${a.players.join()}`}>
                    <AwardRow line={a} rich={rich} />
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1"
                  onClick={() => setAllAwards(true)}
                >
                  +{hidden} more
                </Button>
              )}
            </section>
          )}
          {recap.nuggets.length > 0 && (
            <section aria-label="By the numbers">
              <h3 className={SECTION}>By the numbers</h3>
              <ul className="flex flex-wrap gap-2">
                {recap.nuggets.map((n) => (
                  <li
                    key={n.text}
                    className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                  >
                    <span aria-hidden>{n.emoji} </span>
                    {rich(n.text)}
                    {n.record && <RecordBadge />}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PastGames games={recap.games} ctx={ctx} rich={rich} />
        </>
      )}

      <footer className="space-y-1 text-sm text-stone-500 dark:text-stone-400">
        {recap.running > 0 && (
          <p>
            {recap.running === 1 ? '1 game' : `${recap.running} games`} still in progress: it joins
            the recap when it ends.
          </p>
        )}
        {recap.abandoned > 0 && (
          <p>
            {recap.abandoned === 1 ? '1 game' : `${recap.abandoned} games`} abandoned, no questions
            asked.
          </p>
        )}
        {recap.audience.length > 0 && (
          <p>
            <span aria-hidden>🍿 </span>In the audience:{' '}
            {recap.audience.map((a) => a.name).join(', ')}
          </p>
        )}
      </footer>
    </>
  );
}

const RecordBadge = () => (
  <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-xs font-bold text-amber-900 dark:bg-amber-500/25 dark:text-amber-200">
    🆕 Room record
  </span>
);

const SECTION =
  'mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400';

function ToneSwitch({ tone, onTone }: { tone: RecapTone; onTone: (t: RecapTone) => void }) {
  const options: { id: RecapTone; label: string }[] = [
    { id: 'cheeky', label: '😏 Cheeky' },
    { id: 'wholesome', label: '🤗 Wholesome' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Recap tone"
      className="inline-flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-800"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={tone === o.id}
          onClick={() => tone !== o.id && onTone(o.id)}
          className={cn(
            'min-h-9 rounded-md px-3 text-sm font-semibold',
            tone === o.id
              ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-600 dark:text-stone-50'
              : 'text-stone-600 dark:text-stone-300',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AwardRow({
  line,
  rich,
  highlight = false,
}: {
  line: RecapLine;
  rich: (text: string) => ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'px-3 py-2',
        highlight &&
          'rounded-xl bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30',
      )}
    >
      <p className="text-sm font-bold">
        <span aria-hidden>{line.emoji} </span>
        {line.title}
      </p>
      <p className="text-sm text-stone-700 dark:text-stone-300">{rich(line.text)}</p>
    </div>
  );
}

/** "Past rounds": each finished game, who won, and its rounds. */
function PastGames({
  games,
  ctx,
  rich,
}: {
  games: GameRecap[];
  ctx: CardContext;
  rich: (text: string) => ReactNode;
}) {
  return (
    <section aria-label="Past rounds">
      <h3 className={SECTION}>Past rounds</h3>
      <ol className="space-y-2">
        {[...games].reverse().map((g, i) => {
          const winners = g.winners.map((id) => ctx.names.get(id) ?? 'someone');
          const info = ctx.gameInfo(g.gameId);
          return (
            <li key={`${g.gameId}:${g.gameNo}:${g.startedAt}`}>
              <details
                open={i === 0}
                className="rounded-xl bg-white ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              >
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <b>
                    {info.icon} Game {games.length - i}
                  </b>
                  {g.elsewhere && <> · {info.name}</>} · {duration(g.durationMs)} ·{' '}
                  {winners.length
                    ? `🏆 ${winners.length > 4 ? `${winners.slice(0, 4).join(', ')} +${winners.length - 4}` : winners.join(', ')}`
                    : 'No winners'}
                </summary>
                {(g.lines.length > 0 || g.history.length > 0) && (
                  <div className="space-y-2 border-t border-stone-200 px-3 py-2 text-sm dark:border-stone-800">
                    {g.history.length > 0 && (
                      <ol className="space-y-0.5 text-stone-700 dark:text-stone-300">
                        {g.history.map((h, n) => (
                          <li key={n}>{rich(h)}</li>
                        ))}
                      </ol>
                    )}
                    {g.lines.length > 0 && (
                      <ul className="space-y-0.5 text-stone-600 dark:text-stone-400">
                        {g.lines.map((l) => (
                          <li key={l.awardId}>
                            <span aria-hidden>{l.emoji} </span>
                            <b>{l.title}:</b> {rich(l.text)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "Sat 11 Oct · 🎭×3 🕵️×2". */
export function nightLabel(n: NightSummary, gameInfo: (gameId: string) => GameInfo): string {
  return `${nightDate(n.startedAt)} · ${n.mix.map((m) => `${gameInfo(m.gameId).icon}×${m.count}`).join(' ')}`;
}

/** The room's Hall of fame: MVPs, favourite awards, records and earlier nights. */
function HallView({
  hall,
  ctx,
  onOpen,
}: {
  hall: () => Promise<HallOfFame | null>;
  ctx: CardContext;
  onOpen: (nightKey: string) => Promise<void>;
}) {
  const [data, setData] = useState<HallOfFame | null | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void hall().then((h) => {
      if (live) setData(h);
    });
    return () => {
      live = false;
    };
  }, [hall]);
  if (data === 'loading')
    return <p className="py-10 text-center text-stone-500 dark:text-stone-400">Dusting off…</p>;
  if (!data) return <p className="py-10 text-center">The hall of fame is closed right now.</p>;
  const name = (id: string, fallback: string) => ctx.names.get(id) ?? fallback;
  const text = (t: string) => resolveText(t, ctx.names, ctx.labels);
  return (
    <section aria-label="Hall of fame" className="space-y-4">
      <p className="rounded-xl bg-amber-100 px-4 py-3 text-center font-semibold text-amber-950 dark:bg-stone-800 dark:text-stone-100">
        🍻 Nights together: {data.nights}
      </p>
      {data.mvps.length > 0 && (
        <div>
          <h3 className={SECTION}>👑 Most MVPs</h3>
          <ol className="flex flex-wrap gap-2">
            {data.mvps.map((m) => (
              <li
                key={m.playerId}
                className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              >
                <b className="text-amber-800 dark:text-amber-300">{name(m.playerId, m.name)}</b> ×
                {m.count}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.favourites.length > 0 && (
        <div>
          <h3 className={SECTION}>🏅 Signature awards</h3>
          <ul className="divide-y divide-stone-200 rounded-xl bg-white text-sm ring-1 ring-stone-200 dark:divide-stone-800 dark:bg-stone-900 dark:ring-stone-800">
            {data.favourites.map((f) => (
              <li key={f.playerId} className="px-3 py-2">
                <b className="text-amber-800 dark:text-amber-300">{name(f.playerId, f.name)}</b>:{' '}
                <span aria-hidden>{f.emoji} </span>
                {f.title} ×{f.count} nights
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.records.length > 0 && (
        <div>
          <h3 className={SECTION}>📏 Room records</h3>
          <ul className="space-y-1 text-sm">
            {data.records.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-2">
                <span>
                  <span aria-hidden>{r.emoji} </span>
                  {text(r.text)}
                </span>
                <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                  {nightDate(r.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.previous.length > 0 && (
        <div>
          <h3 className={SECTION}>📜 Previous nights</h3>
          <ul className="space-y-2">
            {data.previous.map((n) => (
              <li key={n.nightKey}>
                <button
                  type="button"
                  onClick={() => void onOpen(n.nightKey)}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm ring-1 ring-stone-200 hover:bg-stone-100 dark:bg-stone-900 dark:ring-stone-800 dark:hover:bg-stone-800"
                >
                  <span>
                    <b>{nightLabel(n, ctx.gameInfo)}</b>
                    {n.mvp && (
                      <span className="text-stone-600 dark:text-stone-400"> · 👑 {n.mvp}</span>
                    )}
                  </span>
                  <span aria-hidden>›</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
