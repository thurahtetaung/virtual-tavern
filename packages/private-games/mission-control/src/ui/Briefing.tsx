import { Fragment } from 'react';
import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, PlayerTag, ProtectedImage, cn } from '@vt/ui';
import { type AttemptView, DUMMY, EPILOGUE, type MissionPlay } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { MissionTags } from './Logbook.tsx';
import { missionLabel } from './status.ts';
import { paragraphsOf } from './text.ts';
import { tokenLabel } from '../logic/onecard.ts';

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
    <div className="space-y-2 rounded-xl bg-info-soft p-3 text-info-ink ring-1 ring-info-line">
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
        fixed={m.difficulty === null && !(m.cardTasks && m.rules.cards)}
      />
      <p className="text-sm">
        {m.cardTasks && m.rules.cards
          ? `${m.rules.cards} one-card ${m.rules.cards === 1 ? 'task' : 'tasks'}${m.rules.tokens?.length ? `, tokens ${m.rules.tokens.map(tokenLabel).join(' ')}` : ''}.`
          : m.difficulty !== null
            ? `Tasks drawn to difficulty ${m.difficulty}.`
            : 'No task cards: the mission’s own conditions decide.'}
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
  const { box } = useArt();
  const panel = (
    <Panel className={cn('space-y-4', !box && 'mx-auto max-w-2xl')} data-testid="mc-briefing">
      {/* Phones: the clock drops under the title, so the title keeps the width. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Phones: the voyage's box art beside the title, 128 px wide (wide screens show it large beside the panel). */}
        {box && (
          <ProtectedImage
            src={box}
            alt=""
            className="w-32 shrink-0 rounded-lg shadow-vt-2 ring-1 ring-line lg:hidden"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-muted">
            📜 Briefing{m.practice ? ' · practice' : ''}
            {m.n === EPILOGUE ? ` · difficulty ${m.difficulty}` : ''}
          </p>
          <h2 className="font-display text-2xl font-bold lg:text-4xl">
            {missionLabel(m.n, m.label)}
            {text.title ? `: ${text.title}` : ''}
          </h2>
        </div>
        <div className="max-lg:w-full">
          <Countdown
            deadline={a.deadline}
            clockOffset={room.clockOffset}
            label="to read"
            atZero="then the cards are dealt"
          />
        </div>
      </div>
      {text.story && (
        <details open className="group">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">
            Logbook entry
          </summary>
          <div
            className="space-y-2 font-display text-base leading-relaxed lg:text-xl"
            data-testid="mc-story"
          >
            {paragraphsOf(text.story).map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                <Printed text={p} />
              </p>
            ))}
          </div>
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
  if (!box) return panel;
  // Wide screens: the voyage's box art stands beside the briefing, so the moment that sets the
  // mission opens like the lid of the game rather than a lone card in an empty page.
  return (
    <div className="mx-auto grid max-w-6xl items-center gap-8 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <ProtectedImage
        src={box}
        alt=""
        className="hidden w-full rounded-xl shadow-vt-2 ring-1 ring-line lg:block"
      />
      {panel}
    </div>
  );
}
