import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Hint,
  PlayerTag,
  StickyBar,
  TimerSettings,
  WordListPicker,
  cn,
  LobbySettings,
  wordListsLine,
  timersLine,
} from '@vt/ui';
import type { EnigmaAction, EnigmaView, Flow, Team } from '../logic/types.ts';
import type { Status } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';

type Act = (a: EnigmaAction) => Promise<boolean>;

/** The team picker, where "Take a seat" leads watchers. */
export const TEAMS_ID = 'enigma-teams';

const FLOWS: { flow: Flow; title: string; help: string }[] = [
  {
    flow: 'simultaneous',
    title: 'Simultaneous',
    help: 'Both teams write clues at once, then both guess at once. Faster.',
  },
  {
    flow: 'alternating',
    title: 'Alternating',
    help: "One team's code is played through, then the other's. Classic pace.",
  },
];

export function PlayerName({
  view,
  id,
  online,
  hostId,
}: {
  view: EnigmaView;
  id: string;
  online: boolean;
  hostId?: string;
}) {
  const seat = view.seats.find((s) => s.id === id);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          online ? 'bg-success dark:bg-emerald-500' : 'bg-stone-400',
        )}
      />
      <PlayerTag
        name={seat?.name ?? '?'}
        host={id === hostId}
        you={id === view.me?.id}
        offline={!online}
      />
    </span>
  );
}

export function TeamsPicker({
  view,
  online,
  act,
  hostId,
}: {
  view: EnigmaView;
  online: (id: string) => boolean;
  act: Act;
  /** The room host, crowned in the lists. */
  hostId?: string;
}) {
  const playing = view.phase === 'playing';
  const myTeam = view.me?.team ?? null;
  const spectators = view.seats.filter((s) => s.team === null);
  return (
    <div id={TEAMS_ID} className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        {(['red', 'blue'] as Team[]).map((team) => {
          const members = view.seats.filter((s) => s.team === team);
          // Mid-game, someone who has seen a team's keywords may only rejoin that team.
          const canJoin =
            myTeam !== team && (!playing || (myTeam === null && (view.lockedTo ?? team) === team));
          return (
            <section
              key={team}
              aria-label={`${TEAM_LABEL[team]} team`}
              className={cn('rounded-2xl p-3 ring-1', TEAM_PANEL[team])}
            >
              <h3 className={cn('mb-2 text-lg font-bold', TEAM_TEXT[team])}>
                {TEAM_LABEL[team]} team
              </h3>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {members.map((s) => (
                  <li key={s.id}>
                    <PlayerName view={view} id={s.id} online={online(s.id)} hostId={hostId} />
                  </li>
                ))}
                {members.length === 0 && <li className="text-ink-muted italic">Nobody yet</li>}
              </ul>
              {canJoin && (
                <Button
                  size="sm"
                  variant={team}
                  className="mt-3"
                  onClick={() => void act({ type: 'join-team', team })}
                >
                  {playing && view.lockedTo === team ? 'Rejoin' : 'Join'} {TEAM_LABEL[team]}
                </Button>
              )}
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-semibold">Watching:</span>
        {spectators.map((s) => (
          <PlayerName key={s.id} view={view} id={s.id} online={online(s.id)} hostId={hostId} />
        ))}
        {spectators.length === 0 && <span className="italic">nobody</span>}
        {myTeam !== null && !playing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void act({ type: 'join-team', team: null })}
          >
            Sit out (watch)
          </Button>
        )}
      </div>
    </div>
  );
}

export function Lobby({
  view,
  room,
  act,
  status,
  blocker,
  online,
  showGuide,
}: {
  view: EnigmaView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  blocker: string | null;
  online: (id: string) => boolean;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  return (
    <div className="space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <TeamsPicker view={view} online={online} act={act} hostId={room.hostId} />
      <LobbySettings
        editable={editable}
        summary={[
          FLOWS.find((f) => f.flow === view.settings.flow)!.title,
          wordListsLine(view.settings.wordListIds, room.wordLists),
          timersLine(view.settings),
        ]}
        className="space-y-4"
      >
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <WordListPicker
          selectedIds={view.settings.wordListIds}
          wordLists={room.wordLists}
          editable={editable}
          onSave={(ids) => act({ type: 'update-settings', wordListIds: ids })}
          summary={(chosen, total) =>
            `Each team gets 4 secret keywords from ${chosen.length === 1 ? 'this list' : 'these lists'} (${total} words).`
          }
        />
        <fieldset>
          <legend className="text-sm font-semibold">Turn order</legend>
          {editable ? (
            <div className="mt-1 grid grid-cols-2 gap-2">
              {FLOWS.map((f) => (
                <button
                  key={f.flow}
                  type="button"
                  aria-pressed={view.settings.flow === f.flow}
                  onClick={() => void act({ type: 'update-settings', flow: f.flow })}
                  className={cn(
                    'rounded-lg px-3 py-2 text-left ring-1 transition',
                    view.settings.flow === f.flow
                      ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                      : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                  )}
                >
                  <span className="block font-semibold">{f.title}</span>
                  {/* On phones only the chosen option explains itself, to save space. */}
                  <span
                    className={cn(
                      'text-xs text-ink-muted',
                      view.settings.flow === f.flow ? 'block' : 'hidden sm:block',
                    )}
                  >
                    {f.help}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm">{FLOWS.find((f) => f.flow === view.settings.flow)!.title}</p>
          )}
        </fieldset>
        <TimerSettings
          values={view.settings}
          editable={editable}
          onChange={(patch) => void act({ type: 'update-settings', ...patch })}
          clueHelp="Time for each Encryptor to write 3 clues."
          guessHelp="Time for teams to agree on their guesses."
          strictHelp="missing clues or guesses count as failed"
        />
        <p className="-mt-2 text-xs text-ink-muted">
          Tip: three careful clues take a while. Give Encryptors 2–3 minutes; under 1 minute is very
          tight, especially with Strict timers.
        </p>
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' })}
              >
                Start game
              </Button>
              <Button variant="secondary" onClick={() => void act({ type: 'randomize-teams' })}>
                🎲 Shuffle teams
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
          </StickyBar>
        )}
      </LobbySettings>
      <p className="text-center text-sm text-ink-muted">
        New to Enigma?{' '}
        <button
          type="button"
          className="font-semibold text-amber-700 underline dark:text-amber-400"
          onClick={showGuide}
        >
          Read the guide
        </button>
      </p>
    </div>
  );
}
