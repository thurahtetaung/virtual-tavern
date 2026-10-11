import { type GameUiProps, waitingForHost } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel, cn, revealElement, useSpectatorPrompt } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import type { EnigmaAction, EnigmaView, Team } from '../logic/types.ts';
import { TeamChat } from './Chat.tsx';
import { Lobby, TEAMS_ID, TeamsPicker } from './Lobby.tsx';
import { OpponentSheet, OwnSheet } from './Sheets.tsx';
import { startBlocker, statusFor } from './status.ts';
import { TEAM_LABEL, TEAM_TEXT } from './theme.ts';
import { TransmissionCard } from './Transmission.tsx';

export type EnigmaUiProps = GameUiProps<EnigmaView, EnigmaAction>;

const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

/** One token type as "icon n/2": the count reads in any colour scheme, and the image role names it. */
function Tokens({ count, icon, label }: { count: number; icon: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={`${count} of 2 ${label}`}
      title={label}
      className="inline-flex items-center gap-0.5 text-sm sm:text-base"
    >
      <span aria-hidden>{icon}</span>
      <span aria-hidden className="font-bold tabular-nums">
        {count}/2
      </span>
    </span>
  );
}

/** One line on every screen: each team's tokens and the round, with the timer underneath. */
function Scoreboard({ view, clockOffset }: { view: EnigmaView; clockOffset: number }) {
  const side = (team: Team) => (
    <div className={cn('flex items-center gap-1 sm:gap-2', TEAM_TEXT[team])}>
      <span className="text-sm font-bold sm:text-base">{TEAM_LABEL[team]}</span>
      <Tokens count={view.teams[team].intercepts} icon="🕵️" label="interceptions (2 wins)" />
      <Tokens count={view.teams[team].misses} icon="💥" label="miscommunications (2 loses)" />
    </div>
  );
  const strict = view.settings.timerMode === 'strict';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        {side('red')}
        <span className="text-xs font-semibold text-stone-500 sm:text-sm">
          R{view.round}/{view.maxRounds}
        </span>
        {side('blue')}
      </div>
      {/* Its own row, so a label or "Time's up" never squeezes the scores. */}
      <div className="flex justify-center empty:hidden">
        <Countdown
          deadline={view.phase === 'playing' && view.stage !== 'reveal' ? view.deadline : null}
          clockOffset={clockOffset}
          label={view.stage === 'clue' ? 'to write clues' : 'to lock in codes'}
          soft={!strict}
          atZero={
            view.stage === 'clue'
              ? 'then missing clues count as a miss'
              : 'then teams that haven’t agreed miss'
          }
          expiredHint="No penalty: finish when you're ready."
        />
      </div>
    </div>
  );
}

type Tab = 'play' | 'clues' | 'chat';

/** Phone-only bottom navigation: the game is split into screens instead of one long scroll. */
function TabBar({
  tab,
  onChange,
  playAlert,
  unread,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  playAlert: boolean;
  unread: number;
}) {
  const items: { id: Tab; icon: string; label: string; badge?: ReactNode }[] = [
    {
      id: 'play',
      icon: '🎯',
      label: 'Play',
      badge: playAlert && <span className="size-2.5 rounded-full bg-amber-500" />,
    },
    { id: 'clues', icon: '📜', label: 'Clues' },
    {
      id: 'chat',
      icon: '💬',
      label: 'Chat',
      badge: unread > 0 && (
        <span className="rounded-full bg-rose-600 px-1.5 text-[0.65rem] font-bold text-white">
          {unread}
        </span>
      ),
    },
  ];
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={tab === it.id ? 'page' : undefined}
          onClick={() => onChange(it.id)}
          className={cn(
            'flex flex-col items-center gap-0.5 py-2 text-xs font-semibold',
            tab === it.id ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500',
          )}
        >
          <span className="flex items-center gap-1 text-lg leading-none">
            {it.icon}
            {it.badge}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

export function EnigmaGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: EnigmaUiProps) {
  const [tab, setTab] = useState<Tab>('play');
  const [seenChat, setSeenChat] = useState(0);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);

  // Mid-game watchers: the Join buttons sit under the Chat tab on phones, so lead them there.
  useSpectatorPrompt(
    setSpectator,
    view.phase !== 'lobby' && !view.me?.team
      ? {
          text: 'Join a team to play from the next clues.',
          actionLabel: 'Take a seat',
          action: () => {
            setTab('chat');
            requestAnimationFrame(() => revealElement(TEAMS_ID));
          },
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
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        blocker={blocker}
        online={online}
        showGuide={showGuide}
      />
    );
  }

  const switchTab = (next: Tab) => {
    // Reading the chat, or leaving it, marks everything so far as seen.
    if (next === 'chat' || tab === 'chat') setSeenChat(view.chat.length);
    setTab(next);
  };
  const unread = tab === 'chat' ? 0 : Math.max(0, view.chat.length - seenChat);
  // On phones only the chosen tab shows; from lg up everything is laid out at once.
  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');

  const myTeam = view.me?.team ?? null;
  const shown = view.transmissions
    .filter((t) => t.active || t.revealed)
    .sort((a, b) => Number(b.team === myTeam) - Number(a.team === myTeam));
  const sheetTeams: Team[] = myTeam ? [myTeam, other(myTeam)] : ['red', 'blue'];
  const isLastReveal =
    view.stage === 'reveal' &&
    (view.settings.flow === 'simultaneous' || view.transmissions[1]?.active === true);

  return (
    <div className="grid gap-4 pb-20 lg:grid-cols-[1fr_20rem] lg:pb-0">
      <div className="min-w-0 space-y-4">
        <Scoreboard view={view} clockOffset={room.clockOffset} />

        <div className={cn('space-y-4', onTab('play'))}>
          {/* Once the game is over, the result panel says who won (once). */}
          {view.phase !== 'over' && (
            <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          )}
          {view.phase === 'over' ? (
            <Panel className="space-y-3 text-center">
              <p
                className={cn(
                  'text-2xl font-bold',
                  view.winner !== 'draw' && view.winner && TEAM_TEXT[view.winner],
                )}
              >
                {view.winner === 'draw'
                  ? '🤝 A draw!'
                  : `🏆 ${TEAM_LABEL[view.winner as Team]} team wins!`}
              </p>
              <p className="text-sm text-stone-500">
                Everyone's keywords are revealed under Clues.
              </p>
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
          ) : (
            <div className={cn('grid gap-4', shown.length > 1 && 'md:grid-cols-2')}>
              {shown.map((tx) => (
                <TransmissionCard key={`${view.round}-${tx.team}`} view={view} tx={tx} act={act} />
              ))}
            </div>
          )}
          {view.phase === 'playing' && view.stage === 'reveal' && room.isHost && (
            <div className="flex justify-center">
              <Button size="lg" onClick={() => void act({ type: 'next-round' })}>
                {isLastReveal ? 'Next round' : 'Continue'}
              </Button>
            </div>
          )}
        </div>

        <div className={cn('space-y-4', onTab('clues'))}>
          {sheetTeams.map((team) =>
            view.teams[team].keywords && (team === myTeam || view.phase === 'over') ? (
              <OwnSheet key={team} view={view} team={team} />
            ) : (
              <OpponentSheet key={team} view={view} team={team} act={act} />
            ),
          )}
        </div>
      </div>

      <aside className={cn('space-y-4', onTab('chat'))}>
        <TeamChat view={view} act={act} />
        <Panel>
          <h3 className="mb-2 font-bold">Teams</h3>
          <TeamsPicker view={view} online={online} act={act} hostId={room.hostId} />
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

      <TabBar
        tab={tab}
        onChange={switchTab}
        playAlert={status.yourMove && tab !== 'play'}
        unread={unread}
      />
    </div>
  );
}
