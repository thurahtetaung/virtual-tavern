import type { GameRoomInfo, GameUiProps } from '@vt/game-sdk';
import { Button, Countdown, Hint, cn, useSpectatorPrompt } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { RoundTableAction, RoundTableView, Stage } from '../logic/types.ts';
import {
  AssassinPanel,
  LadyPanel,
  LadyResult,
  LatestNews,
  ProposePanel,
  QuestPanel,
  RevealPanel,
  Tip,
  VotePanel,
} from './Actions.tsx';
import { QuestTrack, type SeatPick, Seats, VoteTrack, WaitingChips } from './Board.tsx';
import { Emblem } from './Emblem.tsx';
import { End } from './End.tsx';
import { History } from './History.tsx';
import { Lobby } from './Lobby.tsx';
import { RoleSheet } from './RoleCard.tsx';
import { useSuspicions, useTips } from './storage.ts';
import { currentQuest, statusFor } from './status.ts';

export type RoundTableUiProps = GameUiProps<RoundTableView, RoundTableAction>;
type Tab = 'table' | 'history';

/** What each stage's clock times, and what a strict timer does at 0:00. */
const CLOCK: Partial<Record<Stage, { label: string; atZero: string }>> = {
  propose: { label: 'to pick a team', atZero: 'then a team is picked at random' },
  vote: { label: 'to vote', atZero: 'no vote = Approve' },
  quest: { label: 'to play a card', atZero: 'no card = Success' },
  lady: { label: 'to check someone', atZero: 'then a random pick' },
  assassinate: { label: 'to name Merlin', atZero: 'then a random pick' },
};

function TopBar({
  view,
  room,
  yourMove,
  onRole,
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  yourMove: boolean;
  onRole: () => void;
}) {
  const g = view.game!;
  const clock = view.stage ? CLOCK[view.stage] : undefined;
  const strict = view.settings.timerMode === 'strict';
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-stone-600 dark:text-stone-400">
        <span>{view.phase === 'over' ? 'Game over' : `Round ${g.round}`}</span>
        {yourMove && (
          <span className="animate-pulse rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white motion-reduce:animate-none">
            Your turn
          </span>
        )}
        {view.role && (
          <Button variant="secondary" size="sm" onClick={onRole} className="gap-1 pl-1">
            <Emblem role={view.role.role} className="size-6 ring-1" />
            My role
          </Button>
        )}
      </div>
      <Countdown
        deadline={view.phase === 'playing' ? g.deadline : null}
        clockOffset={room.clockOffset}
        label={clock?.label}
        {...(strict
          ? { atZero: clock?.atZero }
          : { soft: true, expiredHint: 'Time’s up: wrap up when you can.' })}
      />
    </div>
  );
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { id: Tab; icon: string; label: string }[] = [
    { id: 'table', icon: '🏰', label: 'Table' },
    { id: 'history', icon: '📜', label: 'History' },
  ];
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
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
          <span className="text-lg leading-none">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/** The first-time tip for this moment, if the viewer hasn't dismissed it. */
function tipFor(view: RoundTableView, fresh: (id: string) => boolean): [string, string] | null {
  const role = view.role;
  const g = view.game;
  if (!role || !g || view.phase !== 'playing') return null;
  const tips: [string, string, boolean][] = [
    [
      'leader',
      'Leading tip: talk before you send the team. Ask who people trust; the votes that follow tell you a lot.',
      view.stage === 'propose' && g.leader === view.me?.id,
    ],
    [
      'vote',
      'Voting tip: votes are public once everyone has voted. Who approved a team that later sank is worth remembering.',
      view.stage === 'vote',
    ],
    [
      'quest-evil',
      'Evil tip: a Fail on an early quest can give you away. Sometimes a Success buys you trust for later.',
      view.stage === 'quest' && role.loyalty === 'evil' && !!g.quest?.team.includes(view.me!.id),
    ],
    [
      'marks',
      'Tap the dot on a seat to mark ⭐ trust or ✕ suspect. Only you see these marks.',
      view.stage === 'propose',
    ],
  ];
  const tip = tips.find(([id, , when]) => when && fresh(id));
  return tip ? [tip[0], tip[1]] : null;
}

export function RoundTableGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: RoundTableUiProps) {
  const [tab, setTab] = useState<Tab>('table');
  const [roleOpen, setRoleOpen] = useState(false);
  const stageKey = `${view.game?.proposals.length ?? 0}-${view.game?.results.length ?? 0}-${view.stage}`;
  const [picked, setPicked] = useState<{ key: string; id: string | null }>({ key: '', id: null });
  const target = picked.key === stageKey ? picked.id : null;
  const [marks, cycleMark] = useSuspicions(`${view.table}.${view.gamesPlayed}`);
  const [fresh, dismiss] = useTips();
  const status = statusFor(view, room.isHost, room);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;

  const watching =
    view.phase === 'lobby'
      ? view.me && !view.me.playing
        ? { text: 'The table is full, so you’re watching.' }
        : null
      : !view.role
        ? { text: 'You’re watching this game. You can play in the next one.' }
        : null;
  useSpectatorPrompt(setSpectator, watching);

  const yourMove = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(yourMove);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, yourMove]);

  if (view.phase === 'lobby') {
    return (
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        online={online}
        showGuide={showGuide}
      />
    );
  }

  const g = view.game!;
  const me = view.me?.id;
  const q = currentQuest(view);
  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');

  let pick: SeatPick | null = null;
  if (view.stage === 'propose' && g.leader === me && view.role && q) {
    pick = {
      label: (name) => `Pick ${name} for the team`,
      selected: (id) => g.draft.includes(id),
      disabled: (id) => !g.draft.includes(id) && g.draft.length >= q.size,
      onPick: (id) => void act({ type: 'pick', player: id }),
    };
  } else if (view.stage === 'lady' && g.lady && g.lady.holder === me) {
    const holders = g.lady.holders;
    pick = {
      label: (name) => `Check ${name}`,
      selected: (id) => target === id,
      disabled: (id) => holders.includes(id),
      onPick: (id) => setPicked({ key: stageKey, id }),
    };
  } else if (view.stage === 'assassinate' && g.assassin === me) {
    pick = {
      label: (name) => `Name ${name} as Merlin`,
      selected: (id) => target === id,
      disabled: (id) => id === me,
      onPick: (id) => setPicked({ key: stageKey, id }),
    };
  }

  const tip = tipFor(view, fresh);
  const seats = <Seats view={view} room={room} pick={pick} marks={marks} onMark={cycleMark} />;
  const stage = view.stage;

  return (
    <div className="space-y-3 pb-20 lg:pb-0">
      <TopBar view={view} room={room} yourMove={yourMove} onRole={() => setRoleOpen(true)} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={cn('min-w-0 space-y-3', onTab('table'))}>
          {stage !== 'reveal' && (
            <QuestTrack
              view={view}
              onPick={
                stage === 'propose' && g.targeting && g.leader === me && view.role
                  ? (slot) => void act({ type: 'target', slot })
                  : undefined
              }
            />
          )}
          {view.phase === 'playing' && stage !== 'reveal' && <VoteTrack view={view} />}
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {tip && <Tip onDismiss={() => dismiss(tip[0])}>{tip[1]}</Tip>}
          {view.phase === 'over' && <End view={view} room={room} act={act} />}
          {view.phase === 'playing' && (
            <>
              <LatestNews view={view} />
              <LadyResult view={view} />
              {stage === 'reveal' && <RevealPanel view={view} act={act} showGuide={showGuide} />}
              {stage === 'vote' && <VotePanel view={view} act={act} />}
              {stage === 'quest' && <QuestPanel view={view} act={act} />}
              <WaitingChips view={view} room={room} act={act} />
              {stage !== 'reveal' && seats}
              <div className="sticky bottom-[4.5rem] z-10 rounded-2xl bg-stone-100 shadow-lg empty:hidden lg:static lg:shadow-none dark:bg-stone-950">
                {stage === 'propose' && <ProposePanel view={view} act={act} />}
                {stage === 'lady' && <LadyPanel view={view} act={act} target={target} />}
                {stage === 'assassinate' && <AssassinPanel view={view} act={act} target={target} />}
              </div>
            </>
          )}
          {room.isHost && view.phase === 'playing' && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                if (window.confirm('End this game for everyone and go back to the lobby?'))
                  void act({ type: 'back-to-lobby' });
              }}
            >
              Abandon game
            </Button>
          )}
        </div>
        <div className={cn('min-w-0', onTab('history'))}>
          <History view={view} />
        </div>
      </div>
      <TabBar tab={tab} onChange={setTab} />
      <RoleSheet
        view={view}
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        showGuide={showGuide}
      />
    </div>
  );
}
