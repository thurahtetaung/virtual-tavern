import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { cardSetChoices, useManifest as useReverieManifest } from '@vt/private-reverie/card';
import {
  Button,
  type Choice,
  ChoicePicker,
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
import { type ReactNode, useMemo, useState } from 'react';
import { cardsNeeded, poolOf, roundsFor, startProblem } from '../logic/game.ts';
import {
  MAX_PLAYERS,
  MAX_TOPIC,
  type RedHerringAction,
  type RedHerringView,
  OURS_PREFIX,
  SCORINGS,
  type Scoring,
  chosenSets,
  setById,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { DrawPile } from './Card.tsx';

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
  const reverie = useReverieManifest();
  const choices = useMemo(() => setChoices(art, reverie), [art, reverie]);
  const sets = chosenSets(s);
  const chosen = choices.filter((c) => sets.includes(c.id));
  const deckLine =
    chosen.length <= 2
      ? chosen.map((c) => c.name).join(' + ')
      : `${chosen.length} card sets (${chosen.reduce((t, c) => t + c.count, 0)} cards)`;
  const timers = {
    clueSeconds: s.turnSeconds,
    guessSeconds: s.discussSeconds,
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
              <DrawPile art={art} count={poolOf(s).length} className="flex-col gap-1 pt-1" />
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
          timersLine(timers, { clue: 'turns', guess: 'talk' }),
        ].filter((x): x is string => !!x)}
        className="space-y-4"
      >
        {host && <h3 className="text-lg font-bold">Game settings</h3>}
        <Group title="Cards" testId="rh-group-cards">
          <div data-testid="rh-sets">
            <ChoicePicker
              selectedIds={sets}
              choices={choices}
              editable={host}
              onSave={(ids) => act({ type: 'update-settings', sets: ids }, { anchor: 'rh-lobby' })}
              labels={{
                title: 'Picture cards',
                unit: 'cards',
                noun: 'set',
                change: 'Change card sets',
                summary: (picked, total) =>
                  `Playing with ${picked.length === 1 ? 'this set' : 'these sets'} (${total} cards; ${n} players need ${cardsNeeded(n, s.twice)}).`,
              }}
            />
          </div>
        </Group>
        <Group title="Rounds" testId="rh-group-rounds">
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
        </Group>
        <Group title="Talk and vote" testId="rh-group-vote">
          <Switch
            on={s.noDiscussion}
            editable={host}
            title="No Discussion"
            help="Straight from the cards to the vote: the word isn’t said and nobody talks it over."
            onChange={(v) => {
              set({ noDiscussion: v });
            }}
            testId="rh-no-discussion"
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
        </Group>
        <Group title="The Conspirator" testId="rh-group-conspirator">
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
        </Group>
        <Group title="Topic" testId="rh-group-topic">
          <TopicField topic={s.topic} editable={host} onSave={(topic) => set({ topic })} />
        </Group>
        <Group title="Timers" testId="rh-group-timers">
          <TimerSettings
            values={timers}
            editable={host}
            clueLabel="Turn timer"
            clueHelp="Time for the word, each card and the vote."
            guessLabel="Talk timer"
            guessHelp="Time to talk it over before the vote. The host starts the vote."
            strictHelp="a random card is played, the talk ends and the vote starts, or a random vote is cast (the word is never written for anyone)"
            onChange={(patch) => {
              set({
                ...(patch.clueSeconds !== undefined && { turnSeconds: patch.clueSeconds }),
                ...(patch.guessSeconds !== undefined && { discussSeconds: patch.guessSeconds }),
                ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
              });
            }}
          />
        </Group>
        <RefusalSlot anchor="rh-lobby" />
      </LobbySettings>
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
/** One group of lobby settings under its own heading. */
function Group({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} data-testid={testId} className="space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-bold tracking-wide text-ink-muted uppercase after:h-px after:flex-1 after:bg-line">
        {title}
      </h4>
      {children}
    </section>
  );
}

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

/** Every card set as a picker choice: the game's own decks, then each of our picture sets. */
function setChoices(art: Art, reverie: Parameters<typeof cardSetChoices>[0]): Choice[] {
  return [
    {
      id: 'base',
      name: art.decks.base,
      description: 'The original pictures.',
      count: setById('base')!.cards.length,
    },
    {
      id: 'noir',
      name: art.decks.noir,
      description: 'Darker, modern pictures that mix in well.',
      count: setById('noir')!.cards.length,
    },
    ...cardSetChoices(reverie).map((c) => ({
      ...c,
      id: OURS_PREFIX + c.id,
      description: c.description ?? 'Picture cards from our other games, with this game’s back.',
    })),
  ];
}
