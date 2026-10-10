import type { GameUiProps } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel, cn } from '@vt/ui';
import { useState } from 'react';
import type { CodenamesAction, CodenamesView } from '../logic/types.ts';
import { Board } from './Board.tsx';
import { ClueForm } from './ClueForm.tsx';
import { GameLog } from './GameLog.tsx';
import { Settings } from './Settings.tsx';
import { startBlocker, statusFor } from './status.ts';
import { TEAM_LABEL, TEAM_TEXT } from './theme.ts';
import { Teams } from './Teams.tsx';

export type CodenamesUiProps = GameUiProps<CodenamesView, CodenamesAction>;

export function CodenamesGame({ view, room, act, showGuide }: CodenamesUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker);

  if (view.phase === 'lobby') {
    return (
      <div className="space-y-4">
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        <Teams view={view} online={online} act={act} />
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
            </div>
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

  const reveal = async () => {
    if (selected === null) return;
    const card = selected;
    setSelected(null);
    await act({ type: 'guess', card });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <div className={cn('min-w-0 space-y-3', canGuess && 'pb-4')}>
        <ScoreBar view={view} clockOffset={room.clockOffset} />
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>

        {turn?.clue && (
          <p className="text-center text-lg">
            <span className="text-stone-500">Clue: </span>
            <b className={cn('text-2xl tracking-wide uppercase', TEAM_TEXT[turn.team])}>
              {turn.clue.word}
            </b>
            <span className="text-stone-500"> · </span>
            <b className="text-2xl">{turn.clue.count ?? '∞'}</b>
          </p>
        )}

        <Board view={view} selected={selected} onPick={canGuess ? pick : null} />

        {canClue && (
          <Panel>
            <ClueForm act={act} />
          </Panel>
        )}

        {canGuess && (
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-white/90 p-2 shadow-lg ring-1 ring-stone-200 backdrop-blur dark:bg-stone-900/90 dark:ring-stone-700">
            <Button size="lg" disabled={selected === null} onClick={() => void reveal()}>
              {selected === null
                ? 'Tap a card first'
                : `Reveal ${view.board[selected]?.word.toUpperCase()}`}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => void act({ type: 'end-turn' })}>
              End turn
            </Button>
          </div>
        )}

        {view.phase === 'over' && (
          <Panel className="space-y-3 text-center">
            <p className={cn('text-2xl font-bold', TEAM_TEXT[view.winner!])}>
              🏆 {TEAM_LABEL[view.winner!]} team wins!
            </p>
            <p className="text-sm text-stone-500">The full key is shown on the board.</p>
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
              <p>Waiting for the host to start the next game…</p>
            )}
          </Panel>
        )}
      </div>

      <aside className="space-y-4">
        <Panel>
          <h3 className="mb-2 font-bold">Game log</h3>
          <GameLog view={view} />
        </Panel>
        <Panel>
          <h3 className="mb-2 font-bold">Teams</h3>
          <Teams view={view} online={online} act={act} compact />
        </Panel>
        {room.isHost && view.phase === 'playing' && (
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
        )}
      </aside>
    </div>
  );
}

function ScoreBar({ view, clockOffset }: { view: CodenamesView; clockOffset: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      {(['red', 'blue'] as const).map((team, i) => (
        <div
          key={team}
          className={cn(
            'flex items-baseline gap-2 rounded-xl px-3 py-1.5',
            i === 1 && 'order-3',
            view.turn?.team === team && 'bg-white shadow-sm ring-2 ring-current dark:bg-stone-900',
            TEAM_TEXT[team],
          )}
        >
          <span className="text-2xl font-black tabular-nums">{view.remaining[team]}</span>
          <span className="text-sm font-semibold">{TEAM_LABEL[team]} left</span>
        </div>
      ))}
      <div className="order-2">
        <Countdown deadline={view.turn?.deadline ?? null} clockOffset={clockOffset} />
      </div>
    </div>
  );
}
