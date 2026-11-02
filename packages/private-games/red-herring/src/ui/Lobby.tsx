import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  Switch,
  TimerSettings,
  cn,
  timersLine,
} from '@vt/ui';
import { useState } from 'react';
import { roundsFor, startProblem } from '../logic/game.ts';
import {
  DECK_CARDS,
  DECK_IDS,
  type DeckId,
  MAX_PLAYERS,
  MAX_TOPIC,
  type RedHerringAction,
  type RedHerringView,
  SCORINGS,
  type Scoring,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { DrawPile } from './Card.tsx';
import { RedHerringLobbySound } from './Sound.tsx';

type Act = (action: RedHerringAction, options?: { anchor?: string }) => Promise<boolean>;

const SCORING_NAME: Record<Scoring, string> = {
  rulebook: 'Rulebook',
  caught: 'Score only a catch',
  fun: 'Just for fun',
};
const SCORING_HELP: Record<Scoring, string> = {
  rulebook:
    'Each vote on the Conspirator scores 3; with fewer than 2, the Conspirator scores 5 and the word-picker 4.',
  caught:
    'As the rulebook, but Detectives score only when the Conspirator is caught (2 or more votes).',
  fun: 'No points: just the bluffing and the reveal.',
};

const DISCUSS_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No timer', value: null },
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '3 minutes', value: 180 },
  { label: '5 minutes', value: 300 },
];

export function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: RedHerringView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const s = view.settings;
  const seated = view.seats.filter((x) => x.playing);
  const watching = view.seats.filter((x) => !x.playing);
  const me = view.me;
  const host = room.isHost;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const blocker = startProblem({
    seats: Object.fromEntries(view.seats.map((x) => [x.id, x])),
    settings: s,
  });
  const set = (patch: Omit<Extract<RedHerringAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: 'rh-lobby' });
  const n = Math.max(seated.length, 4);
  const rounds = roundsFor(n, s.twice);
  const deckSize = DECK_IDS.filter((d) => s.decks[d]).reduce((n, d) => n + DECK_CARDS[d].length, 0);
  const deckLine = DECK_IDS.filter((d) => s.decks[d])
    .map((d) => art.decks[d])
    .join(' + ');
  const timers = {
    clueSeconds: s.turnSeconds,
    guessSeconds: s.talkSeconds,
    timerMode: s.timerMode,
  };
  return (
    <>
      <Hint tone={host && !blocker ? 'action' : 'neutral'}>
        {!me
          ? 'Watching the table.'
          : !me.playing
            ? 'You’re watching. Take a seat to play.'
            : blocker
              ? blocker
              : host
                ? 'Everyone’s here? Start the game.'
                : waitingForHost(room)}
      </Hint>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        <div className="flex gap-3">
          {art.lobby && (
            <ProtectedImage
              src={art.lobby}
              alt=""
              className="hidden h-44 w-24 shrink-0 rounded-xl object-cover sm:block"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <ul className="flex flex-col gap-1.5" aria-label="Seats">
              {seated.map((x) => (
                <li key={x.id} className="flex min-h-9 items-center gap-2">
                  <PlayerTag
                    name={x.name}
                    host={x.id === room.hostId}
                    you={x.id === room.you}
                    offline={offline(x.id)}
                    className="flex-1"
                  />
                  {x.id === room.you && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void act({ type: 'sit', playing: false })}
                    >
                      Stand up
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {watching.length > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                <span>Watching:</span>
                {watching.map((x) => (
                  <PlayerTag key={x.id} name={x.name} />
                ))}
              </p>
            )}
            {me && !me.playing && seated.length < MAX_PLAYERS && (
              <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
                Take a seat
              </Button>
            )}
            <div className="flex items-start gap-3">
              <DrawPile art={art} count={deckSize} className="flex-col gap-1 pt-1" />
              <p className="text-sm text-ink-muted">
                Everyone gets the secret word but one. Play pictures that fit it, explain them, and
                find the player bluffing blind.
              </p>
            </div>
          </div>
        </div>
      </Panel>
      <LobbySettings
        editable={host}
        summary={[
          deckLine,
          `${rounds} rounds`,
          s.openVote ? 'open vote' : 'secret vote',
          SCORING_NAME[s.scoring].toLowerCase(),
          s.noDiscussion && 'no discussion',
          s.balanced && 'balanced deal',
          s.topic && `topic: ${s.topic}`,
          timersLine(timers, { clue: 'turns', guess: 'explaining' }),
        ].filter((x): x is string => !!x)}
        className="space-y-4"
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Decks</legend>
          {DECK_IDS.map((d: DeckId) => (
            <Switch
              key={d}
              on={s.decks[d]}
              editable={host}
              title={`${art.decks[d]} (${DECK_CARDS[d].length})`}
              help={
                d === 'ours'
                  ? 'The picture cards from our other games, shuffled in. Every card shows this game’s back.'
                  : d === 'noir'
                    ? 'Darker, modern pictures that mix in well.'
                    : 'The original pictures.'
              }
              onChange={(on) => {
                set({ decks: { ...s.decks, [d]: on } });
              }}
              testId={`rh-deck-${d}`}
            />
          ))}
        </fieldset>
        <Switch
          on={s.twice}
          editable={host}
          title="Twice around"
          help={`Everyone picks the word twice (always so with 4 players). This table: ${rounds} rounds.`}
          onChange={(v) => {
            set({ twice: v });
          }}
          testId="rh-twice"
        />
        <Switch
          on={s.openVote}
          editable={host}
          title="Open vote in turn"
          help="The printed way: one at a time from the word-picker’s left, each vote shown as it is cast. Off: everyone votes in secret at once."
          onChange={(v) => {
            set({ openVote: v });
          }}
          testId="rh-open-vote"
        />
        <Switch
          on={s.noDiscussion}
          editable={host}
          title="No Discussion"
          help="Straight from the cards to the vote: the word isn’t said and nobody explains."
          onChange={(v) => {
            set({ noDiscussion: v });
          }}
          testId="rh-no-discussion"
        />
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">Scoring</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {SCORINGS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={s.scoring === k}
                disabled={!host}
                onClick={() => {
                  set({ scoring: k });
                }}
                className={cn(
                  'rounded-lg px-3 py-2 text-left ring-1 transition disabled:cursor-default',
                  s.scoring === k
                    ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500' // vt-palette
                    : 'ring-line hover:bg-panel disabled:hover:bg-transparent dark:ring-stone-700',
                )}
              >
                <span className="block text-sm font-semibold">{SCORING_NAME[k]}</span>
                <span className="block text-xs text-ink-muted">{SCORING_HELP[k]}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Switch
          on={s.balanced}
          editable={host}
          title="Balanced deal"
          help="The Conspirator is still secret and random, but everyone gets the role about equally."
          onChange={(v) => {
            set({ balanced: v });
          }}
          testId="rh-balanced"
        />
        <TopicField topic={s.topic} editable={host} onSave={(topic) => set({ topic })} />
        <TimerSettings
          values={timers}
          editable={host}
          clueLabel="Turn timer"
          clueHelp="Time for the word, each card and the vote."
          guessLabel="Explaining timer"
          guessHelp="Time for each player’s explanation."
          strictHelp="a random card is played, the explanation ends or a random vote is cast (the word is never written for anyone)"
          onChange={(patch) => {
            set({
              ...(patch.clueSeconds !== undefined && { turnSeconds: patch.clueSeconds }),
              ...(patch.guessSeconds !== undefined && { talkSeconds: patch.guessSeconds }),
              ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
            });
          }}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Discussion timer</span>
          <span className="text-xs text-ink-muted">
            The host ends the discussion; this is a reminder (strict: the vote starts).
          </span>
          <select
            value={s.discussSeconds ?? ''}
            disabled={!host}
            onChange={(e) => {
              set({ discussSeconds: e.target.value === '' ? null : Number(e.target.value) });
            }}
            className="min-h-11 rounded-lg bg-card px-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
          >
            {DISCUSS_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <RefusalSlot anchor="rh-lobby" />
      </LobbySettings>
      <RedHerringLobbySound view={view} room={room} act={act} art={art} />
      {host && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'rh-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="rh-start" />
        </StickyBar>
      )}
    </>
  );
}

/** The Thematic Game's topic: typed by the host, saved on Enter or leaving the field. */
function TopicField({
  topic,
  editable,
  onSave,
}: {
  topic: string;
  editable: boolean;
  onSave: (topic: string) => void;
}) {
  // The draft follows the room's topic whenever that changes.
  const [edit, setEdit] = useState({ from: topic, text: topic });
  const draft = edit.from === topic ? edit.text : topic;
  const setDraft = (text: string) => {
    setEdit({ from: topic, text });
  };
  const save = () => {
    if (draft.trim() !== topic) onSave(draft.trim());
  };
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">Thematic Game (topic)</span>
      <span className="text-xs text-ink-muted">
        Optional: every word must fit this topic (films, countries…). Leave it empty to play without
        one.
      </span>
      <input
        value={draft}
        maxLength={MAX_TOPIC}
        readOnly={!editable}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
        placeholder="No topic"
        data-testid="rh-topic"
        className="min-h-11 rounded-lg bg-card px-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
      />
    </label>
  );
}
