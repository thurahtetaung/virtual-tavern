import { PlayerTag, ProtectedImage, cn } from '@vt/ui';
import { Poster, PosterSlate } from '@vt/ui/show';
import { useEffect, useMemo, useState } from 'react';
import { PAGES, pageName } from './Manual.tsx';
import { type Art, artFor, useManifest } from './assets.ts';
import { leftAt, timerText } from '../logic/bomb.ts';
import { Binder } from './Binder.tsx';
import { BombScreen } from './Bomb.tsx';
import { Bomb3D } from './three/Bomb3D.tsx';
import type { DefuseUiProps } from './DefuseGame.tsx';
import { tableVolumes } from '@vt/ui/sound';
import { player, useBombSound, usePlayerVolumes } from './sound.ts';
import { useServerNow } from './time.ts';
import type { PageId } from '../logic/types.ts';

/** The bomb's end on the table screen: the same stamp the phones show, large, on the poster. */
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
    <div className="flex flex-col items-center gap-4" data-testid="stage-result">
      {stamp && <ProtectedImage src={stamp} alt="" className="h-64 w-auto" />}
      <p
        className={cn(
          'text-[72px] font-black tracking-widest uppercase',
          stamp && 'sr-only',
          defused ? 'text-success-ink' : 'text-danger-ink',
        )}
      >
        {defused ? 'Defused' : 'Exploded'}
      </p>
      <p className="max-w-[1400px] text-[36px] font-medium text-balance">
        {defused
          ? `${defuser} defused bomb ${last.no} with ${timerText(last.left)} left.`
          : last.how === 'time'
            ? `Time ran out on ${defuser}.`
            : `Too many strikes: bomb ${last.no} went off in ${defuser}’s hands.`}
      </p>
      <p className="text-[28px] text-ink-muted">
        {last.solved} of {last.modules} modules · {last.strikes} strike
        {last.strikes === 1 ? '' : 's'}
      </p>
    </div>
  );
}

/** Everyone at the table, big. */
function Seats({ v }: { v: DefuseUiProps['view'] }) {
  return (
    <ul className="mt-4 flex max-w-[1500px] flex-wrap justify-center gap-x-10 gap-y-4 text-[36px] [&_[data-color]]:size-6">
      {v.seats.map((p) => (
        <li key={p.id}>
          <PlayerTag name={p.name} />
        </li>
      ))}
    </ul>
  );
}

/** The experts' clock on the poster, when the host lets them see it. */
function ManualClock({ v, offset }: { v: DefuseUiProps['view']; offset: number }) {
  const now = useServerNow(offset, 100, !!v.clock);
  if (!v.clock) return <p className="text-[28px] text-ink-muted">Ask the defuser for the time</p>;
  const left = leftAt({ ...v.clock, end: v.clock.end }, now);
  return (
    <div className="flex flex-col items-center" data-testid="expert-clock">
      <p
        role="timer"
        className="font-mono text-[120px] leading-none font-semibold tabular-nums text-danger-ink"
      >
        {timerText(left)}
      </p>
      <p className="mt-2 text-[28px] text-ink-muted">
        {v.clock.strikes} of {v.clock.strikeLimit} strikes
      </p>
    </div>
  );
}

/**
 * The table screen (`role: 'stage'`), on the shared poster. With "Table screen shows: Manual" (the
 * default) it shows the experts' side: who reads which page, and the clock when the host shows it
 * (the pages stay on the experts' phones). With "Bomb" it shows the defuser's bomb, read-only and
 * inert, and plays its sounds; then the experts must not look.
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
        // The table screen only shows the defuser's bomb: nothing on it can be pressed.
        inert
      >
        <p className="text-center text-[28px] font-semibold">
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
    // Who reads which page, big; the pages themselves stay on the experts' phones.
    const byExpert = new Map<string, PageId[]>();
    for (const page of PAGES)
      for (const id of v.claims?.[page] ?? [])
        byExpert.set(id, [...(byExpert.get(id) ?? []), page]);
    return (
      <Poster
        testId="stage-manual"
        meta={`Bomb ${v.bombNo}`}
        eyebrow="Read the manual"
        headline={`${defuser} is defusing`}
        clock={<ManualClock v={v} offset={room.clockOffset} />}
        footer={{ icon: 'book-open', text: 'The manual is on the experts’ phones: read it out.' }}
      >
        {byExpert.size ? (
          <ul className="flex max-w-[1600px] flex-wrap justify-center gap-6" data-testid="claims">
            {[...byExpert].map(([id, pages]) => (
              <li key={id}>
                <PosterSlate className="min-w-[280px] content-start gap-2 px-8 text-left">
                  <span className="block text-[32px] [&_[data-color]]:size-5">
                    <PlayerTag name={names.get(id) ?? '?'} />
                  </span>
                  <span className="block text-[28px] font-medium text-ink-2">
                    {pages.map((page) => pageName(art, page)).join(', ')}
                  </span>
                </PosterSlate>
              </li>
            ))}
          </ul>
        ) : (
          // Nothing claimed yet: the experts, big, as slates waiting for their pages.
          <ul
            className="flex max-w-[1600px] flex-wrap justify-center gap-6"
            data-testid="claims-none"
          >
            {v.seats
              .filter((p) => p.id !== v.defuser)
              .map((p) => (
                <li key={p.id}>
                  <PosterSlate className="min-w-[280px] content-start gap-2 px-8 text-left">
                    <span className="block text-[32px] [&_[data-color]]:size-5">
                      <PlayerTag name={p.name} />
                    </span>
                    <span className="block text-[28px] text-ink-muted">No page yet</span>
                  </PosterSlate>
                </li>
              ))}
          </ul>
        )}
      </Poster>
    );
  }
  const last = v.history.at(-1);
  const lastDefuser =
    last && (names.get(last.defuser) ?? v.seats.find((p) => p.id === last.defuser)?.name);
  return (
    <Poster
      testId="stage-lobby"
      eyebrow={v.stage === 'result' && last ? `Bomb ${last.no}` : 'Between bombs'}
      headline={v.stage === 'result' && last ? undefined : '💣 Waiting for the next bomb'}
      footer={{ icon: 'users', text: 'The host starts the next bomb from their phone.' }}
    >
      {v.stage === 'result' && last ? (
        <StageResult last={last} art={art} defuser={lastDefuser ?? 'Someone'} />
      ) : null}
      <Seats v={v} />
    </Poster>
  );
}
