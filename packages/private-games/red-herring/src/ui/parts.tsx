import { type GameRoomInfo, type PlayerId, storageKey, waitingFor } from '@vt/game-sdk';
import {
  Button,
  CardViewer,
  Input,
  StickyBar,
  Panel,
  Peek,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  type ViewerItem,
  cn,
  useConfirm,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  MAX_WORD,
  POINTS,
  type Play,
  type RedHerringAction,
  type RedHerringView,
} from '../logic/types.ts';
import { type Art, cardLabel, cardUrl } from './assets.ts';
import { CARD_ASPECT, Card, EmptySlot } from './Card.tsx';
import type { NameOf } from './status.ts';
import { PhoneFill } from './fill.tsx';

type Act = (action: RedHerringAction, options?: { anchor?: string }) => Promise<boolean>;

interface PartProps {
  view: RedHerringView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}

const viewerItem = (card: number, caption?: string): ViewerItem => ({
  key: `card-${card}`,
  label: cardLabel(card),
  ...(caption && { caption }),
  aspect: CARD_ASPECT,
  src: cardUrl(card),
  fallback: (
    <span className="flex size-full items-center justify-center bg-card font-serif text-6xl font-bold text-ink">
      {card}
    </span>
  ),
});

// ---- The notebook ----

/**
 * Your notebook: hold to read it. The word-picker's shows their own word; a Detective's the word and
 * that they're a Detective; the Conspirator's says so instead of a word. Every page has the same
 * cover, size and gestures, so a glance at someone's screen shows nothing.
 */
export function Notebook({ view, you, art }: { view: RedHerringView; you: string; art: Art }) {
  const r = view.game!.round;
  const picker = r.picker === you;
  const word = picker ? r.word : r.notebook ? r.notebook.word : undefined;
  if (word === undefined || (picker && word === null)) return null;
  const topic = view.settings.topic;
  const cover = (
    <span className="flex items-center gap-2">
      {art.notebookCover ? (
        <ProtectedImage
          src={art.notebookCover}
          alt=""
          className="h-11 w-8 shrink-0 rounded-sm object-cover shadow"
        />
      ) : (
        <span aria-hidden className="text-2xl">
          📓
        </span>
      )}
      <span className="text-sm font-semibold">{picker ? 'Your word' : 'Your notebook'}</span>
    </span>
  );
  return (
    <div data-testid="rh-notebook">
      <Peek what={picker ? 'your word' : 'your notebook'} cover={cover} inline>
        <div
          className="relative flex min-h-28 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-card px-4 py-3 text-center text-ink shadow-inner ring-1 ring-line"
          data-testid="rh-notebook-page"
        >
          {art.notebookPage && (
            <ProtectedImage
              src={art.notebookPage}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {topic && <span className="relative text-xs text-ink-muted">Topic: {topic}</span>}
          {word !== null ? (
            <span
              className="relative min-h-9 font-serif text-3xl font-bold break-words italic"
              data-testid="rh-word"
            >
              {word}
            </span>
          ) : (
            <span
              className="relative flex min-h-9 items-center font-serif text-2xl font-bold italic"
              data-testid="rh-conspirator"
            >
              You’re the Conspirator
            </span>
          )}
          {!picker && (
            <span className="relative text-[11px] text-ink-muted">
              {word !== null
                ? 'You’re a Detective: find who doesn’t know this word.'
                : 'You don’t know the word. Blend in with your cards and your explanation.'}
            </span>
          )}
        </div>
      </Peek>
    </div>
  );
}

// ---- The word ----

export function WordForm({ view, act, art }: { view: RedHerringView; act: Act; art: Art }) {
  const [word, setWord] = useState('');
  const r = view.game!.round;
  const first = r.plays[0];
  const clean = word.trim();
  const send = () => {
    if (clean) void act({ type: 'word', word: clean }, { anchor: 'rh-word' });
  };
  return (
    <Panel className="flex flex-col gap-2" data-testid="rh-word-form">
      <div className="flex gap-3">
        {first && (
          <div className="w-16 shrink-0">
            <Card card={first.card} art={art} eager />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <label htmlFor="rh-word-input" className="font-semibold">
            Your secret word
          </label>
          <p className="text-xs text-ink-muted">
            It should fit this card and another in your hand. One word plays best.
            {view.settings.topic && <> It must fit the topic: {view.settings.topic}.</>}
          </p>
        </div>
      </div>
      <StickyBar fixed refusal="rh-word">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Input
            id="rh-word-input"
            value={word}
            maxLength={MAX_WORD}
            autoComplete="off"
            autoCapitalize="sentences"
            onChange={(e) => {
              setWord(e.target.value);
            }}
            className="flex-1"
            placeholder="A word…"
          />
          <Button type="submit" size="lg" disabled={!clean}>
            Send
          </Button>
        </form>
      </StickyBar>
    </Panel>
  );
}

// ---- Private suspicion marks ----

type Mark = 'suspect' | 'trust';
const MARKS_KEY = 'red-herring.marks.v1';
const MARK_ICON: Record<Mark, string> = { suspect: '🤔', trust: '👍' };

function readMarks(roundKey: string): Record<string, Mark> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(MARKS_KEY)) ?? 'null') as {
      round?: string;
      marks?: Record<string, Mark>;
    } | null;
    return saved?.round === roundKey ? (saved.marks ?? {}) : {};
  } catch {
    return {};
  }
}

/** Your own marks on players this round, kept on this device only (per seat in a playtest). */
function useMarks(roundKey: string) {
  const [state, setState] = useState(() => ({ key: roundKey, marks: readMarks(roundKey) }));
  const marks = state.key === roundKey ? state.marks : readMarks(roundKey);
  const cycle = (id: string) => {
    setState((s) => {
      const current = s.key === roundKey ? s.marks : readMarks(roundKey);
      const now = current[id];
      const next: Record<string, Mark> = { ...current };
      if (!now) next[id] = 'suspect';
      else if (now === 'suspect') next[id] = 'trust';
      else delete next[id];
      try {
        localStorage.setItem(
          storageKey(MARKS_KEY),
          JSON.stringify({ round: roundKey, marks: next }),
        );
      } catch {
        // Storage blocked: the marks last until the page closes.
      }
      return { key: roundKey, marks: next };
    });
  };
  return [marks, cycle] as const;
}

// ---- The table ----

/** The cards on the table, by player in round order, each with their I and II. */
export function Table({
  view,
  room,
  art,
  name,
  focus,
}: Omit<PartProps, 'act'> & { focus?: PlayerId | null }) {
  const g = view.game!;
  const r = g.round;
  const you = room.you;
  const roundKey = `${g.history.length}|${r.no}|${r.picker}|${r.plays[0]?.card ?? ''}`;
  const [marks, cycle] = useMarks(roundKey);
  const [open, setOpen] = useState<number | null>(null);
  const plays = r.plays;
  const items = useMemo(
    () => plays.map((p) => viewerItem(p.card, `${name(p.by)} · card ${p.lap === 1 ? 'I' : 'II'}`)),
    [plays, name],
  );
  const many = r.order.length > 6;
  const left = new Set(g.players.filter((p) => p.left).map((p) => p.id));
  const color = (id: string) => room.players.find((p) => p.id === id)?.color;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const active = focus ?? r.turn;
  return (
    <section aria-label="The table" data-testid="rh-table">
      {/* Phones: the laps take what the screen has left and scroll inside it. */}
      <PhoneFill>
        <ul
          className={cn(
            'grid gap-1.5 sm:gap-2',
            many ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3',
          )}
        >
          {r.order.map((id) => {
            const mine = plays.filter((p) => p.by === id);
            const marker = art.marker(color(id));
            const mark = marks[id];
            return (
              <li
                key={id}
                data-testid={`rh-seat-${id}`}
                className={cn(
                  'flex min-w-0 flex-col gap-1 rounded-xl bg-card/85 p-1.5 ring-1 ring-line',
                  active === id && 'ring-2 ring-accent',
                )}
              >
                <div className="flex min-h-8 min-w-0 items-center gap-1 text-xs sm:text-sm">
                  {id === r.picker && (
                    <span title="Word-picker" aria-label="word-picker">
                      {art.pencil ? (
                        <ProtectedImage src={art.pencil} alt="" className="size-4" />
                      ) : (
                        '✏️'
                      )}
                    </span>
                  )}
                  <PlayerTag
                    name={name(id)}
                    you={id === you}
                    offline={offline(id)}
                    className="min-w-0 flex-1"
                  />
                  {left.has(id) && <span className="text-[11px] text-ink-muted">away</span>}
                  {id !== you && id !== r.picker && (
                    <button
                      type="button"
                      onClick={() => {
                        cycle(id);
                      }}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm ring-1 ring-line hover:bg-panel"
                      aria-label={`Your private mark on ${name(id)}: ${mark ?? 'none'}`}
                      title="Your private mark (only you see it)"
                    >
                      {mark ? MARK_ICON[mark] : <span className="text-ink-muted">·</span>}
                    </button>
                  )}
                </div>
                <div
                  className={cn(
                    'grid grid-cols-2 gap-1',
                    many ? 'max-w-[7.5rem]' : 'max-w-[10rem]',
                    'lg:max-w-[12rem]',
                  )}
                >
                  {([1, 2] as const).map((lap) => {
                    const p = mine.find((x) => x.lap === lap);
                    return p ? (
                      <Card
                        key={lap}
                        card={p.card}
                        art={art}
                        onClick={() => {
                          setOpen(plays.indexOf(p));
                        }}
                        label={`${name(id)}’s card ${lap === 1 ? 'I' : 'II'}: ${cardLabel(p.card)}, open full screen`}
                        className={cn(p.auto && 'opacity-90')}
                      />
                    ) : (
                      <EmptySlot key={lap} lap={lap} art={art} />
                    );
                  })}
                </div>
                {marker && (
                  <ProtectedImage
                    src={marker}
                    alt=""
                    className="h-1.5 w-full rounded-full object-cover opacity-80"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </PhoneFill>
      {open !== null && items.length > 0 && (
        <CardViewer
          items={items}
          start={Math.min(open, items.length - 1)}
          title="Cards on the table"
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

// ---- Your hand ----

export function HandStrip({
  view,
  act,
  art,
  you,
}: {
  view: RedHerringView;
  act: Act;
  art: Art;
  you: string;
}) {
  const g = view.game!;
  const r = g.round;
  const [open, setOpen] = useState<number | null>(null);
  const canPlay = (r.stage === 'card' || r.stage === 'play') && r.turn === you;
  const hand = g.hand;
  const items = useMemo(() => hand.map((c) => viewerItem(c)), [hand]);
  return (
    <section
      aria-label="Your hand"
      data-testid="rh-hand"
      className={cn(
        'rounded-xl p-1.5 ring-1',
        canPlay ? 'bg-accent-soft ring-accent-line' : 'bg-panel ring-line',
      )}
    >
      <p className="mb-1 px-1 text-xs font-semibold">
        {canPlay ? 'Your hand: tap a card to look, then play it' : 'Your hand (only you see it)'}
      </p>
      <ul className="grid grid-cols-6 gap-1 lg:max-w-xl">
        {hand.map((c, i) => (
          <li key={c}>
            <Card
              card={c}
              art={art}
              eager
              onClick={() => {
                setOpen(i);
              }}
              label={`${cardLabel(c)} in your hand${canPlay ? ': open to play' : ''}`}
            />
          </li>
        ))}
      </ul>
      <RefusalSlot anchor="rh-play" />
      {open !== null && items.length > 0 && (
        <CardViewer
          items={items}
          start={Math.min(open, items.length - 1)}
          title="Your hand"
          onClose={() => {
            setOpen(null);
          }}
          actions={(i) =>
            canPlay ? (
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  const card = hand[i];
                  setOpen(null);
                  if (card !== undefined) void act({ type: 'play', card }, { anchor: 'rh-play' });
                }}
              >
                Play this card
              </Button>
            ) : null
          }
        />
      )}
    </section>
  );
}

// ---- The vote ----

export function Ballot({ view, room, act, art, name }: PartProps) {
  const r = view.game!.round;
  const you = room.you;
  const [confirm, dialog] = useConfirm();
  const voter = r.order.slice(1).includes(you);
  const myTurn = voter && !r.myVote && (!view.settings.openVote || r.turn === you);
  const candidates = r.order.slice(1).filter((id) => id !== you);
  const counts: Record<string, number> = {};
  for (const t of Object.values(r.votes ?? {})) counts[t] = (counts[t] ?? 0) + 1;
  const waiting = r.order.slice(1).filter((id) => !r.voted.includes(id));
  const cardsOf = (id: string) =>
    r.plays.filter((p: Play) => p.by === id).sort((a, b) => a.lap - b.lap);
  return (
    <Panel className="flex flex-col gap-2" data-testid="rh-ballot">
      {dialog}
      <p className="font-semibold">
        🔍 {view.settings.openVote ? 'Vote in turn, in the open' : 'Secret vote'}
      </p>
      <p className="text-xs text-ink-muted">
        {r.myVote
          ? `You voted for ${name(r.myVote)}.`
          : voter
            ? 'Who had no word? Never yourself, never the word-picker.'
            : 'The word-picker doesn’t vote.'}{' '}
        {waiting.length ? waitingFor(waiting, room.players, { you }) : ''}
      </p>
      <ul className="flex flex-col gap-1">
        {candidates.map((id) => (
          <li key={id}>
            <button
              type="button"
              disabled={!myTurn}
              onClick={() => {
                void (async () => {
                  if (
                    await confirm({
                      title: `Accuse ${name(id)}?`,
                      body: 'Your vote can’t be changed.',
                      confirmLabel: 'Accuse',
                    })
                  )
                    await act({ type: 'vote', player: id }, { anchor: 'rh-vote' });
                })();
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl p-1.5 text-left ring-1 ring-line transition',
                myTurn ? 'hover:bg-panel' : 'cursor-default',
                r.myVote === id && 'ring-2 ring-accent',
              )}
              data-testid={`rh-accuse-${id}`}
              aria-label={`Accuse ${name(id)}`}
            >
              <span className="flex w-16 shrink-0 gap-0.5">
                {cardsOf(id).map((p) => (
                  <Card key={p.card} card={p.card} art={art} />
                ))}
              </span>
              <PlayerTag name={name(id)} className="flex-1" />
              {r.voted.includes(id) && <span className="text-xs text-ink-muted">voted</span>}
              {r.votes && (counts[id] ?? 0) > 0 && (
                <span className="text-sm font-semibold" aria-label={`${counts[id]} votes`}>
                  🔍×{counts[id]}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <RefusalSlot anchor="rh-vote" />
    </Panel>
  );
}

// ---- The reveal ----

const REVEAL_STEPS = 3;
const STEP_MS = 1100;

/** Shows the reveal a step at a time (votes, the Conspirator, the points); all at once on request. */
function useStaged(key: string): [number, () => void] {
  const [reduce] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  );
  const [state, setState] = useState({ key, step: 0 });
  const step = reduce ? REVEAL_STEPS : state.key === key ? state.step : 0;
  useEffect(() => {
    if (step >= REVEAL_STEPS) return;
    const id = setTimeout(() => {
      setState({ key, step: step + 1 });
    }, STEP_MS);
    return () => {
      clearTimeout(id);
    };
  }, [key, step]);
  return [
    step,
    () => {
      setState({ key, step: REVEAL_STEPS });
    },
  ];
}

export function Reveal({ view, room, act, art, name }: PartProps) {
  const g = view.game!;
  const r = g.round;
  const res = r.result!;
  const [step, skip] = useStaged(`${g.history.length}|${r.no}`);
  const fun = view.settings.scoring === 'fun';
  const counts: Record<string, number> = {};
  for (const t of Object.values(res.votes)) counts[t] = (counts[t] ?? 0) + 1;
  const last = g.history.length >= g.rounds;
  const vp = (n: number) => art.vp[String(n) as '3' | '4' | '5'];
  return (
    <Panel className="flex flex-col gap-2" data-testid="rh-reveal">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">
          The word was <span className="font-serif text-lg italic">“{r.word}”</span>
        </p>
        {step < REVEAL_STEPS && (
          <Button variant="ghost" size="sm" onClick={skip}>
            Show all
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {r.order.map((id) => {
          const isC = id === res.conspirator;
          const points = res.points[id];
          return (
            <li
              key={id}
              data-testid={`rh-result-${id}`}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2 py-1 ring-1 ring-line',
                step >= 2 && isC && 'bg-danger-soft ring-danger-line',
              )}
            >
              <PlayerTag name={name(id)} you={id === room.you} className="min-w-0 flex-1" />
              {id === r.picker ? (
                <span className="text-xs text-ink-muted">✏️ word-picker</span>
              ) : (
                <span className="text-xs text-ink-muted">
                  → {res.votes[id] ? name(res.votes[id]) : '—'}
                </span>
              )}
              <span className="w-12 text-right" aria-label={`${counts[id] ?? 0} votes`}>
                {(counts[id] ?? 0) > 0 ? `🔍×${counts[id]}` : ''}
              </span>
              {step >= 2 && isC && (
                <span className="rounded bg-danger px-1.5 py-0.5 text-xs font-bold text-white">
                  🐟 no word
                </span>
              )}
              {step >= 3 && !fun && points !== undefined && (
                <span className="flex items-center gap-0.5 font-bold text-success-ink">
                  {vp(points) && <ProtectedImage src={vp(points)} alt="" className="size-5" />}+
                  {points}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {step >= 2 && (
        <p className="text-sm" role="status">
          {res.conspirator === room.you ? 'You were' : `${name(res.conspirator)} was`} the
          Conspirator: {res.against} {res.against === 1 ? 'vote' : 'votes'}.{' '}
          {res.caught
            ? fun
              ? 'Caught!'
              : `Caught! Each finder scores ${POINTS.detective}.`
            : fun
              ? 'They got away.'
              : `They got away: ${POINTS.conspirator} for them, ${POINTS.picker} for the word-picker.`}
        </p>
      )}
      {room.isHost ? (
        <StickyBar fixed refusal="rh-next">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => void act({ type: 'next-round' }, { anchor: 'rh-next' })}
            data-testid="rh-next"
          >
            {last ? 'See the final scores' : 'Next round'}
          </Button>
        </StickyBar>
      ) : (
        <p className="text-xs text-ink-muted">The host starts the next round.</p>
      )}
    </Panel>
  );
}
