import { type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  StickyBar,
  Superlatives,
  cn,
  revealElement,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useState } from 'react';
import type { CodenamesAction, CodenamesView } from '../logic/types.ts';
import { Board } from './Board.tsx';
import { ClueForm } from './ClueForm.tsx';
import { GameLog } from './GameLog.tsx';
import { latestResult } from './result.ts';
import { ResultBanner } from './ResultBanner.tsx';
import { Settings } from './Settings.tsx';
import { myRoleLabel, spymasterAlerts, startBlocker, statusFor, winHow } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';
import { Teams } from './Teams.tsx';

export type CodenamesUiProps = GameUiProps<CodenamesView, CodenamesAction>;

/** The seat controls a "Take a seat" link leads to. */
const TEAMS_ID = 'codenames-teams';

export function CodenamesGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: CodenamesUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);

  // Mid-game watchers are told so at the top of the room, with a link to the join buttons
  // (the lobby's own hint already says "Pick a team below").
  useSpectatorPrompt(
    setSpectator,
    view.phase !== 'lobby' && view.me?.team == null
      ? {
          text: 'Join a team below to play.',
          actionLabel: 'Take a seat',
          action: () => revealElement(TEAMS_ID),
        }
      : null,
  );

  // Mark the tab when it's your turn in play (picking seats in the lobby doesn't count).
  const tabAlert = view.phase !== 'lobby' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby') {
    return (
      <div className="space-y-4">
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        <Teams view={view} online={online} act={act} hostId={room.hostId} />
        <p className="text-center text-sm">
          <b className={TEAM_TEXT[view.startingTeam]}>{TEAM_LABEL[view.startingTeam]}</b> goes first
          this game and has 9 agents to find; the other team has 8.
        </p>
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Game settings</h3>
            {!room.isHost && (
              <span className="text-sm text-stone-500">Only the host can change these.</span>
            )}
          </div>
          <Settings
            settings={view.settings}
            wordLists={room.wordLists}
            editable={room.isHost}
            act={act}
          />
          {room.isHost && (
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
                {blocker && <span className="text-sm text-stone-500">{blocker}</span>}
                <span className="basis-full text-xs text-stone-500">
                  Shuffling keeps anyone who chose to be a Spymaster.
                </span>
              </div>
            </StickyBar>
          )}
        </Panel>
        <p className="text-center text-sm text-stone-500">
          First time playing?{' '}
          <button
            type="button"
            className="font-semibold text-amber-700 underline dark:text-amber-400"
            onClick={showGuide}
          >
            Read the 2-minute guide
          </button>
        </p>
      </div>
    );
  }

  return (
    <InGame
      view={view}
      room={room}
      act={act}
      showGuide={showGuide}
      online={online}
      status={status}
    />
  );
}

function InGame({
  view,
  room,
  act,
  online,
  status,
}: CodenamesUiProps & { online: (id: string) => boolean; status: ReturnType<typeof statusFor> }) {
  const turn = view.turn;
  // The picked card only counts for the moment it was picked in: any new turn, stage or reveal clears it.
  const moment = `${turn?.team}-${turn?.stage}-${view.log.length}`;
  const [pickState, setPickState] = useState<{ moment: string; index: number } | null>(null);
  const selected = pickState?.moment === moment ? pickState.index : null;
  const setSelected = (index: number | null) =>
    setPickState(index === null ? null : { moment, index });
  const me = view.me;
  const myTurn = turn !== null && me?.team === turn.team;
  const canGuess = myTurn && me?.role === 'operative' && turn.stage === 'guess';
  const canClue = myTurn && me?.role === 'spymaster' && turn.stage === 'clue';
  // The engine insists on at least one guess before a pass.
  const canPass = canGuess && turn.guessesMade > 0;

  // First tap marks the card for teammates and selects it; tapping it again unmarks it.
  const pick = (i: number) => {
    const mine = me !== null && view.board[i]!.suggestedBy.includes(me.id);
    if (selected === i) {
      if (mine) void act({ type: 'toggle-suggestion', card: i });
      setSelected(null);
    } else {
      if (!mine) void act({ type: 'toggle-suggestion', card: i });
      setSelected(i);
    }
  };

  const result = latestResult(view);
  // The banner also says when the timer, a forfeit or the host ended a turn.

  const guess = async () => {
    if (selected === null) return;
    const card = selected;
    setSelected(null);
    await act({ type: 'guess', card, seen: view.log.length });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className={cn('min-w-0 space-y-3', canGuess && 'pb-4')}>
        <ScoreBar view={view} clockOffset={room.clockOffset} />
        {result && <ResultBanner key={view.log.length} result={result} />}
        {spymasterAlerts(view).map((alert) => (
          <div
            key={alert.team}
            role="alert"
            data-testid="no-spymaster"
            className={cn(
              'flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-center text-sm ring-2 sm:text-base',
              alert.mine || alert.canTake
                ? 'bg-amber-100 font-semibold text-amber-950 ring-amber-400 dark:bg-amber-500/15 dark:text-amber-100'
                : 'bg-stone-100 text-stone-700 ring-stone-300 dark:bg-stone-800/70 dark:text-stone-300 dark:ring-stone-600',
            )}
          >
            <span>⚠️ {alert.text}</span>
            {alert.canTake && (
              <Button
                size="sm"
                variant={alert.team}
                onClick={() => void act({ type: 'join-team', team: alert.team, role: 'spymaster' })}
              >
                Be the {TEAM_LABEL[alert.team]} Spymaster
              </Button>
            )}
          </div>
        ))}
        {/* Once the game is over, the result panel says who won (once). */}
        {view.phase !== 'over' && (
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        )}
        {status.stalled && room.isHost && turn && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => void act({ type: 'end-turn' })}>
              Skip {TEAM_LABEL[turn.team]}'s turn
            </Button>
          </div>
        )}

        {turn?.clue && (
          <p className="text-center text-lg">
            <span className="text-stone-500">Clue: </span>
            <b className={cn('text-2xl tracking-wide uppercase', TEAM_TEXT[turn.team])}>
              {turn.clue.word}
            </b>
            <span className="text-stone-500"> · </span>
            <b className="text-2xl">{turn.clue.count}</b>
          </p>
        )}

        {/* Above the board, so the result and Play again need no scroll past the key. */}
        {view.phase === 'over' && (
          <Panel className="space-y-3 text-center">
            <p className={cn('text-2xl font-bold', TEAM_TEXT[view.winner!])}>
              🏆 {TEAM_LABEL[view.winner!]} team wins!
            </p>
            <p>{winHow(view)}.</p>
            {me?.team && (
              <p className="font-semibold">
                {me.team === view.winner ? 'Your team won!' : 'Your team lost this time.'}
              </p>
            )}
            <p className="text-sm text-stone-500">The full key is shown on the board below.</p>
            <Superlatives lines={room.superlatives} />
            {room.isHost ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={() => void act({ type: 'start' })}>
                  Play again (same teams)
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void act({ type: 'back-to-lobby' })}
                >
                  Change teams or settings
                </Button>
              </div>
            ) : (
              <p>{waitingForHost(room, 'start the next game')}</p>
            )}
          </Panel>
        )}
        <Board
          view={view}
          selected={selected}
          lastGuessed={result?.card ?? null}
          onPick={canGuess ? pick : null}
        />

        {canClue && (
          <Panel>
            <ClueForm act={act} max={view.remaining[turn.team]} />
          </Panel>
        )}

        {canGuess && (
          // Sticky on phones, where the board scrolls; on desktop the board fits and the bar sits below it.
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-white/90 p-2 shadow-lg ring-1 ring-stone-200 backdrop-blur lg:static dark:bg-stone-900/90 dark:ring-stone-700">
            <Button size="lg" disabled={selected === null} onClick={() => void guess()}>
              {selected === null
                ? 'Pick a card to guess'
                : `Guess ${view.board[selected]?.word.toUpperCase()}`}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={!canPass}
              title={canPass ? undefined : 'Guess at least once first'}
              onClick={() => void act({ type: 'end-turn' })}
            >
              End turn
            </Button>
            <span className="basis-full text-center text-xs text-stone-500">
              {canPass
                ? 'A guess flips the card for your whole team.'
                : 'A guess flips the card for your whole team. Guess at least once first.'}
            </span>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <Panel>
          <h3 className="mb-2 font-bold">Game log</h3>
          <GameLog view={view} />
        </Panel>
        <TeamsSection view={view} online={online} act={act} hostId={room.hostId} />
        {room.isHost && view.phase === 'playing' && (
          <div className="space-y-1">
            {/* Not on your own team's guessing turn: there, End turn follows the normal rule. */}
            {!canGuess && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  if (
                    window.confirm(
                      'Skip the current turn for everyone? Use this if nobody can play it.',
                    )
                  ) {
                    void act({ type: 'end-turn' });
                  }
                }}
              >
                Skip stuck turn
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                if (window.confirm('End this game for everyone and go back to the lobby?')) {
                  void act({ type: 'back-to-lobby' });
                }
              }}
            >
              Abandon game
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}

function ScoreBar({ view, clockOffset }: { view: CodenamesView; clockOffset: number }) {
  const myTeam = view.me?.team ?? null;
  const role = myRoleLabel(view);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        {(['red', 'blue'] as const).map((team, i) => (
          <div
            key={team}
            className={cn(
              'flex items-baseline gap-2 rounded-xl px-3 py-1.5',
              i === 1 && 'order-3',
              view.turn?.team === team &&
                'bg-white shadow-sm ring-2 ring-current dark:bg-stone-900',
              TEAM_TEXT[team],
            )}
          >
            <span className="text-2xl font-black tabular-nums">{view.remaining[team]}</span>
            <span className="text-sm font-semibold">
              {TEAM_LABEL[team]}
              {myTeam === team && ' (you)'} to find
            </span>
          </div>
        ))}
        <div className="order-2">
          <Countdown
            deadline={view.turn?.deadline ?? null}
            clockOffset={clockOffset}
            label={view.turn?.stage === 'clue' ? 'to give a clue' : 'to guess'}
            soft={view.settings.timerMode !== 'strict'}
            atZero="then the turn ends"
            expiredHint="The turn goes on until the team finishes."
          />
        </div>
      </div>
      {role && myTeam && (
        <p className="text-center text-sm">
          <span
            data-testid="my-role"
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-3 py-0.5 font-semibold ring-1',
              TEAM_PANEL[myTeam],
              TEAM_TEXT[myTeam],
            )}
          >
            You: {role}
          </span>
        </p>
      )}
    </div>
  );
}

/** Teams beside the board: collapsed by default on phones, where the board needs the room. */
function TeamsSection(props: {
  view: CodenamesView;
  online: (id: string) => boolean;
  act: CodenamesUiProps['act'];
  hostId: string;
}) {
  const { view } = props;
  // Spectators need the join buttons, so the section starts open for them on every screen.
  const [open, setOpen] = useState(
    () => view.me?.team == null || window.matchMedia('(min-width: 1024px)').matches,
  );
  const count = (team: 'red' | 'blue') => view.seats.filter((s) => s.team === team).length;
  const watching = view.seats.filter((s) => s.team === null).length;
  return (
    <Panel>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <h3 className="font-bold">Teams</h3>
          <span className="flex items-center gap-2 text-sm text-stone-500">
            <span className={TEAM_TEXT.red}>Red {count('red')}</span>·
            <span className={TEAM_TEXT.blue}>Blue {count('blue')}</span>
            {watching > 0 && <span>· {watching} watching</span>}
            <span aria-hidden className="transition-transform group-open:rotate-180">
              ▾
            </span>
          </span>
        </summary>
        <div id={TEAMS_ID} className="mt-3">
          <Teams {...props} compact />
        </div>
      </details>
    </Panel>
  );
}
