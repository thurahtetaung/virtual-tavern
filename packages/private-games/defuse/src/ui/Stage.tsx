import { Panel, PlayerTag, ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PAGES, PageBody, ClaimsSummary, pageName } from './Manual.tsx';
import { type Art, artFor, useManifest } from './assets.ts';
import { timerText } from '../logic/bomb.ts';
import { Binder } from './Binder.tsx';
import { BombScreen } from './Bomb.tsx';
import { Bomb3D } from './three/Bomb3D.tsx';
import { ExpertClock, type DefuseUiProps } from './DefuseGame.tsx';
import { tableVolumes } from '@vt/ui/sound';
import { player, useBombSound, usePlayerVolumes } from './sound.ts';
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

/** The bomb's end on the table screen: the same stamp the phones show, large. */
function StageResult({
  last,
  art,
  defuser,
}: {
  last: DefuseUiProps['view']['history'][number];
  art: Art;
  defuser: string;
}) {
  const defused = last.how === 'defused';
  const stamp = art.stamp(defused ? 'defused' : 'exploded');
  return (
    <div className="space-y-3" data-testid="stage-result">
      {stamp && <ProtectedImage src={stamp} alt="" className="mx-auto h-56 w-auto" />}
      <p
        className={cn(
          'text-5xl font-black uppercase tracking-widest',
          stamp && 'sr-only',
          defused ? 'text-success-ink' : 'text-danger-ink',
        )}
      >
        {defused ? 'Defused' : 'Exploded'}
      </p>
      <p>
        {defused
          ? `${defuser} defused bomb ${last.no} with ${timerText(last.left)} left.`
          : last.how === 'time'
            ? `Time ran out on ${defuser}.`
            : `Too many strikes: bomb ${last.no} went off in ${defuser}’s hands.`}
      </p>
      <p className="text-lg text-stone-300">
        {last.solved} of {last.modules} modules · {last.strikes} strike
        {last.strikes === 1 ? '' : 's'}
      </p>
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
  // Paired with a tap on its pairing page, so it may play from the start, as Going Once's does,
  // at the host's volumes for the table screen.
  usePlayerVolumes(tableVolumes(v.tableVolumes), true);
  // The bomb while it shows it, and every bomb's end.
  useBombSound(
    (v.stage === 'bomb' && v.settings.table === 'bomb') || v.stage === 'result' ? v.bomb : null,
    art,
    room.clockOffset,
    { room: v.settings.table === 'bomb' && v.look?.mode !== '2d' },
  );
  useEffect(() => {
    return () => {
      player.setMusic(null);
    };
  }, []);
  const defuser = v.seats.find((p) => p.id === v.defuser)?.name ?? 'Someone';
  const [closed, setClosed] = useState(-1);
  // Showing the bomb, the screen ends as the defuser's does: a defused room fades out over 9 s,
  // then (and at once after an explosion) the binder's results page.
  const end = v.stage === 'result' && v.settings.table === 'bomb' ? v.bomb?.end : null;
  const roomUntil = end?.how === 'defused' && v.look?.mode !== '2d' ? end.at + 9000 : 0;
  if (end && v.bomb && now < roomUntil)
    return (
      <div className="h-screen w-full p-4">
        <Bomb3D
          key={v.bomb.no}
          b={v.bomb}
          art={art}
          offset={room.clockOffset}
          act={null}
          fullScreen={false}
        />
      </div>
    );
  if (end && v.bomb && closed !== v.bomb.no)
    return (
      <Binder
        b={v.bomb}
        settings={v.settings}
        art={art}
        offset={room.clockOffset}
        sound
        room={v.look?.mode !== '2d'}
        retry={null}
        close={() => setClosed(v.bomb!.no)}
      />
    );
  if (v.stage === 'bomb' && v.bomb)
    return (
      <div
        className={cn(
          'mx-auto space-y-3 p-4 text-stone-100',
          v.look?.mode === '2d' && 'max-w-[calc((100vh-10rem)*2.05)]',
        )}
        data-testid="stage-bomb"
      >
        <p className="text-center text-xl font-semibold">
          💣 {defuser} is defusing. Experts: don’t look at this screen.
        </p>
        {v.look?.mode === '2d' ? (
          <BombScreen key={v.bomb.no} b={v.bomb} art={art} now={now} act={null} readOnly />
        ) : (
          <div className="h-[calc(100vh-8rem)] w-full">
            <Bomb3D
              key={v.bomb.no}
              b={v.bomb}
              art={art}
              offset={room.clockOffset}
              act={null}
              mirror={v.look}
              fullScreen={false}
            />
          </div>
        )}
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
        <StageResult
          last={last}
          art={art}
          defuser={
            names.get(last.defuser) ?? v.seats.find((p) => p.id === last.defuser)?.name ?? 'Someone'
          }
        />
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
