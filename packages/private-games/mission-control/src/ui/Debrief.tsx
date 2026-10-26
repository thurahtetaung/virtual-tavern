import type { GameRoomInfo } from '@vt/game-sdk';
import { TokenIcon } from './Token.tsx';
import { Button, Panel, RefusalSlot, Superlatives, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { type CardId, sortCards } from '../logic/cards.ts';
import {
  type AttemptView,
  type CampaignView,
  DUMMY,
  EPILOGUE,
  type MissionControlAction,
} from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { CardFace, Rich } from './Card.tsx';
import { missionLabel } from './status.ts';
import { TrickRow } from './Table.tsx';
import { TaskChip } from './Tasks.tsx';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;
const ANCHOR = 'mc-debrief';

/** The post-mortem: every dealt hand, then the tricks one by one; the failing trick is marked. */
export function Replay({ a, name }: { a: AttemptView; name: (id: string) => string }) {
  const r = a.replay!;
  const last = r.tricks.length;
  const [at, setAt] = useState(last);
  const played = new Set(r.tricks.slice(0, at).flatMap((t) => t.plays.map((p) => p.card)));
  const failing = a.result && !a.result.success && !a.result.timedOut ? a.result.tricks : null;
  const shown = at > 0 ? r.tricks[at - 1]! : null;
  return (
    <div className="space-y-3" data-testid="mc-replay">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="secondary"
          aria-label="Previous trick"
          disabled={at === 0}
          onClick={() => setAt(at - 1)}
        >
          ◀
        </Button>
        <input
          type="range"
          min={0}
          max={last}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          className="min-w-0 flex-1 accent-current"
          aria-label="Trick"
        />
        <Button
          size="icon"
          variant="secondary"
          aria-label="Next trick"
          disabled={at === last}
          onClick={() => setAt(at + 1)}
        >
          ▶
        </Button>
      </div>
      <p
        className={cn(
          'text-center text-sm font-semibold',
          at === failing && 'text-danger-ink dark:text-rose-300',
        )}
      >
        {at === 0 ? 'The deal' : `Trick ${at} of ${last}, won by ${name(shown!.winner)}`}
        {at === failing ? ' · the attempt was lost here' : ''}
      </p>
      {shown && (
        <div
          className={cn(
            'rounded-xl p-2',
            at === failing &&
              'bg-danger-soft ring-1 ring-danger-line dark:bg-rose-500/10 dark:ring-rose-500/30',
          )}
        >
          <TrickRow plays={shown.plays} name={name} winner={shown.winner} size="sm" />
        </div>
      )}
      <ul className="space-y-2">
        {a.crew.map((c) => (
          <li key={c.id}>
            <p className="text-xs font-semibold">
              {c.id === DUMMY ? `🤖 ${name(DUMMY)}` : name(c.id)}
            </p>
            <div className="flex flex-wrap gap-1">
              {sortCards(r.hands[c.id] ?? []).map((card: CardId) => (
                <CardFace
                  key={card}
                  card={card}
                  size="xs"
                  state={played.has(card) ? 'dim' : 'normal'}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Debrief({
  a,
  room,
  me,
  act,
  name,
  campaign,
}: {
  a: AttemptView;
  room: GameRoomInfo;
  me: string;
  act: Act;
  name: (id: string) => string;
  campaign: CampaignView | null;
}) {
  const art = useArt();
  const r = a.result!;
  const send = (action: MissionControlAction) => void act(action, { anchor: ANCHOR });
  const inCrew = a.crew.some((c) => c.id === me);
  const decide = inCrew || room.isHost;
  const [replay, setReplay] = useState(false);
  // Every card the replay shows, fetched now so it is ready when opened.
  const thumbs = useMemo(
    () =>
      Object.values(a.replay?.hands ?? {})
        .flat()
        .map((c) => art.cardThumb(c)),
    [a.replay, art],
  );
  useEffect(() => {
    for (const url of thumbs) if (url) new Image().src = url;
  }, [thumbs]);
  const failed = r.task !== null ? a.tasks[r.task] : null;
  const log = a.mission.n !== EPILOGUE ? campaign?.log[a.mission.n] : null;
  return (
    <Panel
      className="mx-auto max-w-2xl space-y-4"
      data-testid="mc-debrief"
      data-result={r.success ? 'success' : 'failure'}
    >
      {r.success ? (
        <div className="space-y-2 text-center">
          <p className="text-3xl sm:text-5xl" aria-hidden>
            🏅
          </p>
          <h2 className="text-2xl font-black">
            {missionLabel(a.mission.n, a.mission.label)} accomplished!
          </h2>
          <p
            className="inline-block -rotate-2 rounded-lg px-3 py-1 font-black uppercase tracking-wider text-success-ink ring-2 ring-success-line dark:text-emerald-200 dark:ring-emerald-500/50"
            data-testid="mc-stamp"
          >
            Logbook:{' '}
            {a.mission.practice
              ? 'practice'
              : `done in ${log?.attempts ?? a.number} ${log?.attempts === 1 ? 'attempt' : 'attempts'}`}
            {log?.distress ? (
              <TokenIcon
                kind="distress-used"
                label={art.say('{Distress} used (+1)')}
                className="ml-1 inline-flex h-5 w-3.5 align-middle"
              />
            ) : null}
          </p>
          {a.mission.n === EPILOGUE && (
            <p className="text-sm">Next dive: difficulty {(a.mission.difficulty ?? 0) + 1}.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 text-center">
          <p className="text-3xl sm:text-5xl" aria-hidden>
            🫧
          </p>
          <h2 className="text-2xl font-black">Mission lost</h2>
          <p data-testid="mc-why">
            {r.timedOut ? (
              '⏱️ Time ran out.'
            ) : (
              <Rich text={r.why ?? 'A task could no longer be met.'} name={name} />
            )}
          </p>
          {failed && (
            <div className="text-left">
              <TaskChip task={failed} name={name} showOwner you={me} />
            </div>
          )}
          <p className="text-sm text-ink-muted">
            Attempt {a.number}
            {a.mission.practice ? ' (practice)' : ''}. Tricks played: {r.tricks}.
          </p>
        </div>
      )}
      {room.superlatives?.length ? <Superlatives lines={room.superlatives} /> : null}
      {decide && (
        <div className="grid gap-2 sm:grid-cols-2">
          {r.success ? (
            <Button
              size="lg"
              className="sm:col-span-2"
              onClick={() => send({ type: 'next' })}
              data-testid="mc-next"
            >
              {art.say('Next mission')}
            </Button>
          ) : (
            <>
              {!a.mission.cardTasks && (
                <Button
                  size="lg"
                  onClick={() => send({ type: 'retry', same: true })}
                  data-testid="mc-retry-same"
                >
                  🔁 Retry same tasks
                </Button>
              )}
              <Button
                size="lg"
                variant={a.mission.cardTasks ? 'primary' : 'secondary'}
                onClick={() => send({ type: 'retry', same: false })}
                data-testid="mc-retry-new"
              >
                {a.mission.cardTasks ? '🔁 Try again (new tasks)' : '🎲 New tasks'}
              </Button>
            </>
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={() => setReplay(!replay)} data-testid="mc-replay-open">
          {replay ? 'Hide the replay' : '🔍 Replay: every hand, trick by trick'}
        </Button>
        {room.isHost && (
          <Button variant="secondary" onClick={() => send({ type: 'lobby' })}>
            📘 Logbook and settings
          </Button>
        )}
      </div>
      {replay && a.replay && <Replay a={a} name={name} />}
      <RefusalSlot anchor={ANCHOR} />
    </Panel>
  );
}
