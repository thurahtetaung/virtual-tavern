import { Panel, PlayerTag } from '@vt/ui';
import { useEffect, useMemo } from 'react';
import { PAGES, PageBody, ClaimsSummary, pageName } from './Manual.tsx';
import { artFor, useManifest } from './assets.ts';
import { BombScreen } from './Bomb.tsx';
import { ExpertClock, type DefuseUiProps } from './DefuseGame.tsx';
import { player, useBombSound } from './sound.ts';
import { useServerNow } from './time.ts';
import type { PageId } from '../logic/types.ts';

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
      <div className="mx-auto max-w-7xl space-y-3 p-4" data-testid="stage-bomb">
        <p className="text-center text-xl font-semibold">💣 {defuser} is defusing. Experts: don’t look at this screen.</p>
        <BombScreen b={v.bomb} art={art} now={now} act={null} readOnly />
      </div>
    );
  if (v.stage === 'bomb') {
    const claimed = PAGES.filter((p) => v.claims?.[p]?.length);
    const pages: PageId[] = (claimed.length ? claimed : (['wires', 'button'] as PageId[])).slice(0, 4);
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-4" data-testid="stage-manual">
        <Panel className="flex flex-wrap items-center gap-4 text-xl">
          <span className="flex-1 font-semibold">📖 Bomb {v.bombNo}: {defuser} is defusing</span>
          <ExpertClock v={v} offset={room.clockOffset} />
        </Panel>
        <Panel>
          <ClaimsSummary v={v} names={names} art={art} />
        </Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          {pages.map((p) => (
            <Panel key={p} className="space-y-2 text-lg">
              <h3 className="text-2xl font-semibold">{pageName(art, p)}</h3>
              <PageBody page={p} art={art} />
            </Panel>
          ))}
        </div>
      </div>
    );
  }
  const last = v.history.at(-1);
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-8 text-center text-2xl" data-testid="stage-lobby">
      {v.stage === 'result' && last ? (
        <p className="text-4xl font-black uppercase tracking-widest">{last.how === 'defused' ? 'Defused' : 'Exploded'}</p>
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
