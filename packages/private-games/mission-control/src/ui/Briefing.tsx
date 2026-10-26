import { Fragment } from 'react';
import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, PlayerTag } from '@vt/ui';
import { type AttemptView, DUMMY, EPILOGUE, type MissionPlay } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { MissionTags } from './Logbook.tsx';
import { missionLabel } from './status.ts';

/** Logbook text as printed: `**bold**` and `*italic*` only. */
export function Printed({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
        .map((part, i) =>
          part.startsWith('**') ? (
            <strong key={i}>{part.slice(2, -2)}</strong>
          ) : part.startsWith('*') && part.length > 2 ? (
            <em key={i}>{part.slice(1, -1)}</em>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  );
}

/** A mission's title, story and rule: the pack's text, else the manifest's logbook entry. */
export function useMissionText(m: MissionPlay) {
  const art = useArt();
  const entry = art.logbook(m.n);
  return {
    title: m.title ?? entry?.title ?? null,
    story: m.story ?? entry?.text ?? null,
    rule: m.rule ?? entry?.rule ?? null,
  };
}

/** The rule box: the mission's rule, the signals and selection, the clock and the difficulty. */
export function RuleBox({ a }: { a: AttemptView }) {
  const art = useArt();
  const m = a.mission;
  const text = useMissionText(m);
  return (
    <div className="space-y-2 rounded-xl bg-info-soft p-3 text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      {text.rule && (
        <p className="font-semibold">
          <Printed text={art.say(text.rule)} />
        </p>
      )}
      <MissionTags
        comms={m.comms}
        selection={m.selection}
        timed={m.seconds !== null}
        commsFrom={m.commsFrom}
        fixed={m.difficulty === null}
      />
      <p className="text-sm">
        {m.difficulty !== null
          ? `Tasks drawn to difficulty ${m.difficulty}.`
          : 'No task cards: the crew condition below decides.'}
        {m.seconds !== null &&
          ` A ${Math.floor(m.seconds / 60)}:${String(m.seconds % 60).padStart(2, '0')} clock starts once the tasks are shared.`}
      </p>
      {m.fresh && <p className="text-sm">✨ New: {art.say(m.fresh)}</p>}
    </div>
  );
}

export function Briefing({
  a,
  room,
  me,
  onReady,
  name,
}: {
  a: AttemptView;
  room: GameRoomInfo;
  me: string;
  onReady: () => void;
  name: (id: string) => string;
}) {
  const m = a.mission;
  const text = useMissionText(m);
  const people = a.crew.filter((c) => c.id !== DUMMY);
  const inCrew = people.some((p) => p.id === me);
  return (
    <Panel className="mx-auto max-w-2xl space-y-4" data-testid="mc-briefing">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-ink-muted">
            📜 Briefing{m.practice ? ' · practice' : ''}
            {m.n === EPILOGUE ? ` · difficulty ${m.difficulty}` : ''}
          </p>
          <h2 className="text-2xl font-black">
            {missionLabel(m.n)}
            {text.title ? `: ${text.title}` : ''}
          </h2>
        </div>
        <Countdown
          deadline={a.deadline}
          clockOffset={room.clockOffset}
          label="to read"
          atZero="then the cards are dealt"
        />
      </div>
      {text.story && (
        <details open className="group">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
            Logbook entry
          </summary>
          <p className="whitespace-pre-line text-sm leading-relaxed">
            <Printed text={text.story} />
          </p>
        </details>
      )}
      <RuleBox a={a} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-1">
            <span aria-hidden>{a.ready.includes(p.id) ? '✅' : '⏳'}</span>
            <PlayerTag name={name(p.id)} you={p.id === me} />
          </li>
        ))}
      </ul>
      {inCrew && (
        <Button
          size="lg"
          className="w-full"
          disabled={a.ready.includes(me)}
          onClick={onReady}
          data-testid="mc-ready"
        >
          {a.ready.includes(me) ? 'Ready ✓' : 'Ready to dive'}
        </Button>
      )}
    </Panel>
  );
}
