import { type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  EndHero,
  EndTabs,
  GuideLink,
  Fold,
  Hint,
  Icon,
  Notice,
  Panel,
  Tag,
  RefusalSlot,
  StickyBar,
  Superlatives,
  TabBar,
  type TabBarItem,
  tabPanelProps,
  cn,
  revealElement,
  useSpectatorPrompt,
  useConfirm,
  useAbandonGame,
  LobbySettings,
  wordListsLine,
  timersLine,
  useWideScreen,
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
import { TEAM_BUTTON, TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';
import { Teams } from './Teams.tsx';

export type CodenamesUiProps = GameUiProps<CodenamesView, CodenamesAction>;

/** Phones in play: the board, the log and the teams one at a time, from the tab bar. */
type PlayTab = 'board' | 'log' | 'teams';
const PLAY_TABS_ID = 'codenames-play';
const PLAY_TABS: readonly TabBarItem<PlayTab>[] = [
  { id: 'board', label: 'Board', icon: 'layout-grid' },
  { id: 'log', label: 'Log', icon: 'scroll-text' },
  { id: 'teams', label: 'Teams', icon: 'users' },
];

/** The seat controls a "Take a seat" link leads to. */
const TEAMS_ID = 'codenames-teams';
/** Where the engine's refusal of the host's skip shows (the turn isn't stuck yet). */
const SKIP_ANCHOR = 'codenames-skip';
/** Where a refused guess or End turn shows: with the buttons (in the sticky bar on phones). */
const GUESS_ANCHOR = 'codenames-guess';

export function CodenamesGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: CodenamesUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

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
      <div className="mx-auto max-w-3xl space-y-4">
        {status.text && <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>}
        <Teams view={view} online={online} act={act} hostId={room.hostId} />
        <GuideLink title={room.gameName ?? 'Codenames'} onClick={showGuide} />
        <p className="text-center text-small">
          <b className={TEAM_TEXT[view.startingTeam]}>{TEAM_LABEL[view.startingTeam]}</b> goes first
          this game and has 9 agents to find; the other team has 8.
        </p>
        <LobbySettings
          editable={room.isHost}
          summary={[
            wordListsLine(view.settings.wordListIds, room.wordLists),
            timersLine(view.settings),
          ]}
          className="space-y-4"
        >
          <Settings
            settings={view.settings}
            wordLists={room.wordLists}
            editable={room.isHost}
            act={act}
          />
        </LobbySettings>
        {room.isHost && (
          <StickyBar>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="lg"
                  disabled={blocker !== null}
                  onClick={() => void act({ type: 'start' })}
                >
                  Start game
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  title="Shuffling keeps anyone who chose to be a Spymaster."
                  onClick={() => void act({ type: 'randomize-teams' })}
                >
                  <Icon name="shuffle" />
                  Shuffle teams
                </Button>
              </div>
              {blocker && <p className="text-caption text-ink-muted">{blocker}</p>}
              {/* Phones keep it as the button's tooltip, so the lobby fits the screen. */}
              <p className="hidden text-caption text-ink-muted sm:block">
                Shuffling keeps anyone who chose to be a Spymaster.
              </p>
            </div>
          </StickyBar>
        )}
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
  const [confirm, confirmDialog] = useConfirm();
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
  const wide = useWideScreen();
  // Seated players on phones and tablets get the tab bar while the game is on; watchers keep
  // everything on one page, where "Take a seat" leads them to the teams.
  const tabbed = !wide && view.phase === 'playing' && me?.team != null;
  const [tab, setTab] = useState<PlayTab>('board');
  const shown: PlayTab | null = tabbed ? tab : null;
  // The banner also says when the timer, a forfeit or the host ended a turn.

  const guess = async () => {
    if (selected === null) return;
    const card = selected;
    setSelected(null);
    await act({ type: 'guess', card, seen: view.log.length }, { anchor: GUESS_ANCHOR });
  };

  // The host's Play again and Change setup float in the sticky bar on phones; guests read who
  // starts the next game in that spot.
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
  // The viewer's side lights the card: ember when their team won, danger when it lost, quiet
  // for watchers (the title carries the winning team's colour).
  const tone = !me?.team || !view.winner ? 'neutral' : me.team === view.winner ? 'win' : 'loss';
  const hero = (
    <EndHero
      title={
        view.winner ? (
          <span className={TEAM_TEXT[view.winner]}>{TEAM_LABEL[view.winner]} team wins!</span>
        ) : (
          'Game over'
        )
      }
      eyebrow={view.winner ? undefined : null}
      tone={tone}
      actions={endButtons}
    >
      {/* Wide screens fold the last guess's banner ("It's the assassin!") into the finale. */}
      {wide && result && <p className="font-semibold text-ink">{result.headline}</p>}
      {winHow(view)}.{' '}
      {me?.team && (
        <b>{me.team === view.winner ? 'Your team won!' : 'Your team lost this time.'}</b>
      )}
    </EndHero>
  );
  // Phones: the result and Play again, then the board, awards, log and teams one at a time, so
  // the end fits the screen.
  const phoneEnd = (
    <>
      {hero}
      <EndTabs
        tabs={[
          {
            id: 'board',
            label: '🗝️ Key',
            content: (
              <Board view={view} selected={null} lastGuessed={result?.card ?? null} onPick={null} />
            ),
          },
          !!room.superlatives?.length && {
            id: 'awards',
            label: '✨ Awards',
            content: <Superlatives lines={room.superlatives} />,
          },
          {
            id: 'log',
            label: '📜 Log',
            content: (
              <Panel className="max-h-[22rem] overflow-y-auto">
                <GameLog view={view} />
              </Panel>
            ),
          },
          {
            id: 'teams',
            label: '👥 Teams',
            content: (
              <Panel className="max-h-[22rem] overflow-y-auto">
                <Teams view={view} online={online} act={act} hostId={room.hostId} compact />
              </Panel>
            ),
          },
        ]}
      />
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
      {confirmDialog}
      <div
        className={cn('min-w-0 space-y-3 lg:max-w-[60rem]', shown && shown !== 'board' && 'hidden')}
        {...(shown === 'board' && tabPanelProps(PLAY_TABS_ID, 'board'))}
      >
        <ScoreBar view={view} clockOffset={room.clockOffset} />
        {/* Wide screens at the end: the finale's line says how it ended, so the board stays whole. */}
        {result && !(wide && view.phase === 'over') && (
          <ResultBanner
            key={view.log.length}
            result={result}
            kind={result.card === null ? null : (view.board[result.card]?.kind ?? null)}
          />
        )}
        {spymasterAlerts(view, room.isHost).map((alert) => (
          <Notice
            key={alert.team}
            tone="warn"
            role="alert"
            testId="no-spymaster"
            className={alert.mine || alert.canTake ? 'font-semibold' : undefined}
          >
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>{alert.text}</span>
              {alert.canTake && (
                <Button
                  size="sm"
                  variant={TEAM_BUTTON[alert.team]}
                  onClick={() =>
                    void act({ type: 'join-team', team: alert.team, role: 'spymaster' })
                  }
                >
                  Be the {TEAM_LABEL[alert.team]} Spymaster
                </Button>
              )}
              {alert.stuck && room.isHost && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void (async () => {
                      if (
                        await confirm({
                          title: 'Back to the lobby?',
                          body: 'This game ends for everyone.',
                          confirmLabel: 'Back to lobby',
                          danger: true,
                        })
                      ) {
                        void act({ type: 'back-to-lobby' });
                      }
                    })()
                  }
                >
                  Back to lobby
                </Button>
              )}
            </span>
          </Notice>
        ))}
        {/* Once the game is over, the result panel says who won (once). */}
        {view.phase !== 'over' && (
          <Hint dense tone={status.yourMove ? 'action' : 'neutral'}>
            {status.text}
          </Hint>
        )}
        {status.stalled && room.isHost && turn && (
          <div className="flex justify-center">
            <Button variant="secondary" onClick={() => void act({ type: 'end-turn' })}>
              Skip {TEAM_LABEL[turn.team]}'s turn
            </Button>
          </div>
        )}

        {turn?.clue && (
          <p className="text-center text-sub">
            <span className="text-ink-muted">Clue: </span>
            <b className={cn('text-heading tracking-wide uppercase', TEAM_TEXT[turn.team])}>
              {turn.clue.word}
            </b>
            <span className="text-ink-muted"> · </span>
            <b className="text-heading">{turn.clue.count}</b>
          </p>
        )}

        {/* Phones: above the board, so the result and Play again need no scroll past the key.
            Wide screens put the finale beside the board, so the whole revealed key fits. */}
        {view.phase === 'over' && !wide && phoneEnd}
        {(wide || view.phase !== 'over') && (
          <Board
            view={view}
            selected={selected}
            lastGuessed={result?.card ?? null}
            onPick={canGuess ? pick : null}
          />
        )}

        {canClue && (
          // On phones the form lives in the sticky bar, so the panel gives way.
          <Panel className="max-sm:contents">
            <ClueForm act={act} max={view.remaining[turn.team]} />
          </Panel>
        )}

        {canGuess && (
          // In the bar at the foot of a phone screen, under the board on wider ones.
          <StickyBar fixed refusal={GUESS_ANCHOR} refusalKey={view.log.length}>
            <div className="flex flex-wrap items-center justify-center gap-2">
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
                onClick={() => void act({ type: 'end-turn' }, { anchor: GUESS_ANCHOR })}
              >
                End turn
              </Button>
              <span className="basis-full text-center text-caption text-ink-muted">
                {canPass
                  ? 'A guess flips the card for your whole team.'
                  : 'A guess flips the card for your whole team. Guess at least once first.'}
              </span>
            </div>
          </StickyBar>
        )}
      </div>

      <aside
        className={cn(
          'space-y-4',
          !wide && view.phase === 'over' && 'hidden',
          shown === 'board' && 'hidden',
        )}
        {...(shown && shown !== 'board' && tabPanelProps(PLAY_TABS_ID, shown))}
      >
        {wide && view.phase === 'over' && (
          <>
            {hero}
            {!!room.superlatives?.length && <Superlatives lines={room.superlatives} />}
          </>
        )}
        {shown !== 'teams' && (
          <Panel>
            <h3 className="mb-1 font-bold">Game log</h3>
            <GameLog view={view} />
          </Panel>
        )}
        {shown !== 'log' && (
          <TeamsSection
            view={view}
            online={online}
            act={act}
            hostId={room.hostId}
            startOpen={tabbed}
          />
        )}
        {room.isHost && view.phase === 'playing' && shown !== 'log' && (
          <div className="space-y-1">
            {/* Not on your own team's guessing turn: there, End turn follows the normal rule. */}
            {!canGuess && (
              <Button
                variant="quiet"
                size="sm"
                className="w-full"
                onClick={() =>
                  void (async () => {
                    if (
                      await confirm({
                        title: 'Skip the current turn?',
                        body: 'It ends for everyone. Use this if nobody can play it.',
                        confirmLabel: 'Skip turn',
                      })
                    ) {
                      void act({ type: 'end-turn' }, { anchor: SKIP_ANCHOR });
                    }
                  })()
                }
              >
                Skip stuck turn
              </Button>
            )}
            <RefusalSlot anchor={SKIP_ANCHOR} resetKey={view.log.length} />
          </div>
        )}
      </aside>
      {tabbed && (
        <TabBar
          id={PLAY_TABS_ID}
          label="Codenames"
          items={PLAY_TABS}
          value={tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
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
              view.turn?.team === team && 'bg-card shadow-vt-1 ring-2 ring-current',
              TEAM_TEXT[team],
            )}
          >
            <span className="text-heading font-black tabular-nums">{view.remaining[team]}</span>
            <span className="text-small font-semibold">
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
        <p className="text-center" data-testid="my-role">
          <Tag className={cn('px-3 ring-1', TEAM_PANEL[myTeam], TEAM_TEXT[myTeam])}>
            You: {role}
          </Tag>
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
  /** Open from the start (its own tab on phones). */
  startOpen?: boolean;
}) {
  const { view, startOpen = false, ...teams } = props;
  // Spectators need the join buttons, so the section starts open for them on every screen.
  const [open, setOpen] = useState(
    () => startOpen || view.me?.team == null || window.matchMedia('(min-width: 1024px)').matches,
  );
  const count = (team: 'red' | 'blue') => view.seats.filter((s) => s.team === team).length;
  const watching = view.seats.filter((s) => s.team === null).length;
  return (
    <Fold
      open={open}
      onToggle={setOpen}
      summary={
        <span className="flex flex-1 items-center justify-between gap-2">
          <h3 className="text-body font-bold">Teams</h3>
          <span className="flex items-center gap-2 text-small text-ink-muted">
            <span className={TEAM_TEXT.red}>Red {count('red')}</span>·
            <span className={TEAM_TEXT.blue}>Blue {count('blue')}</span>
            {watching > 0 && <span>· {watching} watching</span>}
          </span>
        </span>
      }
    >
      <div id={TEAMS_ID}>
        <Teams view={view} {...teams} compact />
      </div>
    </Fold>
  );
}
