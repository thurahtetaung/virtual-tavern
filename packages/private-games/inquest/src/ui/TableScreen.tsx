import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, cn } from '@vt/ui';
import type { InquestView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content } from './assets.ts';
import { LatestBullets } from './Scene.tsx';
import { nameOf, statusFor } from './status.ts';
import { suspectsOf } from './Suspects.tsx';
import { Tile } from './Tile.tsx';

/**
 * A big, read-only layout for a shared screen at an in-person table: the tiles with their
 * bullets, every suspect's cards, and who is presenting. It only uses a watcher's view, which
 * carries nothing private.
 */
export function TableScreen({
  view,
  room,
  content,
  onExit,
}: {
  view: InquestView;
  room: GameRoomInfo;
  content: Content;
  onExit: () => void;
}) {
  const g = view.game!;
  const p = g.present;
  const speaker = g.stage === 'present' && p ? p.order[p.index] : null;
  const newest = g.bullets.at(-1);
  return (
    <div className="space-y-3" aria-label="Table screen">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-stone-900 px-4 py-2 text-stone-50">
        <p className="flex-1 text-xl font-semibold">
          {speaker
            ? `🎙️ ${nameOf(view, speaker)} is presenting`
            : statusFor(view, false, room).text}
          <span className="ml-3 text-base font-normal text-stone-400">
            Round {g.round} of {g.finalRound}
            {g.countdown && g.stage !== 'done' ? ' · last round' : ''}
          </span>
        </p>
        {speaker && p && (
          <Countdown
            deadline={p.deadline}
            clockOffset={room.clockOffset}
            soft={view.settings.presentMode === 'soft'}
          />
        )}
        <Button variant="secondary" size="sm" onClick={onExit}>
          Leave table screen
        </Button>
      </div>
      {g.stage === 'present' && <LatestBullets g={g} content={content} />}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid grid-cols-3 gap-2 self-start">
          {g.slots.map((s, i) => (
            <Tile
              key={`${i}-${s.tile}`}
              tile={s.tile}
              bullet={s.bullet}
              content={content}
              fresh={newest?.slot === i && newest.tile === s.tile}
              className="[&_h4]:text-sm [&_li>div]:text-sm"
            />
          ))}
        </div>
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Suspects">
          {suspectsOf(g).map((s) => (
            <li
              key={s.id}
              className={cn(
                'rounded-xl bg-white/70 p-2 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:ring-stone-800',
                s.id === speaker && 'ring-4 ring-amber-400',
              )}
            >
              <h4 className="mb-1 text-lg font-bold">
                {s.name}
                {s.badges <= 0 && (
                  <span className="ml-2 text-sm font-normal text-stone-500">attempt used</span>
                )}
              </h4>
              <div className="space-y-1.5">
                {(['clue', 'means'] as const).map((deck) => (
                  <div
                    key={deck}
                    className={cn(
                      'grid gap-1.5',
                      s.clue.length > 4 ? 'grid-cols-5' : 'grid-cols-4',
                    )}
                  >
                    {(deck === 'clue' ? s.clue : s.means).map((n) => (
                      <ArtCard
                        key={n}
                        deck={deck}
                        n={n}
                        content={content}
                        ruledOut={deck === 'clue' && s.ruledOut.includes(n)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
