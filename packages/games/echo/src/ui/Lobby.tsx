import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Hint,
  Panel,
  StickyBar,
  TimerSettings,
  WordListPicker,
  cn,
  LobbySettings,
  wordListsLine,
} from '@vt/ui';
import { DECK_SIZES, type DeckSize, type EchoAction, type EchoView } from '../logic/types.ts';
import type { Status } from './status.ts';
import { Table } from './Table.tsx';

type Act = (a: EchoAction) => Promise<boolean>;

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** One line for the folded timer settings, e.g. "clues 1 min, guesses 90 s, strict". */
function timerSummary(s: EchoView['settings']): string {
  if (s.clueSeconds === null && s.guessSeconds === null) return 'no time limits';
  const parts = [
    s.clueSeconds !== null && `clues ${seconds(s.clueSeconds)}`,
    s.guessSeconds !== null && `guesses ${seconds(s.guessSeconds)}`,
    s.timerMode === 'strict' ? 'strict' : 'reminder only',
  ];
  return parts.filter(Boolean).join(', ');
}

/** How long a deck plays, under each deck-length button. */
const DECK_PACE: Record<DeckSize, string> = { 8: 'quick', 13: 'standard', 20: 'long' };

/** The guests' one line: "13 cards · Starter words · no time limits". */
function settingsSummary(view: EchoView, room: GameRoomInfo): string[] {
  return [
    `${view.settings.deckSize} cards`,
    wordListsLine(view.settings.wordListIds, room.wordLists),
    timerSummary(view.settings),
  ];
}

const cardsSummary = (chosen: unknown[], total: number) =>
  `Cards draw 5 words each from ${chosen.length === 1 ? 'this list' : 'these lists'} (${total} words).`;

export function Lobby({
  view,
  room,
  act,
  status,
  blocker,
  online,
  showGuide,
}: {
  view: EchoView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  blocker: string | null;
  online: (id: string) => boolean;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Panel>
        <Table view={view} online={online} act={act} hostId={room.hostId} />
      </Panel>
      <LobbySettings
        editable={editable}
        summary={settingsSummary(view, room)}
        className="space-y-4"
      >
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <WordListPicker
          selectedIds={view.settings.wordListIds}
          wordLists={room.wordLists}
          editable={editable}
          summary={cardsSummary}
          onSave={(ids) => act({ type: 'update-settings', wordListIds: ids })}
        />
        <fieldset>
          <legend className="text-sm font-semibold">Deck length</legend>
          {editable ? (
            <div className="mt-1 grid grid-cols-3 gap-2">
              {DECK_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={view.settings.deckSize === size}
                  onClick={() => void act({ type: 'update-settings', deckSize: size })}
                  className={cn(
                    'flex min-h-11 flex-col items-center justify-center rounded-lg py-1 font-semibold ring-1 transition',
                    view.settings.deckSize === size
                      ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                      : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                  )}
                >
                  {size} cards
                  <span className="text-xs font-normal text-ink-muted">{DECK_PACE[size]}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm">{view.settings.deckSize} cards</p>
          )}
        </fieldset>
        {/* Folded away so the Start button stays on a phone's first screen. */}
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-semibold">Timers</span>
              <span className="text-ink-muted"> · {timerSummary(view.settings)}</span>
            </span>
            <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <div className="pt-2">
            <TimerSettings
              values={view.settings}
              editable={editable}
              onChange={(patch) => void act({ type: 'update-settings', ...patch })}
              clueHelp="Time for everyone to write their clues."
              guessHelp="Time to pick a word and to guess."
              strictHelp="the guesser gets a random word, late clues are skipped, and an unanswered guess passes"
            />
          </div>
        </details>
      </LobbySettings>
      {editable && (
        <StickyBar>
          <div className="flex flex-wrap items-center gap-2">
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
      <Button variant="secondary" className="h-11 w-full" onClick={showGuide}>
        New to Echo? Read the guide
      </Button>
    </div>
  );
}
