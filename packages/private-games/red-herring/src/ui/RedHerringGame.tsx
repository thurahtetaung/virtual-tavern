import { type GameUiProps, type PlayerId, waitingFor, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  EndHero,
  EndLayout,
  EndTabs,
  Hint,
  Panel,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  TabBar,
  type TabBarItem,
  tabPanelProps,
  cn,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
} from '@vt/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { RedHerringAction, RedHerringView } from '../logic/types.ts';
import { type Art, useArt } from './assets.ts';
import { Card, DrawPile } from './Card.tsx';
import { Lobby } from './Lobby.tsx';
import { useTurnBuzz } from './buzz.ts';
import { Tips } from './Tips.tsx';
import { Ballot, HandStrip, Notebook, Reveal, Table, WordForm } from './parts.tsx';
import { type NameOf, statusFor, waitingIds } from './status.ts';

export type RedHerringUiProps = GameUiProps<RedHerringView, RedHerringAction>;
export type Act = RedHerringUiProps['act'];

export function RedHerringGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: RedHerringUiProps) {
  const art = useArt();
  const people = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(people.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [people]);
  const status = statusFor(view, room.you, name);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);
  useTurnBuzz(tabAlert);

  const inGame = !!view.game?.players.some((p) => p.id === room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : { text: 'You can join from the next game.' }
      : null,
  );

  if (view.phase === 'lobby' || !view.game)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 lg:max-w-6xl">
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 sm:gap-3">
      <Hint dense tone={status.yourMove ? 'action' : 'neutral'}>
        {status.text}
      </Hint>
      {view.phase === 'over' ? (
        <End view={view} room={room} act={act} art={art} name={name} />
      ) : (
        <Play view={view} room={room} act={act} art={art} name={name} showGuide={showGuide} />
      )}
    </div>
  );
}

/** Phones in play: the table, your notebook and hand, and the scores. */
type PlayTab = 'table' | 'me' | 'scores';
const PLAY_TABS_ID = 'red-herring-play';
const PLAY_TABS: readonly TabBarItem<PlayTab>[] = [
  { id: 'table', label: 'Table', icon: 'layout-grid' },
  { id: 'me', label: 'Me', icon: 'book-open' },
  { id: 'scores', label: 'Scores', icon: 'chart-bar' },
];

interface PartProps {
  view: RedHerringView;
  room: RedHerringUiProps['room'];
  act: Act;
  art: Art;
  name: NameOf;
}

/** The game in play: the round's bar, the stage's panel, the table and your hand. */
function Play({ view, room, act, art, name, showGuide }: PartProps & { showGuide: () => void }) {
  const g = view.game!;
  const r = g.round;
  const wide = useWideScreen();
  const [tab, setTab] = useState<PlayTab>('table');
  const you = room.you;
  const inGame = r.order.includes(you);
  const handStage = r.stage === 'card' || r.stage === 'word' || r.stage === 'play';
  // Phones and tablets: the table, your notebook and hand (Me), and the scores, from the tab bar.
  // On your card or play turn the hand is the table's workspace instead (never shown twice).
  const shown: PlayTab | null = wide ? null : tab;
  const yourCardTurn = (r.stage === 'card' || r.stage === 'play') && r.turn === you;
  const handOnTable = shown === null ? handStage : yourCardTurn;
  const timerLabel =
    r.stage === 'discuss'
      ? 'to talk'
      : r.stage === 'vote'
        ? 'to vote'
        : r.stage === 'word'
          ? 'for the word'
          : 'for this card';
  const strict = view.settings.timerMode === 'strict' && r.stage !== 'word';
  const panel = stagePanel({ view, room, act, art, name });
  const side = (
    <>
      {panel}
      {wide && <ScoreList view={view} you={you} art={art} />}
    </>
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold" data-testid="rh-round">
          Round {r.no} of {g.rounds}
        </span>
        <span className="text-ink-muted">
          · ✏️ {r.picker === you ? 'You pick the word' : `${name(r.picker)} picks the word`}
          {view.settings.topic && <> · Topic: {view.settings.topic}</>}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <DrawPile art={art} count={g.deck} className="mr-1" />
          <Countdown
            deadline={r.deadline}
            clockOffset={room.clockOffset}
            label={timerLabel}
            {...(strict
              ? { atZero: atZeroOf(r.stage) }
              : {
                  soft: true,
                  expiredHint:
                    r.stage === 'discuss'
                      ? room.isHost
                        ? 'Time’s up: start the vote when the table is ready.'
                        : 'Time’s up: the host starts the vote.'
                      : room.isHost
                        ? 'Time’s up: you can Act for them below.'
                        : 'Time’s up: the host can move things on.',
                })}
          />
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => showGuide()}>
            📖<span className="sr-only">Rules</span>
          </Button>
        </span>
      </div>
      {shown === null && <HostTools view={view} room={room} act={act} art={art} name={name} />}
      {/* Desktops keep the tips in the rail (under the vote), so the table starts at the top. */}
      {inGame && !wide && <Tips />}
      {inGame && shown === null && <Notebook view={view} you={you} art={art} />}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-2',
            shown !== null && shown !== 'table' && 'hidden',
          )}
          {...(shown === 'table' && tabPanelProps(PLAY_TABS_ID, 'table'))}
        >
          {!wide && panel}
          <Table view={view} room={room} art={art} name={name} />
          {inGame && handOnTable && !wide && (
            <HandStrip view={view} act={act} art={art} you={you} />
          )}
        </div>
        {wide && (
          <aside className="flex flex-col gap-3">
            {/* The vote and the scores first; the first-time tips under them. */}
            {side}
            {inGame && <Tips />}
          </aside>
        )}
        {/* Desktops: the hand across the whole width under the table, so the cards are large. */}
        {wide && inGame && handOnTable && (
          <div className="lg:col-span-2">
            <HandStrip view={view} act={act} art={art} you={you} />
          </div>
        )}
        {shown === 'me' && (
          <div className="flex min-w-0 flex-col gap-2" {...tabPanelProps(PLAY_TABS_ID, 'me')}>
            {inGame ? (
              <>
                <Notebook view={view} you={you} art={art} />
                {handStage && !handOnTable && (
                  <HandStrip view={view} act={act} art={art} you={you} />
                )}
              </>
            ) : (
              <ScoreList view={view} you={you} art={art} />
            )}
          </div>
        )}
        {shown === 'scores' && (
          <div className="flex min-w-0 flex-col gap-3" {...tabPanelProps(PLAY_TABS_ID, 'scores')}>
            <ScoreList view={view} you={you} art={art} />
            <HostTools view={view} room={room} act={act} art={art} name={name} />
          </div>
        )}
      </div>
      {shown !== null && (
        <TabBar
          id={PLAY_TABS_ID}
          label="Red Herring"
          items={inGame ? PLAY_TABS : PLAY_TABS.filter((t) => t.id !== 'me')}
          value={!inGame && tab === 'me' ? 'table' : tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
    </>
  );
}

const atZeroOf = (stage: string) =>
  stage === 'discuss'
    ? 'then the vote starts'
    : stage === 'vote'
      ? 'then a random vote is cast'
      : 'then a random card is played';

function stagePanel(p: PartProps): ReactNode {
  const r = p.view.game!.round;
  switch (r.stage) {
    case 'word':
      return r.picker === p.room.you ? <WordForm view={p.view} act={p.act} art={p.art} /> : null;
    case 'discuss':
      return <Discuss {...p} />;
    case 'vote':
      return <Ballot {...p} />;
    case 'reveal':
      return <Reveal {...p} />;
    default:
      return null;
  }
}

/** The talk step: the word for everyone, a few lines on what to do, and the host's button. */
function Discuss({ view, room, act }: PartProps) {
  const word = view.game!.round.word;
  return (
    <Panel className="flex flex-col gap-2 text-sm" data-testid="rh-discuss">
      {word && (
        <p>
          The word: <strong className="font-serif text-lg italic">{word}</strong>
        </p>
      )}
      <p className="font-semibold">💬 Talk it over</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-ink-muted">
        <li>Each player says why they played their two cards.</li>
        <li>Then talk it over: who had nothing to go on?</li>
      </ol>
      {room.isHost && (
        <StickyBar fixed refusal="rh-discuss">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => void act({ type: 'end-discussion' }, { anchor: 'rh-discuss' })}
          >
            Start the vote
          </Button>
        </StickyBar>
      )}
    </Panel>
  );
}

/** The host's helpers: Act for someone the table waits on, take out someone who dropped out. */
function HostTools({ view, room, act, name }: PartProps) {
  const r = view.game!.round;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  const waiting = waitingIds(view);
  if (view.phase !== 'playing') return null;
  // The status line already tells the viewer it's their move: name only the others.
  const others = waiting.filter((id) => id !== room.you);
  const line = others.length ? waitingFor(others, room.players) : '';
  if (!room.isHost) return line ? <p className="text-xs text-ink-muted">{line}</p> : null;
  const late = r.deadline !== null && now + room.clockOffset >= r.deadline;
  const offline = (id: PlayerId) => room.players.find((p) => p.id === id)?.connected === false;
  // The word is never written for anyone.
  const actable = r.stage === 'word' ? [] : waiting;
  const left = new Set(view.game!.players.filter((p) => p.left).map((p) => p.id));
  const dropped = view.game!.players.filter((p) => !p.left && offline(p.id)).map((p) => p.id);
  const showAct = actable.filter((id) => late || offline(id));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      {line && <span>{line}</span>}
      {showAct
        .filter((id) => !left.has(id))
        .map((id) => (
          <Button
            key={`a-${id}`}
            variant="secondary"
            size="sm"
            onClick={() => void act({ type: 'act-for', player: id }, { anchor: 'rh-host' })}
          >
            Act for {name(id)}
          </Button>
        ))}
      {dropped.map((id) => (
        <Button
          key={`r-${id}`}
          variant="ghost"
          size="sm"
          onClick={() => void act({ type: 'remove', player: id }, { anchor: 'rh-host' })}
        >
          Take {name(id)} out
        </Button>
      ))}
      <RefusalSlot anchor="rh-host" />
    </div>
  );
}

/** Points so far, best first. */
export function ScoreList({ view, you, art }: { view: RedHerringView; you: string; art: Art }) {
  const g = view.game!;
  if (view.settings.scoring === 'fun')
    return (
      <Panel className="text-sm text-ink-muted" data-testid="rh-score-list">
        Just for fun: no points this game.
      </Panel>
    );
  const sorted = [...g.players].sort((a, b) => b.score - a.score || b.tokens - a.tokens);
  return (
    <Panel className="flex flex-col gap-1 text-sm" data-testid="rh-score-list">
      <h3 className="flex items-center gap-1 font-semibold">
        {art.vp['5'] ? (
          <img src={art.vp['5']} alt="" className="size-5" />
        ) : (
          <span aria-hidden>🪙</span>
        )}
        Scores
      </h3>
      <ol className="flex flex-col">
        {sorted.map((p) => (
          <li
            key={p.id}
            className={cn('flex justify-between gap-2', p.id === you && 'font-semibold')}
          >
            <span className="truncate">
              {p.name}
              {p.id === you && ' (you)'}
              {p.left && <span className="text-ink-muted"> · away</span>}
            </span>
            <span className="tabular-nums">{p.score}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function End({ view, room, act, art, name }: PartProps) {
  const g = view.game!;
  const fun = view.settings.scoring === 'fun';
  const wide = useWideScreen();
  const best = Math.max(...g.players.map((p) => p.score));
  const champs = g.players.filter((p) => p.score === best);
  const caught = g.history.filter((h) => h.caught).length;
  const buttons = room.isHost ? (
    <div className="flex flex-wrap justify-center gap-2">
      <Button
        size="lg"
        className="max-sm:flex-1"
        onClick={() => void act({ type: 'play-again' }, { anchor: 'rh-end' })}
      >
        Play again
      </Button>
      <Button
        variant="secondary"
        size="lg"
        onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'rh-end' })}
      >
        Change setup
      </Button>
    </div>
  ) : (
    <p className="text-small text-ink-muted">{waitingForHost(room, 'start the next game')}</p>
  );
  const rounds = (
    <section
      aria-label="Every round"
      className="flex flex-col gap-1 text-sm"
      data-testid="rh-rounds"
    >
      <h3 className="font-semibold">Every round</h3>
      <ol className="flex flex-col gap-1">
        {g.history.map((h) => (
          <li key={h.no} className="rounded-lg bg-panel px-2 py-1 ring-1 ring-line">
            <span className="font-semibold">
              {h.no}. “{h.word}”
            </span>{' '}
            <span className="text-ink-muted">
              by {name(h.picker)} · 🐟 {name(h.conspirator)} {h.caught ? 'caught' : 'got away'} (
              {h.against} {h.against === 1 ? 'vote' : 'votes'})
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
  // The last round's two key cards: the word-picker's, and the Conspirator's first card.
  const last = g.round;
  const firstOf = (id: PlayerId | undefined) =>
    id === undefined ? undefined : last.plays.find((p) => p.by === id && p.lap === 1);
  const pickerCard = firstOf(last.picker);
  const conspiratorCard = firstOf(last.result?.conspirator);
  const finale = [
    pickerCard && {
      key: 'word',
      card: pickerCard.card,
      caption: last.word
        ? `“${last.word}”, ${name(last.picker)}’s word`
        : `${name(last.picker)}’s card`,
    },
    conspiratorCard && {
      key: 'herring',
      card: conspiratorCard.card,
      caption: `🐟 ${name(conspiratorCard.by)} ${last.result?.caught ? 'caught' : 'got away'}`,
    },
  ].filter((x): x is { key: string; card: number; caption: string } => !!x);
  return (
    <div className="flex flex-col gap-3">
      <EndLayout
        hero={
          <EndHero
            emblem="🐟"
            eyebrow={fun ? null : undefined}
            title={
              fun
                ? 'Game over'
                : `${champs.map((p) => (p.id === room.you ? 'You' : p.name)).join(' and ')} ${champs.length > 1 || champs[0]?.id === room.you ? 'win' : 'wins'}!`
            }
            superlatives={wide ? room.superlatives : undefined}
            art={finale.map((f) => (
              <figure key={f.key} className="w-24 space-y-1 sm:w-28 lg:w-36 xl:w-40">
                <Card card={f.card} art={art} className="w-full shadow-vt-2" />
                <figcaption className="text-caption text-ink-2 lg:text-small">
                  {f.caption}
                </figcaption>
              </figure>
            ))}
            actions={
              <>
                {buttons}
                <RefusalSlot anchor="rh-end" />
              </>
            }
          >
            {caught} of {g.history.length} Conspirators caught
            {!fun && ` · ${best} ${best === 1 ? 'point' : 'points'} on top`}.
          </EndHero>
        }
      >
        <Panel className="flex flex-col gap-3 max-lg:p-3">
          <EndTabs
            columns
            tabs={[
              !fun && {
                id: 'scores',
                label: '🏆 Scores',
                content: (
                  <Standings
                    entries={g.players.map((p) => ({
                      id: p.id,
                      name: p.name,
                      score: p.score,
                      note: `scored in ${p.tokens} ${p.tokens === 1 ? 'round' : 'rounds'}`,
                    }))}
                    you={room.you}
                  />
                ),
              },
              { id: 'rounds', label: '🐟 Rounds', content: rounds },
              !wide &&
                !!room.superlatives?.length && {
                  id: 'awards',
                  label: '✨ Awards',
                  content: <Superlatives lines={room.superlatives} />,
                },
            ]}
          />
        </Panel>
      </EndLayout>
    </div>
  );
}
