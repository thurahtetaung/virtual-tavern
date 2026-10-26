import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useState } from 'react';
import { COLOUR_BONUS, COLUMN_BONUS, type MosaicView, ROW_BONUS } from '../logic/types.ts';
import type { Art } from './assets.ts';
import { BoardView } from './Pieces.tsx';
import type { Act } from './Table.tsx';

/** One placement every this many ms, then the floor, then (at the end) the bonuses. */
const STEP_MS = 450;

const reduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The round's wall-tiling on every screen, all boards at once: each full line's tile slides to the
 * wall in turn and its run glows with "+n", then the floor cracks with its cost; after the last
 * round the bonuses tick up. Reduced motion shows the end at once.
 */
export function useTilingStep(key: string, steps: number) {
  const [step, setStep] = useState(() => (reduced() ? steps : 0));
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setStep(reduced() ? steps : 0);
  }
  useEffect(() => {
    if (step >= steps) return;
    const t = setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => {
      clearTimeout(t);
    };
  }, [step, steps]);
  return [step, () => setStep(steps)] as const;
}

export function Tiling({
  view,
  room,
  act,
  art,
}: {
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const g = view.game!;
  const s = g.scoring;
  const players = g.players.filter((p) => s?.players[p.id]);
  const most = Math.max(0, ...players.map((p) => s!.players[p.id]!.placed.length));
  // Placements, the floor, and on the last round the three bonus lines.
  const steps = most + 1 + (s?.last ? 3 : 0);
  const [step, finish] = useTilingStep(`${s?.round}:${s?.last}`, steps);
  if (!s) return null;
  const me = g.players.find((p) => p.id === room.you && !p.removed);
  const waiting = view.phase === 'playing' && g.stage === 'tiling';
  const ready = g.ready.includes(room.you);
  const ordered = [...players].sort(
    (a, b) => Number(b.id === room.you) - Number(a.id === room.you),
  );
  const bonusStep = step - most - 1;
  return (
    <section
      aria-label={`Round ${s.round} wall-tiling`}
      className="mo-rise flex flex-col gap-2 rounded-2xl bg-card/90 p-2.5 shadow-sm ring-1 ring-line dark:bg-stone-900/85 dark:ring-stone-800"
      data-testid="mo-tiling"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">
          {s.last ? `Round ${s.round}: the last wall-tiling` : `Round ${s.round}: wall-tiling`}
        </h2>
        {step < steps && (
          <Button variant="ghost" size="sm" onClick={finish}>
            Show all
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ordered.map((p) => {
          const ps = s.players[p.id]!;
          const shown = Math.min(step, ps.placed.length);
          const gained = ps.placed.slice(0, shown).reduce((n, x) => n + x.points, 0);
          const floorDone = step > most;
          const b = ps.bonus;
          return (
            <div
              key={p.id}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl p-1.5 ring-1 ring-line dark:ring-stone-800',
                p.id === room.you && 'ring-2 ring-accent dark:ring-amber-500',
              )}
              data-tiling={p.id}
            >
              <div className="flex w-full items-center justify-between gap-2 text-sm">
                <PlayerTag name={p.name} you={p.id === room.you} />
                <span className="font-bold tabular-nums" aria-live="polite">
                  {ps.before}
                  {gained ? (
                    <span className="text-success-ink dark:text-emerald-300"> +{gained}</span>
                  ) : null}
                  {floorDone && ps.penalty ? (
                    <span className="text-danger-ink dark:text-rose-300"> {ps.penalty}</span>
                  ) : null}
                  {floorDone && <> = {ps.bonus ? ps.after - ps.bonus.points : ps.after}</>}
                </span>
              </div>
              <BoardView
                board={p}
                art={art}
                size="sm"
                frame={{ score: ps, shown, floorDone }}
                owner={p.id}
              />
              {b && bonusStep >= 0 && (
                <p className="w-full text-xs tabular-nums" data-testid="mo-bonus">
                  <span className={cn(bonusStep >= 0 && 'mo-rise')}>
                    Rows {b.rows} × {ROW_BONUS}
                  </span>
                  {bonusStep >= 1 && (
                    <span className="mo-rise">
                      {' · '}Columns {b.columns} × {COLUMN_BONUS}
                    </span>
                  )}
                  {bonusStep >= 2 && (
                    <span className="mo-rise">
                      {' · '}Colours {b.colours} × {COLOUR_BONUS}
                      <strong className="ml-1 text-success-ink dark:text-emerald-300">
                        = +{b.points} → {ps.after}
                      </strong>
                    </span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {waiting && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Countdown
            deadline={g.tilingUntil}
            clockOffset={room.clockOffset}
            label="until the next round"
          />
          {me && !ready && (
            <Button
              onClick={() => void act({ type: 'ready' }, { anchor: 'mo-tiling' })}
              data-testid="mo-next"
            >
              Next round
            </Button>
          )}
          {me && ready && (
            <span className="text-sm text-ink-muted dark:text-stone-400">
              Waiting for the others…
            </span>
          )}
          {room.isHost && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void act({ type: 'skip-tiling' }, { anchor: 'mo-tiling' })}
            >
              Start it now for everyone
            </Button>
          )}
          <RefusalSlot anchor="mo-tiling" />
        </div>
      )}
    </section>
  );
}
