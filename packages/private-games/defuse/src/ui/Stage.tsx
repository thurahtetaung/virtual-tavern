import { Panel, PlayerTag, cn } from '@vt/ui';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { PAGES, PageBody, ClaimsSummary, pageName } from './Manual.tsx';
import { artFor, useManifest } from './assets.ts';
import { BombScreen } from './Bomb.tsx';
import { ExpertClock, type DefuseUiProps } from './DefuseGame.tsx';
import { player, useBombSound } from './sound.ts';
import { useServerNow } from './time.ts';
import type { PageId } from '../logic/types.ts';

/** Shrinks its content to the height it is given: a table screen can't scroll. */
function Fit({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const b = box.current;
      const i = inner.current;
      if (!b || !i) return;
      i.style.zoom = '1';
      const scale = Math.min(1, b.clientHeight / Math.max(1, i.scrollHeight));
      i.style.zoom = String(Math.max(0.4, scale));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    return () => {
      ro.disconnect();
    };
  });
  return (
    <div ref={box} className="h-full min-h-0 overflow-hidden">
      <div ref={inner}>{children}</div>
    </div>
  );
}

/**
 * The table screen (`role: 'stage'`). With "Table screen shows: Manual" (the default) it is the
 * experts' shared manual: the claims and the claimed pages, large. With "Bomb" it shows the
 * defuser's bomb, read-only, and plays its sounds; then the experts must not look.
 */
export function DefuseStage({ view: v, room }: DefuseUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = useMemo(() => new Map(room.players.map((p) => [p.id, p.name])), [room.players]);
  const now = useServerNow(room.clockOffset, 40, !!v.bomb);
  useBombSound(v.stage === 'bomb' ? v.bomb : null, art, room.clockOffset);
  useEffect(() => {
    return () => {
      player.setMusic(null);
    };
  }, []);
  const defuser = v.seats.find((p) => p.id === v.defuser)?.name ?? 'Someone';
  if (v.stage === 'bomb' && v.bomb)
    return (
      <div
        className="mx-auto max-w-[calc((100vh-10rem)*2.05)] space-y-3 p-4 text-stone-100"
        data-testid="stage-bomb"
      >
        <p className="text-center text-xl font-semibold">
          💣 {defuser} is defusing. Experts: don’t look at this screen.
        </p>
        <BombScreen key={v.bomb.no} b={v.bomb} art={art} now={now} act={null} readOnly />
      </div>
    );
  if (v.stage === 'bomb') {
    const claimed = PAGES.filter((p) => v.claims?.[p]?.length);
    const pages: PageId[] = (claimed.length ? claimed : (['wires', 'button'] as PageId[])).slice(
      0,
      4,
    );
    return (
      <div
        className="mx-auto flex h-screen max-w-7xl flex-col gap-4 p-4"
        data-testid="stage-manual"
      >
        <Panel className="flex flex-wrap items-center gap-4 text-xl">
          <span className="flex-1 font-semibold">
            📖 Bomb {v.bombNo}: {defuser} is defusing
          </span>
          <ExpertClock v={v} offset={room.clockOffset} />
        </Panel>
        <Panel>
          <ClaimsSummary v={v} names={names} art={art} />
        </Panel>
        <div className={cn('grid min-h-0 flex-1 gap-4', pages.length > 1 && 'grid-cols-2')}>
          {pages.slice(0, 2).map((p) => (
            <Panel key={p} className="min-h-0 text-lg">
              <Fit>
                <h3 className="mb-2 text-2xl font-semibold">{pageName(art, p)}</h3>
                <PageBody page={p} art={art} />
              </Fit>
            </Panel>
          ))}
        </div>
      </div>
    );
  }
  const last = v.history.at(-1);
  return (
    <div
      className="mx-auto max-w-4xl space-y-4 p-8 text-center text-2xl text-stone-100"
      data-testid="stage-lobby"
    >
      {v.stage === 'result' && last ? (
        <p className="text-4xl font-black uppercase tracking-widest">
          {last.how === 'defused' ? 'Defused' : 'Exploded'}
        </p>
      ) : (
        <p className="font-semibold">💣 Waiting for the next bomb</p>
      )}
      <ul className="flex flex-wrap justify-center gap-3">
        {v.seats.map((p) => (
          <li key={p.id}>
            <PlayerTag name={p.name} />
          </li>
        ))}
      </ul>
    </div>
  );
}
