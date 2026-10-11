import type { GameRecap, RecapLine, RecapTone, RoomRecap } from '@vt/protocol';
import { Badge, Button, cn } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import { useToast } from '../lib/toast.tsx';
import { chatText, duration, nightDate, playedMs } from './copyText.ts';
import { type Labeler, resolveSegments } from './resolve.ts';

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

/** The night card, for the room's recap drawer. */
export function RecapSheet({
  recap,
  game,
  names,
  labels,
  isHost,
  onTone,
  onWrap,
  onShared,
}: {
  recap: RoomRecap | null;
  game: { name: string; icon: string };
  names: ReadonlyMap<string, string>;
  labels: Labeler | null;
  isHost: boolean;
  onTone: (tone: RecapTone) => void;
  onWrap: () => void;
  onShared: (how: 'copy' | 'share') => void;
}) {
  const toast = useToast();
  const [allAwards, setAllAwards] = useState(false);
  const touch =
    typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;

  if (!recap) {
    return <p className="py-10 text-center text-stone-500 dark:text-stone-400">Pouring…</p>;
  }
  const rich = (text: string) => <Rich text={text} names={names} labels={labels} />;
  const text = () => chatText(recap, { game, names, labels });

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

  const awards = allAwards ? recap.awards : recap.awards.slice(0, AWARDS_SHOWN);
  const hidden = recap.awards.length - awards.length;
  const empty = recap.games.length === 0;

  return (
    <div className="flex min-h-full flex-col gap-4">
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
        {isHost && <ToneSwitch tone={recap.tone} onTone={onTone} />}
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
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PastGames games={recap.games} game={game} rich={rich} names={names} />
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

      <div className="sticky bottom-0 -mx-4 mt-auto -mb-4 flex flex-wrap gap-2 border-t border-stone-200 bg-stone-50/95 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/95">
        {!empty && (
          <Button className="min-h-11 flex-1" onClick={() => void copy()}>
            📋 Copy for chat
          </Button>
        )}
        {!empty && touch && (
          <Button variant="secondary" className="min-h-11" onClick={() => void share()}>
            📤 Share
          </Button>
        )}
        {isHost && !empty && recap.status === 'live' && !recap.running && (
          <Button variant="secondary" className="min-h-11" onClick={onWrap}>
            🍻 Wrap up the night
          </Button>
        )}
      </div>
    </div>
  );
}

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
  game,
  rich,
  names,
}: {
  games: GameRecap[];
  game: { name: string; icon: string };
  rich: (text: string) => ReactNode;
  names: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-label="Past rounds">
      <h3 className={SECTION}>Past rounds</h3>
      <ol className="space-y-2">
        {[...games].reverse().map((g, i) => {
          const winners = g.winners.map((id) => names.get(id) ?? 'someone');
          return (
            <li key={`${g.gameNo}:${g.startedAt}`}>
              <details
                open={i === 0}
                className="rounded-xl bg-white ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              >
                <summary className="cursor-pointer px-3 py-2 text-sm">
                  <b>
                    {game.icon} Game {games.length - i}
                  </b>{' '}
                  · {duration(g.durationMs)} ·{' '}
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
