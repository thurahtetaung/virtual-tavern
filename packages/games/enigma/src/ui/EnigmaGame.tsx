import { type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  EndHero,
  EndLayout,
  EndTabs,
  FitArea,
  Hint,
  Notice,
  Panel,
  StickyBar,
  TAP_BAND,
  Superlatives,
  TabBar,
  type TabBarItem,
  tabPanelProps,
  cn,
  revealElement,
  useSpectatorPrompt,
  useAbandonGame,
  useWideScreen,
} from '@vt/ui';
import { useEffect, useState } from 'react';
import { tokenWords } from '../logic/outcome.ts';
import { type EnigmaAction, type EnigmaView, TOKENS_TO_END, type Team } from '../logic/types.ts';
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
      className="inline-flex items-center gap-0.5 text-small sm:text-body"
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
      <span className="text-small font-bold sm:text-body">{TEAM_LABEL[team]}</span>
      <Tokens count={view.teams[team].intercepts} icon="🕵️" label="intercepts (2 win)" />
      <Tokens count={view.teams[team].misses} icon="💥" label="miscommunications (2 lose)" />
    </div>
  );
  const strict = view.settings.timerMode === 'strict';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        {side('red')}
        <div className="flex min-w-0 flex-col items-center gap-0.5 text-caption font-semibold text-ink-muted sm:text-small">
          <button
            type="button"
            aria-expanded={legend}
            aria-controls="enigma-legend"
            onClick={() => setToggled(!legend)}
            className={cn(
              'rounded px-1 underline decoration-dotted underline-offset-2 lg:inline-flex lg:min-h-11 lg:items-center',
              TAP_BAND,
            )}
          >
            Round {view.round} of {view.maxRounds} <span aria-hidden>ⓘ</span>
            <span className="sr-only"> (what do the scores mean?)</span>
          </button>
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
        {side('blue')}
      </div>
      <p id="enigma-legend" hidden={!legend} className="text-center text-caption text-ink-muted">
        🕵️ 2 intercepts win · 💥 2 miscommunications lose
      </p>
    </div>
  );
}

type Tab = 'play' | 'clues' | 'chat';
const TABS_ID = 'enigma-play';

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
  const wide = useWideScreen();
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
  const myTeam = view.me?.team ?? null;
  // Seated players on phones and tablets see one tab at a time; watchers and wide screens see
  // everything at once.
  const tabbed = !wide && myTeam !== null;
  const panel = (t: Tab) => ({
    className: tabbed && tab !== t ? 'hidden' : undefined,
    ...(tabbed && tab === t ? tabPanelProps(TABS_ID, t) : {}),
  });
  // In play, a tab's area scrolls inside itself so the page never does.
  const fit = tabbed && view.phase === 'playing';
  const stepKey = `${view.round}-${view.stage}`;
  const tabItems: readonly TabBarItem<Tab>[] = [
    {
      id: 'play',
      label: 'Play',
      icon: 'gamepad-2',
      badge: status.yourMove && tab !== 'play' ? 'dot' : undefined,
    },
    { id: 'clues', label: 'Clues', icon: 'scroll-text' },
    { id: 'chat', label: 'Chat', icon: 'message-circle', badge: unread },
  ];
  const shown = view.transmissions
    .filter((t) => t.active || t.revealed)
    .sort((a, b) => Number(b.team === myTeam) - Number(a.team === myTeam));
  const sheetTeams: Team[] = myTeam ? [myTeam, other(myTeam)] : ['red', 'blue'];
  // Decoders waiting for clues on a phone see their keywords and past clues right on the Play tab
  // (wide screens show them beside it, under Clues).
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
  const winnerTitle =
    view.winner === 'draw' ? (
      view.showdown ? (
        'A shared win!'
      ) : (
        'A draw!'
      )
    ) : view.winner ? (
      <span className={TEAM_TEXT[view.winner]}>{TEAM_LABEL[view.winner]} team wins!</span>
    ) : (
      'Game over'
    );
  // Ember when the viewer's team won, danger when it lost, quiet for a draw or a watcher.
  const endTone =
    !myTeam || !view.winner || view.winner === 'draw'
      ? 'neutral'
      : myTeam === view.winner
        ? 'win'
        : 'loss';
  // The emblem says how the game was won: an interception, the other side's miscommunications,
  // the showdown, or the score at the last round (the title carries the team's colour).
  const endEmblem = (() => {
    const w = view.winner;
    if (!w) return null;
    if (w === 'draw') return '🤝';
    if (view.showdown) return '🔐';
    if (view.teams[w].intercepts >= TOKENS_TO_END) return '🕵️';
    if (view.teams[w === 'red' ? 'blue' : 'red'].misses >= TOKENS_TO_END) return '💥';
    return '🏆';
  })();
  const tokenLines = (
    <ul className="space-y-0.5 text-small">
      {(['red', 'blue'] as const).map((team) => (
        <li key={team}>
          <b className={TEAM_TEXT[team]}>{TEAM_LABEL[team]}</b>:{' '}
          {tokenWords(view.teams[team].intercepts, view.teams[team].misses)}
        </li>
      ))}
    </ul>
  );
  // The host's Play again and Change setup float in the sticky bar on phones.
  const endButtons = room.isHost ? (
    <StickyBar>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="lg" onClick={() => void act({ type: 'start' })}>
          Play again
        </Button>
        <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
          Change setup
        </Button>
      </div>
    </StickyBar>
  ) : (
    <p className="text-center text-small text-ink-2">
      {waitingForHost(room, 'start the next game')}
    </p>
  );
  const hero = (
    <EndHero
      title={winnerTitle}
      emblem={endEmblem}
      tone={endTone}
      superlatives={wide ? room.superlatives : undefined}
      actions={endButtons}
    >
      {/* Why, said once here: the hint above is hidden once the game is over. */}
      {reason && <p>{reason}</p>}
    </EndHero>
  );
  // The end: who won and Play again as the finale; the tokens, the awards (phones), each team's
  // last code and, on wide screens, every clue sheet and the teams as its parts, fitted beside it.
  const endView = (
    <EndLayout hero={hero}>
      <EndTabs
        tabs={[
          // Phones open on the last round's codes (the scoreboard above already has the tokens).
          ...(wide
            ? []
            : lastReveal.map((tx) => ({
                id: tx.team,
                label: `${tx.team === 'red' ? '🔴' : '🔵'} ${TEAM_LABEL[tx.team]}`,
                content: <TransmissionCard view={view} tx={tx} act={act} />,
              }))),
          {
            id: 'score',
            label: '🏆 Score',
            content: (
              <Panel className="space-y-3 text-center">
                <ShowdownPanel view={view} act={act} />
                {tokenLines}
                <p className="text-small text-ink-muted">
                  Everyone's keywords are revealed under Clues.
                </p>
              </Panel>
            ),
          },
          !wide &&
            !!room.superlatives?.length && {
              id: 'awards',
              label: '✨ Awards',
              content: <Superlatives lines={room.superlatives} />,
            },
          ...(wide
            ? lastReveal.length > 0
              ? [
                  {
                    id: 'last',
                    label: '📡 Last round',
                    content: (
                      <section aria-label="The last round" className="space-y-2">
                        <h3 className="text-center text-small font-semibold text-ink-muted">
                          Round {view.round}, the last round
                        </h3>
                        <div
                          className={cn('grid gap-4', lastReveal.length > 1 && 'xl:grid-cols-2')}
                        >
                          {lastReveal.map((tx) => (
                            <TransmissionCard
                              key={`last-${tx.team}`}
                              view={view}
                              tx={tx}
                              act={act}
                            />
                          ))}
                        </div>
                      </section>
                    ),
                  },
                ]
              : []
            : []),
          wide && {
            id: 'clues',
            label: '🗝️ Clues',
            content: (
              <div className="grid gap-4 xl:grid-cols-2">
                {sheetTeams.map((team) =>
                  view.teams[team].keywords ? (
                    <OwnSheet key={team} view={view} team={team} />
                  ) : (
                    <OpponentSheet key={team} view={view} team={team} act={act} />
                  ),
                )}
              </div>
            ),
          },
          wide && {
            id: 'teams',
            label: '👥 Teams',
            content: (
              <Panel>
                <h3 className="mb-2 font-bold">Teams</h3>
                <TeamsPicker view={view} online={online} act={act} hostId={room.hostId} />
              </Panel>
            ),
          },
        ]}
      />
    </EndLayout>
  );

  if (wide && view.phase === 'over')
    return (
      <div className="space-y-4">
        <Scoreboard view={view} clockOffset={room.clockOffset} />
        {endView}
      </div>
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
      <div className="min-w-0 space-y-4">
        <Scoreboard view={view} clockOffset={room.clockOffset} />
        {/* The game only ends at the end of a round, so both teams always finish it. */}
        {endWarnings.length > 0 && (
          <Notice tone="warn" dense className="font-semibold">
            {endWarnings.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </Notice>
        )}

        <div {...panel('play')} className={cn('space-y-4', panel('play').className)}>
          {/* Once the game is over, the result panel says who won (once). */}
          {view.phase !== 'over' && (
            <Hint dense tone={status.yourMove ? 'action' : 'neutral'}>
              {status.text}
            </Hint>
          )}
          {view.phase === 'over' && endView}
          {/* On wide screens the play panel keeps its height (it holds the move); the clue sheets
              below it take what is left and scroll. */}
          <FitArea
            on={view.phase === 'playing' && !wide && fit && tab === 'play'}
            resetKey={stepKey}
            className="space-y-4"
          >
            {view.stage === 'showdown' && view.phase === 'playing' && (
              <ShowdownPanel view={view} act={act} />
            )}
            {view.phase !== 'over' && view.stage !== 'showdown' && (
              <>
                {/* While one team waits on the other, its panel holds a status line: it takes
                    its own height rather than standing as a tall empty slab. */}
                <div
                  className={cn(
                    'grid gap-4',
                    shown.length > 1 && 'md:grid-cols-2',
                    view.stage !== 'reveal' && 'md:items-start',
                  )}
                >
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
                {waitingKeywords && myTeam && !wide && <OwnSheet view={view} team={myTeam} />}
              </>
            )}
            {view.phase === 'playing' && view.stage === 'reveal' && room.isHost && (
              <StickyBar>
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
              </StickyBar>
            )}
          </FitArea>
        </div>

        <div {...panel('clues')} className={cn('space-y-4', panel('clues').className)}>
          <FitArea
            on={view.phase === 'playing' && (wide || (fit && tab === 'clues'))}
            resetKey={stepKey}
            className="space-y-4"
          >
            {sheetTeams.map((team) =>
              view.teams[team].keywords && (team === myTeam || view.phase === 'over') ? (
                <OwnSheet key={team} view={view} team={team} />
              ) : (
                <OpponentSheet key={team} view={view} team={team} act={act} />
              ),
            )}
          </FitArea>
        </div>
      </div>

      <aside {...panel('chat')} className={cn('space-y-4', panel('chat').className)}>
        <FitArea
          on={view.phase === 'playing' && (wide || (fit && tab === 'chat'))}
          resetKey={stepKey}
          className="space-y-4"
        >
          <TeamChat view={view} act={act} />
          <Panel>
            <h3 className="mb-2 font-bold">Teams</h3>
            <TeamsPicker view={view} online={online} act={act} hostId={room.hostId} />
          </Panel>
        </FitArea>
      </aside>

      {tabbed && (
        <TabBar
          id={TABS_ID}
          label="Enigma"
          items={tabItems}
          value={tab}
          onChange={switchTab}
          className="lg:hidden"
        />
      )}
    </div>
  );
}
