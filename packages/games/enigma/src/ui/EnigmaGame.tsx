import { type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  Superlatives,
  cn,
  revealElement,
  useSpectatorPrompt,
  useAbandonGame,
} from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { tokenWords } from '../logic/outcome.ts';
import type { EnigmaAction, EnigmaView, Team } from '../logic/types.ts';
import { TeamChat } from './Chat.tsx';
import { Lobby, TEAMS_ID, TeamsPicker } from './Lobby.tsx';
import { OpponentSheet, OwnSheet } from './Sheets.tsx';
import { ShowdownPanel } from './Showdown.tsx';
import { endOfRoundWarnings, endReason, revealOutcome, startBlocker, statusFor } from './status.ts';
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

/** On every screen: each team's tokens and the round (tap it for a legend), the timer underneath. */
function Scoreboard({ view, clockOffset }: { view: EnigmaView; clockOffset: number }) {
  // Touch screens never show a title tooltip, so the legend is spelled out: shown through round 1,
  // then on a tap of the round label.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const legend = toggled ?? view.round <= 1;
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
        <div className="flex flex-col items-center text-xs font-semibold text-ink-muted sm:flex-row sm:gap-2 sm:text-sm">
          <button
            type="button"
            aria-expanded={legend}
            aria-controls="enigma-legend"
            onClick={() => setToggled(!legend)}
            className="rounded px-1 underline decoration-dotted underline-offset-2"
          >
            Round {view.round} of {view.maxRounds} <span aria-hidden>ⓘ</span>
            <span className="sr-only"> (what do the scores mean?)</span>
          </button>
        </div>
        {side('blue')}
      </div>
      {/* Its own row, so a label or "Time's up" never squeezes the scores. */}
      <div className="flex justify-center empty:hidden">
        <Countdown
          deadline={view.phase === 'playing' && view.stage !== 'reveal' ? view.deadline : null}
          clockOffset={clockOffset}
          label={
            view.stage === 'clue'
              ? 'to write clues'
              : view.stage === 'showdown'
                ? 'to hand in guesses'
                : 'to lock in codes'
          }
          soft={!strict}
          atZero={
            view.stage === 'clue'
              ? 'then missing clues count as a miss'
              : view.stage === 'showdown'
                ? 'then each team’s guesses under Clues count'
                : 'then teams that haven’t agreed miss'
          }
          expiredHint="No penalty: finish when you're ready."
        />
      </div>
      <p
        id="enigma-legend"
        hidden={!legend}
        className="text-center text-xs text-stone-600 dark:text-stone-400"
      >
        🕵️ interceptions: 2 wins · 💥 miscommunications: 2 loses
      </p>
    </div>
  );
}

/** Your team's four keywords in one compact line, for decoders waiting on the clues. */
function KeywordStrip({ keywords }: { keywords: string[] }) {
  return (
    <section aria-label="Your keywords" className="space-y-1 text-center">
      <p className="text-sm text-ink-muted">
        Your keywords. You’ll match each clue to one of these.
      </p>
      <ol className="flex flex-wrap justify-center gap-1.5">
        {keywords.map((word, i) => (
          <li
            key={i}
            className="rounded-lg bg-white px-2 py-1 text-sm font-bold uppercase ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700"
          >
            <span className="mr-1 text-ink-muted tabular-nums">{i + 1}</span>
            {word}
          </li>
        ))}
      </ol>
    </section>
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
      badge: playAlert && <span className="size-2.5 rounded-full bg-accent dark:bg-amber-500" />,
    },
    { id: 'clues', icon: '📜', label: 'Clues' },
    {
      id: 'chat',
      icon: '💬',
      label: 'Chat',
      badge: unread > 0 && (
        <span className="rounded-full bg-team-a dark:bg-rose-600 px-1.5 text-[0.65rem] font-bold text-white">
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
            tab === it.id ? 'text-amber-700 dark:text-amber-400' : 'text-ink-muted',
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
  setAbandon,
}: EnigmaUiProps) {
  const [tab, setTab] = useState<Tab>('play');
  const [seenChat, setSeenChat] = useState(0);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

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
  // Decoders waiting for clues see their keywords right on the Play tab, not only under Clues.
  const keywords = myTeam ? view.teams[myTeam].keywords : null;
  const waitingKeywords =
    view.stage === 'clue' &&
    keywords &&
    !view.transmissions.some((t) => t.active && t.role === 'encryptor' && !t.clues)
      ? keywords
      : null;
  const isLastReveal =
    view.stage === 'reveal' &&
    (view.settings.flow === 'simultaneous' || view.transmissions[1]?.active === true);
  const outcome = revealOutcome(view);
  const reason = endReason(view);
  const lastReveal = view.transmissions.filter((t) => t.revealed);
  const endWarnings = endOfRoundWarnings(view);

  return (
    <div className="grid gap-4 pb-20 lg:grid-cols-[1fr_20rem] lg:pb-0">
      <div className="min-w-0 space-y-4">
        <Scoreboard view={view} clockOffset={room.clockOffset} />
        {/* The game only ends at the end of a round, so both teams always finish it. */}
        {endWarnings.length > 0 && (
          <div
            role="status"
            aria-label="Last round"
            className="rounded-lg bg-accent-soft px-3 py-2 text-center text-sm font-semibold text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          >
            {endWarnings.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}

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
                  ? view.showdown
                    ? '🤝 A shared win!'
                    : '🤝 A draw!'
                  : `🏆 ${TEAM_LABEL[view.winner as Team]} team wins!`}
              </p>
              {/* Why, said once here: the hint above is hidden once the game is over. */}
              {reason && <p className="font-semibold">{reason}</p>}
              <ShowdownPanel view={view} act={act} />
              <ul className="space-y-0.5 text-sm">
                {(['red', 'blue'] as const).map((team) => (
                  <li key={team}>
                    <b className={TEAM_TEXT[team]}>{TEAM_LABEL[team]}</b>:{' '}
                    {tokenWords(view.teams[team].intercepts, view.teams[team].misses)}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-muted">
                Everyone's keywords are revealed under Clues.
              </p>
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
          ) : null}
          {view.phase === 'over' && lastReveal.length > 0 && (
            <section aria-label="The last round" className="space-y-2">
              <h3 className="text-center text-sm font-semibold text-ink-muted">
                Round {view.round}, the last round
              </h3>
              <div className={cn('grid gap-4', lastReveal.length > 1 && 'md:grid-cols-2')}>
                {lastReveal.map((tx) => (
                  <TransmissionCard key={`last-${tx.team}`} view={view} tx={tx} act={act} />
                ))}
              </div>
            </section>
          )}
          {view.stage === 'showdown' && view.phase === 'playing' && (
            <ShowdownPanel view={view} act={act} />
          )}
          {view.phase !== 'over' && view.stage !== 'showdown' && (
            <>
              {waitingKeywords && <KeywordStrip keywords={waitingKeywords} />}
              <div className={cn('grid gap-4', shown.length > 1 && 'md:grid-cols-2')}>
                {shown.map((tx) => (
                  <TransmissionCard
                    key={`${view.round}-${tx.team}`}
                    view={view}
                    tx={tx}
                    act={act}
                    online={online}
                    isHost={room.isHost}
                  />
                ))}
              </div>
            </>
          )}
          {view.phase === 'playing' && view.stage === 'reveal' && room.isHost && (
            <div className="flex justify-center">
              <Button size="lg" onClick={() => void act({ type: 'next-round' })}>
                {outcome?.winner === 'draw'
                  ? 'Start the showdown'
                  : outcome
                    ? 'See results'
                    : isLastReveal
                      ? 'Next round'
                      : 'Continue'}
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
