import {
  type GameRoomInfo,
  type GameUiProps,
  lobbyStatus,
  playersNeeded,
  storageKey,
  waitingFor,
  waitingForHost,
  winnersTitle,
} from '@vt/game-sdk';
import {
  Button,
  ChoicePicker,
  Countdown,
  EndHero,
  EndTabs,
  FitArea,
  Fold,
  FoldSummary,
  GuideLink,
  Hint,
  Input,
  LobbySettings,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  Switch,
  TabBar,
  cn,
  tabPanelProps,
  useAbandonGame,
  useConfirm,
  usePhone,
  useSpectatorPrompt,
  useWideScreen,
} from '@vt/ui';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  type CardWord,
  type Guess,
  type IconicAction,
  type IconicView,
  LEVELS,
  LEVEL_LABELS,
  type Level,
  MAX_GUESS_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROUND_MINUTES,
  type SetId,
  WORDS_TO_END,
} from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { BoardView, ClueStrip, PAGE_BELOW, SetPicker, useRoomBelow } from './Board.tsx';
import { type NameOf, andList, statusFor } from './status.ts';

export type IconicUiProps = GameUiProps<IconicView, IconicAction>;
type Act = IconicUiProps['act'];

// vt-palette: the card's three levels, as printed (blue, red, grey).
const LEVEL_CHIP: Record<Level, string> = {
  easy: 'bg-sky-100 text-sky-900 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40', // vt-palette
  hard: 'bg-red-100 text-red-900 ring-red-300 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-500/40', // vt-palette
  challenging: 'bg-sunk text-ink ring-line-strong',
};

export function IconicGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: IconicUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
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

  const inGame = !!view.game?.order.includes(room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : view.me?.waiting
          ? { text: 'You’ll join at the next round.' }
          : view.phase === 'playing'
            ? {
                text: 'Join in at the next round.',
                action: () => void act({ type: 'sit', playing: true }),
                actionLabel: 'Join',
              }
            : { text: 'You can join from the next game.' }
      : null,
  );

  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-3',
        view.phase === 'playing' ? 'max-w-7xl' : 'max-w-5xl',
      )}
    >
      <IconicStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'over' ? (
            <End view={view} room={room} act={act} name={name} />
          ) : (
            <Play view={view} room={room} act={act} art={art} name={name} />
          )}
        </>
      )}
    </div>
  );
}

/** The few animations: pieces landing and the reveal. */
function IconicStyles() {
  return (
    <style>{`
@keyframes ic-pop { from { transform: scale(0.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
@keyframes ic-reveal { 0% { transform: scale(0.85) rotate(-2deg); opacity: 0 } 60% { transform: scale(1.06) rotate(1deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
.ic-pop { animation: ic-pop 180ms ease-out }
.ic-reveal { animation: ic-reveal 520ms cubic-bezier(.2,.9,.3,1.2) }
@media (prefers-reduced-motion: reduce) { .ic-pop, .ic-reveal { animation: none } }
`}</style>
  );
}

/** Desktop and wide tablets (Tailwind's `lg`): the board and the guesses side by side. */
const WIDE = '(min-width: 1024px)';

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const change = () => setWide(query.matches);
    query.addEventListener('change', change);
    return () => {
      query.removeEventListener('change', change);
    };
  }, []);
  return wide;
}

const TIPS_KEY = 'iconic.tips.v1';

/**
 * First-time tips for the clue team or the guessers, until dismissed (per seat in a playtest).
 * `compact` is the wide screen's: small print with Got it in its heading, so the column fits.
 */
function Tips({ view, you, compact }: { view: IconicView; you: string; compact?: boolean }) {
  const phone = usePhone();
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  const r = view.game!.round;
  if (seen || r.stage !== 'clue' || !view.game!.order.includes(you)) return null;
  const giving = r.givers.includes(you) || r.helper === you;
  const fold = !compact && phone;
  const gotIt = (
    <Button
      variant="ghost"
      size="sm"
      className={compact ? 'shrink-0' : 'self-end'}
      onClick={() => {
        try {
          localStorage.setItem(storageKey(TIPS_KEY), '1');
        } catch {
          // Storage blocked: the tips just close for now.
        }
        setSeen(true);
      }}
    >
      Got it
    </Button>
  );
  const lists = (
    <>
      {giving ? (
        <ul className={cn('list-disc pl-5', compact ? 'space-y-0.5' : 'space-y-1')}>
          <li>
            Put the green ? on the icon closest to your word, then cubes on icons that narrow it
            down.
          </li>
          <li>
            Tap an icon again to stack a cube (“very”, “many”). Long-press or right-click to take
            one off.
          </li>
          <li>A ! set is a separate idea. Mark guesses ✗, 🤏 close or ✓ as they come in.</li>
        </ul>
      ) : (
        <ul className={cn('list-disc pl-5', compact ? 'space-y-0.5' : 'space-y-1')}>
          <li>The strip at the top reads the clue: each coloured set is one idea.</li>
          <li>Guess as often as you like. 🤏 means you’re on the right track.</li>
          <li>Stuck? Tap Give up; when everyone has, the word is dropped.</li>
        </ul>
      )}
    </>
  );
  // Phones keep the play screen to one screen: the tips wait in a closed fold.
  if (fold)
    return (
      <Fold summary="New here? Three things to know" bodyClassName="flex flex-col gap-2 text-sm">
        {lists}
        {gotIt}
      </Fold>
    );
  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col rounded-2xl bg-info-soft text-info-ink ring-1 ring-info-line',
        compact ? 'gap-1 px-3 py-2 text-xs' : 'gap-2 px-4 py-3 text-sm',
      )}
    >
      {compact ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">New here? Three things to know</p>
          {gotIt}
        </div>
      ) : (
        <p className="font-semibold">New here? Three things to know</p>
      )}
      {lists}
      {!compact && gotIt}
    </aside>
  );
}

// ---- Lobby ----

function Choice<T extends string | number | null>({
  label,
  help,
  value,
  options,
  editable,
  onChange,
  testId,
}: {
  label: string;
  help?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  editable: boolean;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid={testId}>
      <legend className="text-sm font-semibold">{label}</legend>
      {help && <p className="text-xs text-ink-muted">{help}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map(([v, text]) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            disabled={!editable}
            onClick={() => onChange(v)}
            className={cn(
              // The lobbies' segmented choice: 44 px, the picked one ringed in the accent.
              'min-h-11 flex-1 basis-auto rounded-lg px-3 text-sm font-semibold ring-1 transition-colors disabled:cursor-default',
              value === v
                ? 'bg-accent-soft text-accent-text ring-2 ring-accent'
                : 'bg-panel text-ink ring-line enabled:hover:bg-sunk',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const LENGTHS = [
  ['twelve', `${WORDS_TO_END} words`],
  ['each', 'One word each'],
  ['endless', 'Endless'],
] as const;

function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const s = view.settings;
  const seated = view.seats.filter((x) => x.playing);
  const watching = view.seats.filter((x) => !x.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const set = (patch: Omit<Extract<IconicAction, { type: 'update-settings' }>, 'type'>) =>
    void act({ type: 'update-settings', ...patch }, { anchor: 'ic-lobby' });
  const pair = s.givers === 2 || (s.givers === 'auto' && seated.length >= 5);
  const blocker = seated.length < MIN_PLAYERS ? playersNeeded(MIN_PLAYERS, seated.length) : null;
  const listsOf = (level: Level) => view.wordLists.filter((l) => s.lists[level].includes(l.id));
  const noWords = LEVELS.find((l) => listsOf(l).length === 0);
  // The shared lobby line; a host who can't start yet reads why under Start game.
  const lobbyLine = !me
    ? { text: 'Watching the table.', me: false }
    : !me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : lobbyStatus(room, blocker);
  return (
    <>
      {lobbyLine && <Hint tone={lobbyLine.me ? 'action' : 'neutral'}>{lobbyLine.text}</Hint>}
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
        </div>
        <div className="flex gap-3">
          {art.box && (
            <ProtectedImage
              src={art.box}
              alt=""
              className="hidden h-28 w-auto shrink-0 rounded-lg object-contain sm:block"
            />
          )}
          <ul className="flex flex-1 flex-col gap-1.5" aria-label="Seats">
            {seated.map((x) => (
              <li key={x.id} className="flex items-center gap-2">
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
                    Watch instead
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
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
        <p className="text-sm text-ink-muted">
          Clue givers describe a secret word with pieces on a board of icons; everyone else guesses.{' '}
          {pair ? 'Two clue givers' : 'One clue giver'} per word.
        </p>
      </Panel>
      <GuideLink title={room.gameName ?? 'Iconic'} onClick={showGuide} />
      <LobbySettings
        editable={room.isHost}
        summary={[
          pair ? 'two clue givers' : 'one clue giver',
          LENGTHS.find(([k]) => k === s.length)![1].toLowerCase(),
          s.scoring ? (s.bonus ? 'scored, level bonus' : 'scored') : 'no score',
          s.roundMinutes === null
            ? 'no round clock'
            : `${s.roundMinutes} min ${s.timerMode === 'strict' ? 'strict clock' : 'reminder'}`,
        ]}
        className="space-y-4"
      >
        <Choice
          label="Clue givers per word"
          help="Two give clues together (the first pick is a proposal the partner agrees to or vetoes)."
          value={s.givers}
          options={[
            ['auto', 'Two from 5 players'],
            [1, 'One'],
            [2, 'Two'],
          ]}
          editable={room.isHost}
          onChange={(givers) => set({ givers })}
          testId="ic-givers"
        />
        <Choice
          label="Game length"
          help={
            s.length === 'twelve'
              ? `Ends once ${WORDS_TO_END} words have been guessed.`
              : s.length === 'each'
                ? 'Ends once every player has had a word of theirs guessed.'
                : 'Goes on until the host ends it.'
          }
          value={s.length}
          options={LENGTHS}
          editable={room.isHost}
          onChange={(length) => set({ length })}
          testId="ic-length"
        />
        <Switch
          on={s.scoring}
          editable={room.isHost}
          title="Scoring"
          help="First right guess 2 points, each clue giver 1. Off: just count the words each player guessed."
          onChange={(scoring) => set({ scoring })}
          testId="ic-scoring"
        />
        {s.scoring && (
          <Switch
            on={s.bonus}
            editable={room.isHost}
            title="Difficulty bonus"
            help="+1 for a Hard word and +2 for a Challenging one, to the guesser and each clue giver."
            onChange={(bonus) => set({ bonus })}
            testId="ic-bonus"
          />
        )}
        <Choice
          label="Round clock"
          help="A reminder by default: when it runs out the clue givers can invite a helper or pass."
          value={s.roundMinutes}
          options={[[null, 'Off'], ...ROUND_MINUTES.map((m) => [m, `${m} min`] as const)]}
          editable={room.isHost}
          onChange={(roundMinutes) => set({ roundMinutes })}
          testId="ic-clock"
        />
        {s.roundMinutes !== null && (
          <Switch
            on={s.timerMode === 'strict'}
            editable={room.isHost}
            title="Strict clock"
            help="The word is dropped when time runs out, and nobody scores."
            onChange={(v) => set({ timerMode: v ? 'strict' : 'soft' })}
            testId="ic-strict"
          />
        )}
        <div className="flex flex-col gap-3">
          {LEVELS.map((level) => (
            <ChoicePicker
              key={level}
              selectedIds={s.lists[level]}
              editable={room.isHost}
              choices={view.wordLists.map((l) => ({
                id: l.id,
                name: l.name,
                ...(l.description && { description: l.description }),
                count: l.wordCount,
              }))}
              labels={{
                title: `${LEVEL_LABELS[level]} words`,
                unit: 'words',
                noun: 'list',
                change: `Change ${LEVEL_LABELS[level]} lists`,
                // The word count is on the list's chip: the line doesn't repeat it.
                summary: (chosen) =>
                  chosen.length
                    ? `Each card has three ${LEVEL_LABELS[level]} words from ${chosen.length === 1 ? 'this list' : 'these lists'}.`
                    : 'No list chosen yet.',
              }}
              onSave={(ids) =>
                act({ type: 'update-settings', lists: { level, ids } }, { anchor: 'ic-lobby' })
              }
            />
          ))}
          {noWords && (
            <p className="text-sm text-warn-ink">
              No word list is tagged for this game yet: an admin can add some.
            </p>
          )}
        </div>
        <RefusalSlot anchor="ic-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'ic-start' })}
          >
            Start game
          </Button>
          {blocker && <p className="mt-1.5 text-caption text-ink-muted">{blocker}</p>}
          <RefusalSlot anchor="ic-start" />
        </StickyBar>
      )}
    </>
  );
}

// ---- In play ----

function Play({
  view,
  room,
  act,
  art,
  name,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const r = g.round;
  const target = view.settings.length === 'twelve' ? ` of ${WORDS_TO_END}` : '';
  const phone = usePhone();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-ink-muted">
        <span>
          Round {r.no} · Words guessed {g.wordsGuessed}
          {target}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span>Clues:</span>
          {r.givers.map((id) => (
            <PlayerTag key={id} name={name(id)} you={id === room.you} />
          ))}
          {r.helper && (
            <>
              <span>+ helper</span>
              <PlayerTag name={name(r.helper)} you={r.helper === room.you} />
            </>
          )}
        </span>
      </div>
      {r.stage === 'clue' ? (
        <Clue view={view} room={room} act={act} art={art} name={name} />
      ) : (
        // Phones: the stage takes the rest of the screen and scrolls inside when it must.
        <FitArea on={phone} resetKey={`${r.no}-${r.stage}`} className="flex flex-col gap-3">
          {r.stage === 'choose' && (
            <>
              <Choose view={view} room={room} act={act} name={name} />
              <Scores view={view} room={room} />
              {room.isHost && view.settings.length === 'endless' && <EndNow act={act} />}
            </>
          )}
          {r.stage === 'reveal' && (
            <Reveal
              view={view}
              room={room}
              art={art}
              name={name}
              aside={
                <>
                  <Scores view={view} room={room} />
                  {room.isHost && view.settings.length === 'endless' && <EndNow act={act} />}
                </>
              }
            />
          )}
        </FitArea>
      )}
    </>
  );
}

/** The host's way out of an endless game: straight to the final standings. */
function EndNow({ act }: { act: Act }) {
  const [confirm, dialog] = useConfirm();
  return (
    <div className="flex flex-col items-end">
      {dialog}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void (async () => {
            if (
              await confirm({
                title: 'End the game now?',
                body: 'Everyone goes to the final standings.',
                confirmLabel: 'End the game',
              })
            )
              void act({ type: 'end-game' }, { anchor: 'ic-endnow' });
          })()
        }
      >
        🏁 End the game
      </Button>
      <RefusalSlot anchor="ic-endnow" />
    </div>
  );
}

function WordCard({
  card,
  pick,
  chosen,
  proposed,
  onPick,
}: {
  card: CardWord[];
  pick?: number | null;
  chosen?: string | null;
  proposed?: number | null;
  onPick?: (i: number) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" data-testid="ic-card">
      {LEVELS.map((level) => (
        <div key={level} className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {LEVEL_LABELS[level]}
          </h4>
          {card.map((w, i) =>
            w.level !== level ? null : (
              <button
                key={i}
                type="button"
                disabled={!onPick}
                aria-pressed={pick === i}
                onClick={() => onPick?.(i)}
                className={cn(
                  'min-h-10 rounded-lg px-3 py-1.5 text-left text-sm font-semibold ring-1 transition disabled:cursor-default',
                  LEVEL_CHIP[level],
                  (pick === i || chosen === w.word) && 'ring-2 ring-accent',
                  proposed === i && 'outline-2 outline-offset-2 outline-dashed outline-accent',
                )}
              >
                {w.word}
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function Choose({
  view,
  room,
  act,
  name,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const r = view.game!.round;
  const [pick, setPick] = useState<number | null>(null);
  const card = r.card;
  const secret = r.secret;
  const isGiver = r.givers.includes(room.you);
  const pair = r.givers.length > 1;
  const partner = r.givers.find((id) => id !== room.you);
  const clock = (
    <Countdown
      deadline={r.chooseBy}
      clockOffset={room.clockOffset}
      label="to choose"
      soft
      expiredHint={
        room.isHost
          ? 'You can choose a word for them.'
          : 'Take your time, but the table is waiting.'
      }
    />
  );
  if (!isGiver || !card) {
    return (
      <Panel className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-semibold">
          {andList(r.givers.map(name))} {pair ? 'are' : 'is'} picking a word from their card
        </p>
        <p className="text-sm text-ink-muted">
          {waitingFor(r.givers, room.players, { you: room.you })}
        </p>
        {clock}
        {room.isHost && r.reminded && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void act({ type: 'act-for' }, { anchor: 'ic-choose' })}
          >
            Choose a word for them
          </Button>
        )}
        <RefusalSlot anchor="ic-choose" />
      </Panel>
    );
  }
  const proposal = secret?.proposal ?? null;
  const theirProposal = proposal && proposal.by !== room.you;
  const mustWait =
    (proposal && proposal.by === room.you) || (secret?.picker && secret.picker !== room.you);
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">Your card: pick the secret word</h3>
        {clock}
      </div>
      <WordCard
        card={card}
        pick={theirProposal || mustWait ? null : pick}
        proposed={proposal?.index ?? null}
        {...(!theirProposal && !mustWait && { onPick: setPick })}
      />
      {theirProposal ? (
        <div className="flex flex-col gap-2 rounded-xl bg-accent-soft p-3 ring-1 ring-accent-line">
          <p>
            {name(proposal.by)} proposes <b>“{card[proposal.index]!.word}”</b>.
            {(secret?.vetoes ?? 0) > 0 && ' This is the second pick: a veto keeps it anyway.'}
          </p>
          <StickyBar fixed refusal="ic-choose" refusalKey={`${r.no}`}>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void act({ type: 'agree' }, { anchor: 'ic-choose' })}>
                Agree
              </Button>
              <Button
                variant="secondary"
                onClick={() => void act({ type: 'veto' }, { anchor: 'ic-choose' })}
              >
                {(secret?.vetoes ?? 0) > 0 ? 'Veto (it stands)' : 'Veto: I’ll pick'}
              </Button>
            </div>
          </StickyBar>
        </div>
      ) : mustWait ? (
        <p className="text-sm text-ink-muted">
          {proposal
            ? `Waiting for ${name(partner)} to agree or veto.`
            : `${name(partner)} picks now.`}
        </p>
      ) : (
        <StickyBar fixed refusal="ic-choose" refusalKey={`${r.no}`}>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pick === null}
              onClick={() => {
                if (pick === null) return;
                void act({ type: 'pick', index: pick }, { anchor: 'ic-choose' });
                setPick(null);
              }}
            >
              {pick === null
                ? 'Tap a word'
                : pair
                  ? `Propose “${card[pick]!.word}”`
                  : `Give clues for “${card[pick]!.word}”`}
            </Button>
            <Button
              variant="secondary"
              disabled={!!secret?.rerolled}
              onClick={() => {
                setPick(null);
                void act({ type: 'reroll' }, { anchor: 'ic-choose' });
              }}
            >
              {secret?.rerolled ? 'New card used' : '🔄 New card (once)'}
            </Button>
          </div>
        </StickyBar>
      )}
      {mustWait && !theirProposal && <RefusalSlot anchor="ic-choose" resetKey={`${r.no}`} />}
    </Panel>
  );
}

function Clue({
  view,
  room,
  act,
  art,
  name,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const r = view.game!.round;
  const inTeam = r.givers.includes(room.you) || r.helper === room.you;
  const isGiver = r.givers.includes(room.you);
  const [chosenSet, setActive] = useState<SetId>('main');
  const [tab, setTab] = useState<ClueTab>(inTeam ? 'board' : 'guesses');
  const [confirm, dialog] = useConfirm();
  // Back to the main set whenever its marker is off the board (a wipe, a new word).
  const active: SetId = r.board.main.marker !== null ? chosenSet : 'main';
  const unjudged = r.guesses.filter((x) => x.mark === null).length;
  const answer = r.secret?.answer?.word;
  const wide = useWide();
  const clock = (
    <Countdown
      deadline={r.clueBy}
      clockOffset={room.clockOffset}
      label="on the clock"
      {...(view.settings.timerMode === 'strict'
        ? { atZero: 'then the word is dropped' }
        : {
            soft: true,
            expiredHint: isGiver
              ? 'Time’s up: invite a helper, or pass.'
              : 'Time’s up: the clue givers may ask a helper.',
          })}
    />
  );
  const controls = inTeam && (
    <div className="flex flex-col gap-2 rounded-xl bg-panel p-2 ring-1 ring-line">
      <p className="text-sm">
        Your word: <b data-testid="ic-answer">“{answer}”</b>
        <span className="ml-1 text-xs text-ink-muted">
          ({LEVEL_LABELS[r.secret!.answer!.level]})
        </span>
      </p>
      <SetPicker board={r.board} active={active} onPick={setActive} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void act({ type: 'wipe' }, { anchor: 'ic-board' })}
        >
          🧹 Wipe the board
        </Button>
        {isGiver && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void (async () => {
                if (
                  await confirm({
                    title: 'Pass on this word?',
                    body: 'The word is dropped and nobody scores. The next clue givers take over.',
                    confirmLabel: 'Pass',
                  })
                )
                  void act({ type: 'pass' }, { anchor: 'ic-board' });
              })()
            }
          >
            Pass
          </Button>
        )}
        {isGiver && r.helperOpen && <InviteHelper view={view} room={room} act={act} name={name} />}
      </div>
      <p className="text-xs text-ink-muted">
        Tap an icon to place; tap again to stack; long-press or right-click to take one off.
      </p>
      <RefusalSlot anchor="ic-board" />
    </div>
  );
  const boardView = (
    <BoardView
      board={r.board}
      art={art}
      active={inTeam ? active : null}
      {...(inTeam && {
        onPlace: (icon: number) =>
          void act({ type: 'place', set: active, icon }, { anchor: 'ic-board' }),
        onRemove: (icon: number) =>
          void act({ type: 'remove', set: active, icon }, { anchor: 'ic-board' }),
      })}
    />
  );
  const guesses = (
    <Guesses view={view} room={room} act={act} name={name} confirm={confirm} withForm={wide} />
  );
  if (wide)
    // Wide screens: the whole board on the left, sized to the window, and everything else beside
    // it in a column of the same height, where the guess list takes what's left and scrolls.
    return (
      <>
        {dialog}
        <FillWindow className="grid min-h-80 grid-cols-[minmax(0,1fr)_22rem] items-start gap-3">
          <Panel className="p-3">{boardView}</Panel>
          <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
            <div className="flex shrink-0 justify-end">{clock}</div>
            <Tips view={view} you={room.you} compact />
            <ClueStrip board={r.board} art={art} />
            {controls}
            <Panel className="flex min-h-40 flex-1 flex-col gap-2 p-3">{guesses}</Panel>
            <div className="flex shrink-0 flex-col gap-2">
              <Scores view={view} room={room} />
              {room.isHost && view.settings.length === 'endless' && <EndNow act={act} />}
            </div>
          </div>
        </FillWindow>
      </>
    );
  return (
    <>
      {dialog}
      <Tips view={view} you={room.you} />
      <div className="flex justify-end">{clock}</div>
      <ClueStrip board={r.board} art={art} />
      <Panel
        className={cn('flex flex-col gap-2 p-3', tab !== 'board' && 'hidden')}
        {...tabPanelProps(CLUE_TABS_ID, 'board')}
      >
        {controls}
        {/* Phones: the icons take what the screen has left and scroll inside it. */}
        <FitArea phone plain min={128}>
          {boardView}
        </FitArea>
      </Panel>
      <Panel
        className={cn('flex flex-col gap-2 p-3', tab !== 'guesses' && 'hidden')}
        {...tabPanelProps(CLUE_TABS_ID, 'guesses')}
      >
        {guesses}
      </Panel>
      <div
        className={cn('flex flex-col gap-2', tab !== 'scores' && 'hidden')}
        {...tabPanelProps(CLUE_TABS_ID, 'scores')}
      >
        <Scores view={view} room={room} open />
        {room.isHost && view.settings.length === 'endless' && <EndNow act={act} />}
      </div>
      {isGuessing(view, room.you) && <GuessForm view={view} act={act} />}
      <TabBar
        id={CLUE_TABS_ID}
        label="View"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'board', label: 'Board', icon: 'layout-grid' },
          {
            id: 'guesses',
            label: `Guesses (${r.guesses.length})`,
            icon: 'message-circle',
            // The clue givers see how many guesses wait for their judgement.
            badge: isGiver ? unjudged : 0,
          },
          { id: 'scores', label: 'Scores', icon: 'list-ordered' },
        ]}
      />
    </>
  );
}

/** The phone tabs while clues are given. */
type ClueTab = 'board' | 'guesses' | 'scores';
const CLUE_TABS_ID = 'iconic-clue';

/** A box as tall as the window below its top, so the page under it never scrolls. */
function FillWindow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { height } = useRoomBelow(ref, PAGE_BELOW);
  return (
    <div ref={ref} className={className} style={height ? { height } : undefined}>
      {children}
    </div>
  );
}

function InviteHelper({
  view,
  room,
  act,
  name,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const [open, setOpen] = useState(false);
  const r = view.game!.round;
  const options = view.game!.order.filter((id) => !r.givers.includes(id));
  if (!open)
    return (
      <Button variant="soft" size="sm" onClick={() => setOpen(true)}>
        🙋 Invite a helper
      </Button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      <span className="text-sm">Who helps?</span>
      {options.map((id) => (
        <Button
          key={id}
          variant="secondary"
          size="sm"
          onClick={() => {
            setOpen(false);
            void act({ type: 'invite', player: id }, { anchor: 'ic-board' });
          }}
        >
          {name(id)}
          {room.players.find((p) => p.id === id)?.connected === false ? ' (offline)' : ''}
        </Button>
      ))}
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

const MARK_TEXT = { wrong: '✗', close: '🤏 close' } as const;

/** Whether `you` types guesses this word (not a clue giver or the helper). */
const isGuessing = (view: IconicView, you: string) => {
  const g = view.game!;
  const r = g.round;
  return g.order.includes(you) && !r.givers.includes(you) && r.helper !== you;
};

/**
 * The guess box and Guess, with its refusal: in the sticky bar on phones (so the board stays in
 * view), in place in the guesses column on wider screens.
 */
function GuessForm({ view, act }: { view: IconicView; act: Act }) {
  const r = view.game!.round;
  const [text, setText] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (await act({ type: 'guess', text: t }, { anchor: 'ic-guess' })) setText('');
  };
  return (
    <StickyBar fixed refusal="ic-guess" refusalKey={`${r.no}`}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_GUESS_LENGTH}
          enterKeyHint="send"
          autoComplete="off"
          autoCapitalize="none"
          aria-label="Your guess"
          placeholder="Type a guess…"
          className="flex-1"
        />
        <Button type="submit" size="lg" disabled={!text.trim()}>
          Guess
        </Button>
      </form>
    </StickyBar>
  );
}

function Guesses({
  view,
  room,
  act,
  name,
  confirm,
  withForm,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
  confirm: ReturnType<typeof useConfirm>[0];
  /** The guess box here (wide screens); phones keep it in the sticky bar under both tabs. */
  withForm: boolean;
}) {
  const g = view.game!;
  const r = g.round;
  const isGiver = r.givers.includes(room.you);
  const guessing = isGuessing(view, room.you);
  const gaveUp = r.gaveUp.includes(room.you);
  const list = useRef<HTMLOListElement>(null);
  const flagged = new Set(r.secret?.looksRight ?? []);
  const award = r.secret?.award ?? null;
  const count = r.guesses.length;
  // Follow new guesses only while the list is already at the bottom, so nothing being judged jumps.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [count]);
  const guessers = g.order.filter((id) => !r.givers.includes(id) && id !== r.helper);
  return (
    <>
      {award && isGiver && (
        <AwardBanner
          guess={r.guesses.find((x) => x.id === award.guess)}
          until={award.until}
          room={room}
          name={name}
          onUndo={() => void act({ type: 'undo' }, { anchor: 'ic-guesses' })}
        />
      )}
      <ol
        ref={list}
        aria-label="Guesses"
        className="flex max-h-[45vh] min-h-24 flex-col gap-1 overflow-y-auto lg:max-h-none lg:min-h-12 lg:flex-1"
        data-testid="ic-guesses"
      >
        {r.guesses.length === 0 && (
          <li className="py-4 text-center text-sm text-ink-muted">No guesses yet.</li>
        )}
        {r.guesses.map((x) => (
          <GuessRow
            key={x.id}
            guess={x}
            name={name}
            you={room.you}
            judge={isGiver && !award}
            flagged={flagged.has(x.id)}
            pending={award?.guess === x.id}
            act={act}
            confirm={confirm}
          />
        ))}
      </ol>
      <RefusalSlot anchor="ic-guesses" />
      {guessing && withForm && <GuessForm view={view} act={act} />}
      {guessing && (
        <Button
          variant={gaveUp ? 'secondary' : 'ghost'}
          size="sm"
          className="self-start"
          onClick={() => void act({ type: 'give-up', on: !gaveUp }, { anchor: 'ic-guess' })}
        >
          {gaveUp ? '↩︎ Take back my give-up' : '🏳️ Give up on this word'}
        </Button>
      )}
      <p className="text-xs text-ink-muted">
        {r.gaveUp.length
          ? `Gave up: ${andList(r.gaveUp.map((id) => (id === room.you ? 'you' : name(id))))} (${r.gaveUp.length} of ${guessers.length}). The word is dropped once everyone has.`
          : 'If every guesser gives up, the word is dropped.'}
      </p>
    </>
  );
}

function GuessRow({
  guess,
  name,
  you,
  judge,
  flagged,
  pending,
  act,
  confirm,
}: {
  guess: Guess;
  name: NameOf;
  you: string;
  judge: boolean;
  flagged: boolean;
  pending: boolean;
  act: Act;
  confirm: ReturnType<typeof useConfirm>[0];
}) {
  const mark = (m: 'wrong' | 'close' | null) =>
    void act(
      { type: 'mark', guess: guess.id, mark: guess.mark === m ? null : m },
      { anchor: 'ic-guesses' },
    );
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1 text-sm',
        flagged && 'bg-success-soft ring-1 ring-success-line',
        pending && 'ring-2 ring-success',
        guess.mark === 'wrong' && 'opacity-60',
      )}
      data-guess={guess.id}
    >
      <span className="w-16 shrink-0 truncate text-xs text-ink-muted">
        {guess.by === you ? 'You' : name(guess.by)}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 break-words font-medium',
          guess.mark === 'wrong' && 'line-through',
        )}
      >
        {guess.text}
      </span>
      {flagged && judge && (
        <span className="text-xs font-semibold text-success-ink">looks right</span>
      )}
      {judge ? (
        <span className="flex shrink-0 gap-1">
          <MarkButton
            label="✗"
            title="Wrong"
            on={guess.mark === 'wrong'}
            onClick={() => mark('wrong')}
          />
          <MarkButton
            label="🤏"
            title="Close"
            on={guess.mark === 'close'}
            onClick={() => mark('close')}
          />
          <MarkButton
            label="✓"
            title="Right"
            on={false}
            onClick={() =>
              void (async () => {
                if (
                  await confirm({
                    title: `Award “${guess.text}” to ${name(guess.by)}?`,
                    body: 'It counts in 5 seconds; you can still undo until then.',
                    confirmLabel: 'Yes, that’s it',
                  })
                )
                  void act({ type: 'award', guess: guess.id }, { anchor: 'ic-guesses' });
              })()
            }
            right
          />
        </span>
      ) : (
        guess.mark && (
          <span className="shrink-0 text-xs font-semibold text-ink-muted">
            {MARK_TEXT[guess.mark]}
          </span>
        )
      )}
    </li>
  );
}

function MarkButton({
  label,
  title,
  on,
  onClick,
  right,
}: {
  label: string;
  title: string;
  on: boolean;
  onClick: () => void;
  right?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-lg text-base font-bold ring-1 transition-colors',
        on ? 'bg-accent-soft ring-accent' : 'bg-card ring-line hover:bg-panel',
        right && 'ml-1 text-success-ink ring-success-line',
      )}
    >
      {label}
    </button>
  );
}

function AwardBanner({
  guess,
  until,
  room,
  name,
  onUndo,
}: {
  guess: Guess | undefined;
  until: number;
  room: GameRoomInfo;
  name: NameOf;
  onUndo: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-sm ring-1 ring-success-line">
      <span className="flex-1">
        ✓ <b>“{guess?.text}”</b> by {name(guess?.by)} counts in a moment.
      </span>
      <Countdown deadline={until} clockOffset={room.clockOffset} label="to undo" />
      <Button variant="secondary" size="sm" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

function Reveal({
  view,
  room,
  art,
  name,
  aside,
}: {
  view: IconicView;
  room: GameRoomInfo;
  art: Art;
  name: NameOf;
  /** The scores (and the host's End now) that follow the result. */
  aside: ReactNode;
}) {
  const wide = useWide();
  const r = view.game!.round;
  const res = r.result!;
  const points = Object.entries(res.points);
  const why: Record<string, string> = {
    pass: 'The clue givers passed.',
    'gave-up': 'Everyone gave up.',
    timer: 'Time ran out.',
    left: 'A clue giver left.',
  };
  const body = (
    <>
      <Panel
        className="ic-reveal flex flex-col items-center gap-2 text-center"
        data-testid="ic-reveal"
      >
        <p className="text-sm uppercase tracking-wide text-ink-muted">
          The word was · {LEVEL_LABELS[res.level]}
        </p>
        <p className="font-display text-3xl font-black lg:text-5xl">“{res.word}”</p>
        {res.outcome === 'guessed' ? (
          <p>
            🎉 {res.guesser === room.you ? 'You' : name(res.guesser)} guessed it
            {res.ms > 0 && ` in ${Math.round(res.ms / 1000)} s`}
            {points.length > 0 &&
              `: ${points.map(([id, n]) => `${id === room.you ? 'you' : name(id)} +${n}`).join(', ')}`}
          </p>
        ) : (
          <p>Nobody scores. {why[res.how]}</p>
        )}
        <Countdown
          deadline={res.until}
          clockOffset={room.clockOffset}
          label="to the next word"
          soft
          expiredLabel="Next word…"
          expiredHint="The next clue givers are up."
        />
        {r.card && (
          <details className="w-full text-left">
            <FoldSummary className="px-0 text-ink-muted">The whole card</FoldSummary>
            <div className="mt-2">
              <WordCard card={r.card} chosen={res.word} />
            </div>
          </details>
        )}
      </Panel>
      <ClueStrip board={r.board} art={art} />
    </>
  );
  // Wide screens: the finished board stays on the left as it was during the clues, the word and
  // its result beside it, so the reveal reads against the clues that led to it.
  if (wide)
    return (
      <FillWindow className="grid min-h-80 grid-cols-[minmax(0,1fr)_22rem] items-start gap-3">
        <Panel className="p-3">
          <BoardView board={r.board} art={art} active={null} />
        </Panel>
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto">
          {body}
          {aside}
        </div>
      </FillWindow>
    );
  return (
    <>
      {body}
      {aside}
    </>
  );
}

function Scores({ view, room, open }: { view: IconicView; room: GameRoomInfo; open?: boolean }) {
  const g = view.game!;
  const scoring = view.settings.scoring;
  const rows = g.players
    .filter((p) => g.order.includes(p.id))
    .map((p) => ({ ...p, value: scoring ? p.score : p.guessed }))
    .sort((a, b) => b.value - a.value);
  return (
    <details className="rounded-xl bg-panel text-sm ring-1 ring-line" open={open}>
      <FoldSummary className="font-semibold">{scoring ? 'Scores' : 'Words guessed'}</FoldSummary>
      <ul className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2">
            <PlayerTag name={p.name} you={p.id === room.you} className="min-w-0 truncate" />
            <span className="font-semibold tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

// ---- End ----

function End({
  view,
  room,
  act,
  name,
}: {
  view: IconicView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const g = view.game!;
  const scoring = view.settings.scoring;
  const wide = useWideScreen();
  const entries = g.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: scoring ? p.score : p.guessed,
  }));
  const title = winnersTitle(entries, room.you) || 'Game over';
  return (
    <div className="flex flex-col gap-3">
      <EndHero
        title={title}
        eyebrow={title === 'Game over' ? null : undefined}
        emblem="💡"
        superlatives={wide ? room.superlatives : undefined}
        actions={
          <>
            {room.isHost ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  size="lg"
                  onClick={() => void act({ type: 'play-again' }, { anchor: 'ic-end' })}
                >
                  Play again
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'ic-end' })}
                >
                  Change setup
                </Button>
              </div>
            ) : (
              <Hint>{waitingForHost(room, 'start the next game')}</Hint>
            )}
            <RefusalSlot anchor="ic-end" />
          </>
        }
      />
      <Panel className="ic-reveal flex flex-col gap-3 max-lg:p-3">
        <EndTabs
          columns
          tabs={[
            {
              id: 'scores',
              label: '🏆 Scores',
              content: (
                <Standings
                  entries={g.players.map((p) => ({
                    id: p.id,
                    name: p.name,
                    score: scoring ? p.score : p.guessed,
                    note: `guessed ${p.guessed} · ${p.given} of theirs guessed`,
                  }))}
                  you={room.you}
                  {...(!scoring && {
                    scoreLabel: (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`,
                  })}
                />
              ),
            },
            {
              id: 'words',
              label: '💬 Every word',
              content: (
                <section aria-label="Every word" className="flex flex-col gap-1 text-sm">
                  <h3 className="font-semibold">Every word</h3>
                  <ol className="flex flex-col gap-0.5">
                    {g.history.map((h) => (
                      <li key={h.no} className="flex flex-wrap gap-x-2">
                        <span className="font-semibold">“{h.word}”</span>
                        <span className="text-ink-muted">
                          {h.outcome === 'guessed'
                            ? `${name(h.guesser)} guessed it, clues by ${andList(h.givers.map(name))}`
                            : `dropped (clues by ${andList(h.givers.map(name))})`}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ),
            },
            !wide &&
              !!room.superlatives?.length && {
                id: 'awards',
                label: '✨ Awards',
                content: <Superlatives lines={room.superlatives} />,
              },
          ]}
        />
      </Panel>
    </div>
  );
}
