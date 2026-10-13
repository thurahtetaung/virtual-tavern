import type { GameRoomInfo } from '@vt/game-sdk';
import { PlayerTag, cn } from '@vt/ui';
import { useEffect, useRef } from 'react';
import type { ShortFuseView } from '../logic/types.ts';

/**
 * The table's seats in play order: hand counts, whose turn it is (with the turns they owe), who
 * the table waits on, and who's out. While the viewer picks a target, the eligible seats become
 * buttons.
 */
export function Seats({
  view,
  room,
  targets,
  onPick,
}: {
  view: ShortFuseView;
  room: GameRoomInfo;
  /** Seats that can be picked right now (null when not picking). */
  targets: string[] | null;
  onPick: (id: string) => void;
}) {
  const g = view.game!;
  const strip = useRef<HTMLOListElement>(null);
  const current = g.turn.player;
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-seat="${CSS.escape(current)}"]`);
    if (el && strip.current && strip.current.scrollWidth > strip.current.clientWidth) {
      strip.current.scrollTo({
        left: el.offsetLeft - strip.current.clientWidth / 2 + el.offsetWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [current]);
  const waiting = new Set(g.waiting);
  return (
    <section aria-label="Players" data-testid="seats">
      <ol
        ref={strip}
        className="flex snap-x gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {g.players.map((p, i) => {
          const online = room.players.find((r) => r.id === p.id)?.connected ?? false;
          const turn = p.id === current && view.phase === 'playing';
          const out = p.dead || p.left;
          const pickable = targets?.includes(p.id) ?? false;
          const body = (
            <>
              <span className="flex min-w-0 items-center gap-1 text-sm font-semibold">
                {turn && <span aria-hidden>▶</span>}
                <PlayerTag
                  name={p.name}
                  host={p.id === room.hostId}
                  you={p.id === view.me?.id}
                  offline={!online && !out}
                  className="max-w-[7.5rem]"
                />
              </span>
              <span className="flex items-center gap-1.5 text-xs text-ink-muted">
                {p.dead ? (
                  <span>💥 out (turn {p.deadTurn})</span>
                ) : p.left ? (
                  <span>left</span>
                ) : (
                  <span aria-label={`${p.hand} cards in hand`} data-testid="hand-count">
                    🂠 {p.hand}
                  </span>
                )}
                {turn && g.turn.owed > 1 && (
                  <span
                    className="sf-owed rounded-full bg-danger px-1.5 font-bold text-white"
                    aria-label={`owes ${g.turn.owed} turns`}
                    data-testid="owed"
                  >
                    ×{g.turn.owed}
                  </span>
                )}
              </span>
            </>
          );
          return (
            <li key={p.id} data-seat={p.id} className="shrink-0 snap-start">
              {pickable ? (
                <button
                  type="button"
                  onClick={() => onPick(p.id)}
                  className="sf-breathe flex min-h-11 min-w-24 flex-col items-start rounded-xl bg-accent-soft px-2.5 py-1 text-left ring-2 ring-accent"
                  aria-label={`Choose ${p.name}`}
                >
                  {body}
                </button>
              ) : (
                <div
                  className={cn(
                    'flex min-h-11 min-w-24 flex-col items-start rounded-xl px-2.5 py-1 ring-1',
                    turn ? 'bg-accent-soft ring-2 ring-accent' : 'bg-card ring-line',
                    out && 'opacity-55',
                    targets && !pickable && 'opacity-40',
                    waiting.has(p.id) && !turn && 'ring-2 ring-info-line',
                  )}
                  aria-current={turn ? 'step' : undefined}
                >
                  {body}
                </div>
              )}
              {i < g.players.length - 1 && <span className="sr-only">, then</span>}
            </li>
          );
        })}
      </ol>
      <p className="mt-0.5 text-[0.7rem] text-ink-muted">
        Play goes {g.turn.dir === 1 ? 'left to right →' : '← right to left'}
      </p>
    </section>
  );
}
