import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  type Choice,
  ChoicePicker,
  Hint,
  LobbySettings,
  Panel,
  StickyBar,
  Switch,
  TimerSettings,
  cn,
} from '@vt/ui';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import { type StampedeAction, type StampedeView, TARGETS } from '../logic/types.ts';
import type { Status } from './status.ts';
import { Table } from './Scores.tsx';

type Act = (a: StampedeAction) => Promise<boolean>;

const decksSummary = (chosen: Choice[], total: number) =>
  chosen.length === 0
    ? 'Pick the decks the questions come from.'
    : `Each round asks a question from ${chosen.length === 1 ? 'this deck' : 'these decks'} (${total} questions).`;

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** One line for the folded timer setting. */
export function timerSummary(s: StampedeView['settings']): string {
  if (s.answerSeconds === null) return 'no time limit';
  return `${seconds(s.answerSeconds)} to answer, ${s.timerMode === 'strict' ? 'strict' : 'reminder only'}`;
}

/** The guests' summary: the target, the decks, then the house rules and the timer. */
export function settingsSummary(
  view: Pick<StampedeView, 'decks' | 'settings'>,
  names: Names,
): string[] {
  const s = view.settings;
  const chosen = view.decks.filter((d) => s.deckIds.includes(d.id)).map((d) => d.name);
  return [
    `first to ${cowCount(names, s.target)}`,
    chosen.length > 1 ? `${chosen.length} decks` : (chosen[0] ?? 'no deck'),
    ...(s.holderPicks ? ['holder picks'] : []),
    ...(s.sharedWin ? ['shared win'] : []),
    ...(s.skip ? [] : ['no skips']),
    timerSummary(s),
  ];
}

export function Lobby({
  view,
  room,
  act,
  status,
  blocker,
  online,
  showGuide,
  names,
  title,
}: {
  view: StampedeView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  blocker: string | null;
  online: (id: string) => boolean;
  showGuide: () => void;
  names: Names;
  title: string;
}) {
  const editable = room.isHost;
  const s = view.settings;
  const f = (t: string) => fillNames(t, names);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Table view={view} online={online} act={act} hostId={room.hostId} names={names} />
      </Panel>
      <LobbySettings
        editable={editable}
        summary={settingsSummary(view, names)}
        className="space-y-4"
      >
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <ChoicePicker
          selectedIds={s.deckIds}
          editable={editable}
          onSave={(ids) => act({ type: 'update-settings', deckIds: ids })}
          choices={view.decks.map((d) => ({
            id: d.id,
            name: d.adult ? `${d.name} (18+)` : d.name,
            description: d.description,
            count: d.questionCount,
          }))}
          labels={{
            title: 'Question decks',
            unit: 'questions',
            noun: 'deck',
            change: 'Change decks',
            summary: decksSummary,
          }}
        />
        <fieldset>
          <legend className="text-sm font-semibold">{f('{Cows} to win')}</legend>
          {editable ? (
            <div className="mt-1 grid grid-cols-3 gap-2">
              {TARGETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={s.target === n}
                  onClick={() => void act({ type: 'update-settings', target: n })}
                  className={cn(
                    'h-11 rounded-lg font-semibold ring-1 transition',
                    s.target === n
                      ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                      : 'ring-line hover:bg-card dark:ring-stone-700 dark:hover:bg-stone-800',
                  )}
                >
                  🐄 {n}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm">First to {cowCount(names, s.target)}</p>
          )}
        </fieldset>
        {/* Folded away so the Start button stays on a phone's first screen. */}
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-semibold">Timer and house rules</span>
              <span className="text-ink-muted"> · {timerSummary(s)}</span>
            </span>
            <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <div className="space-y-3 pt-2">
            <TimerSettings
              values={{ clueSeconds: s.answerSeconds, guessSeconds: null, timerMode: s.timerMode }}
              editable={editable}
              onChange={(patch) =>
                void act({
                  type: 'update-settings',
                  ...(patch.clueSeconds !== undefined && { answerSeconds: patch.clueSeconds }),
                  ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
                })
              }
              clueLabel="Answer timer"
              clueHelp="Time for everyone to write an answer."
              strictHelp="the answers lock and anyone still writing has no answer that round"
            />
            <Switch
              on={s.skip}
              editable={editable}
              title="Skip a question"
              help="The host may swap the question once a round."
              onChange={(v) => void act({ type: 'update-settings', skip: v })}
              testId="setting-skip"
            />
            <Switch
              on={s.holderPicks}
              editable={editable}
              title="Holder picks"
              help={f('With several answers alone, the {pink}’s holder picks who takes it.')}
              tag="house rule"
              tagTone="special"
              onChange={(v) => void act({ type: 'update-settings', holderPicks: v })}
              testId="setting-holder-picks"
            />
            <Switch
              on={s.sharedWin}
              editable={editable}
              title="Shared win"
              help="Players tied on top at the target share the win, instead of raising it."
              tag="house rule"
              tagTone="special"
              onChange={(v) => void act({ type: 'update-settings', sharedWin: v })}
              testId="setting-shared-win"
            />
          </div>
        </details>
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' })}
              >
                Start game
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
          </StickyBar>
        )}
      </LobbySettings>
      <Button variant="secondary" size="lg" className="w-full" onClick={showGuide}>
        📖 New to {title}? Read the guide
      </Button>
    </div>
  );
}
