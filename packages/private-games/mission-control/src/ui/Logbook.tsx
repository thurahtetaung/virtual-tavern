import { cn } from '@vt/ui';
import type { Comms, Selection } from '../logic/content.ts';
import {
  type CampaignView,
  EPILOGUE,
  type MissionLog,
  type MissionSummary,
  type VoyageSummary,
} from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { missionLabel } from './status.ts';

const COMMS: Record<Comms, string | null> = {
  normal: null,
  currents: '🌀 Currents',
  rapture: '🫧 Shared tokens',
  terrain: '❓ Unfamiliar terrain',
  none: '🔇 No signals',
};
const SELECTION: Record<Selection, string | null> = {
  normal: null,
  free: '🗣️ Free choice',
  'all-to-one': '☝️ All to one',
  'crew-wanted': '🙋 Crew wanted',
  'captain-offers': '🎁 {Captain} offers',
  'captain-skips': '⏭️ {Captain} skips',
  'hardest-first': '🏋️ Hardest first',
};

/** A mission's rule symbols as short tags. */
export function MissionTags({
  comms,
  selection,
  timed,
  commsFrom,
  fixed,
  className,
}: {
  comms: Comms;
  selection: Selection;
  timed: boolean;
  commsFrom?: number | null;
  fixed?: boolean;
  className?: string;
}) {
  const { say } = useArt();
  const tags = [
    COMMS[comms],
    commsFrom ? `🔕 Signals from trick ${commsFrom}` : null,
    SELECTION[selection],
    timed ? '⏱️ Real time' : null,
    fixed ? '📌 Crew condition' : null,
  ].filter((t): t is string => !!t);
  if (!tags.length) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-full bg-panel px-2 py-0.5 text-xs ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700"
        >
          {say(t)}
        </span>
      ))}
    </span>
  );
}

/** How far down the crew is: a strip that fills as missions are done. */
export function DepthStrip({
  voyage,
  campaign,
}: {
  voyage: VoyageSummary;
  campaign: CampaignView | null;
}) {
  const done = voyage.missions.filter((m) => campaign?.log[m.n]?.done).length;
  const total = voyage.missions.length;
  const next = campaign?.next ?? voyage.missions[0]?.n ?? 1;
  return (
    <div className="space-y-1" data-testid="depth-strip">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">
          🤿 {next === EPILOGUE ? 'The epilogue' : `${missionLabel(next)} next`}
        </span>
        <span className="text-ink-muted tabular-nums">
          {done}/{total} missions done
        </span>
      </div>
      <div
        role="img"
        aria-label={`${done} of ${total} missions done`}
        className="flex h-3 gap-px overflow-hidden rounded-full bg-panel ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700"
      >
        {voyage.missions.map((m) => (
          <span
            key={m.n}
            className={cn(
              'h-full flex-1',
              campaign?.log[m.n]?.done
                ? 'bg-info dark:bg-sky-500'
                : m.n === next
                  ? 'bg-accent-line dark:bg-amber-600/70'
                  : '',
            )}
          />
        ))}
      </div>
    </div>
  );
}

const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function Attempts({ log }: { log: MissionLog | undefined }) {
  if (!log || (!log.attempts && !log.practice)) return <span className="text-ink-muted">–</span>;
  return (
    <span className="tabular-nums">
      {log.attempts > 0 && (
        <>
          {log.attempts}
          {log.distress && (
            <span role="img" aria-label="distress signal used" title="Distress signal used (+1)">
              {' '}
              🆘
            </span>
          )}
        </>
      )}
      {log.practice > 0 && <span className="text-ink-muted"> · {log.practice} practice</span>}
    </span>
  );
}

/** The logbook: every mission with its attempts; the host picks one to play. */
export function Logbook({
  voyage,
  campaign,
  chosen,
  onChoose,
}: {
  voyage: VoyageSummary;
  campaign: CampaignView | null;
  chosen: number | null;
  onChoose: ((n: number | null) => void) | null;
}) {
  const art = useArt();
  const next = campaign?.next ?? voyage.missions[0]!.n;
  const picked = chosen ?? next;
  const row = (m: MissionSummary) => {
    const log = campaign?.log[m.n];
    const title = art.logbook(m.n)?.title ?? m.title;
    const selected = picked === m.n;
    const body = (
      <>
        <span className="w-8 shrink-0 text-right font-bold tabular-nums">{m.n}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {log?.done ? '✅ ' : log?.practised ? '🎯 ' : ''}
            {title ?? missionLabel(m.n)}
          </span>
          <span className="block text-xs text-ink-muted">
            {m.difficulty !== null ? `Difficulty ${m.difficulty}` : 'No task cards'}
            {log?.done ? ` · ${day(log.done)} · ${log.crew.join(', ')}` : ''}
          </span>
          <MissionTags
            comms={m.comms}
            selection={m.selection}
            timed={m.timed}
            fixed={m.fixed}
            className="mt-0.5"
          />
        </span>
        <span className="shrink-0 text-sm">
          <Attempts log={log} />
        </span>
      </>
    );
    const classes = cn(
      'flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left',
      selected &&
        'bg-accent-soft ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/40',
    );
    return (
      <li key={m.n}>
        {onChoose ? (
          <button
            type="button"
            className={cn(classes, 'min-h-11 hover:bg-panel dark:hover:bg-stone-800')}
            aria-pressed={selected}
            onClick={() => onChoose(m.n === next ? null : m.n)}
            data-testid={`logbook-${m.n}`}
          >
            {body}
          </button>
        ) : (
          <div className={classes}>{body}</div>
        )}
      </li>
    );
  };
  const e = voyage.epilogue;
  return (
    <div className="space-y-3" data-testid="logbook">
      <DepthStrip voyage={voyage} campaign={campaign} />
      {picked !== next && (
        <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30">
          🎯 {missionLabel(picked)} is out of order: it plays as practice and doesn’t change the
          attempt counts.
        </p>
      )}
      <ol className="max-h-[50vh] space-y-0.5 overflow-y-auto pr-1">
        {voyage.missions.map(row)}
        {e && (
          <li>
            <button
              type="button"
              disabled={!onChoose}
              className={cn(
                'flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-2 text-left disabled:cursor-default',
                picked === EPILOGUE &&
                  'bg-accent-soft ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/40',
              )}
              onClick={() => onChoose?.(EPILOGUE === next ? null : EPILOGUE)}
              data-testid="logbook-epilogue"
            >
              <span className="w-8 shrink-0 text-right">♾️</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {art.logbook(EPILOGUE)?.title ?? e.title ?? 'Epilogue'}
                </span>
                <span className="block text-xs text-ink-muted">
                  Endless: difficulty {campaign?.epilogue.level ?? e.difficulty}, one more after
                  each success
                  {campaign?.epilogue.successes ? ` · ${campaign.epilogue.successes} done` : ''}
                  {campaign?.epilogue.distress ? ` · 🆘 ${campaign.epilogue.distress}` : ''}
                </span>
              </span>
            </button>
          </li>
        )}
      </ol>
      {campaign && (
        <p className="text-xs text-ink-muted">
          Logbook started {day(campaign.started)}
          {campaign.finished ? `, every mission done ${day(campaign.finished)}` : ''}. Crew:{' '}
          {Object.values(campaign.members).join(', ') || 'nobody yet'}.
        </p>
      )}
    </div>
  );
}
