import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import { Button, Countdown, PlayerTag, ProtectedImage, RefusalSlot, StickyBar, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  type HandCard,
  type Strength,
  beatReason,
  downOf,
  flipHand,
  groupLine,
  insertAt,
  kindLine,
  legalShows,
  segments,
  shapeLine,
  showProblem,
  strengthOf,
  turned,
} from '../logic/rules.ts';
import type { EncoreAction, EncoreView, GameView, PlayerView } from '../logic/types.ts';
import type { Art } from './assets.ts';
import { CardBack, CardFace, Hand } from './Cards.tsx';
import { useSay } from './say.ts';
import { type NameOf, endLine, logLine, poss } from './text.ts';

export type Act = (action: EncoreAction, options?: { anchor?: string }) => Promise<boolean>;

export const TIPS_KEY = 'encore.tips';

export function tipsSeen(): boolean {
  try {
    return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
  } catch {
    return false;
  }
}

export interface TableProps {
  view: EncoreView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  /** Names without "You", for the log's lines. */
  logName?: NameOf;
  showGuide: (id?: string) => void;
}

type End = 'left' | 'right';

/** A recruit in progress on the viewer's turn (nothing is sent until it is confirmed). */
interface Recruiting {
  end: End;
  flip: boolean;
  at: number | null;
  /** Recruit & Show: a Show follows in the same move. */
  double: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The shows that contain card `i`, longest first. */
const containing = (shows: [number, number][], i: number) =>
  shows.filter(([a, b]) => a <= i && i <= b);

export function Table({ view, room, act, art, name, logName, showGuide }: TableProps) {
  const g = view.game!;
  // The viewer's flip choice, kept past the flip step so the hand can play its half-turn once.
  const [chose, setChose] = useState<{ round: number; flip: boolean } | null>(null);
  if (
    g.stage === 'flip' &&
    g.myFlip !== null &&
    (chose?.round !== g.round || chose.flip !== g.myFlip)
  )
    setChose({ round: g.round, flip: g.myFlip });
  const turnedNow = g.stage === 'play' && chose?.round === g.round && chose.flip;
  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <Seats g={g} room={room} art={art} name={name} />
        {g.stage === 'flip' ? (
          <FlipStep view={view} room={room} act={act} art={art} name={name} />
        ) : g.stage === 'scores' && view.phase === 'playing' ? (
          <ScoresStep view={view} room={room} act={act} art={art} name={name} />
        ) : (
          <Play
            view={view}
            room={room}
            act={act}
            art={art}
            name={name}
            showGuide={showGuide}
            turnedNow={turnedNow}
          />
        )}
      </div>
      <aside className="flex min-w-0 flex-col gap-3">
        {g.results.length > 0 && view.phase === 'playing' && (
          <details className="rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
            <summary className="cursor-pointer text-sm font-semibold">
              Scores after {plural(g.results.length, 'round')}
            </summary>
            <ScoreTable g={g} name={name} you={room.you} className="mt-2" />
          </details>
        )}
        <Log view={view} name={logName ?? name} />
      </aside>
    </div>
  );
}

/** The chip's art, or 🎟️ without the manifest. */
function ChipIcon({ art }: { art: Art }) {
  return art.chip ? <ProtectedImage src={art.chip} alt="" className="h-3.5 w-auto" /> : <>🎟️</>;
}

/** Everyone at the table: hand count, captured cards, chips, the Recruit & Show marker. */
function Seats({
  g,
  room,
  art,
  name,
}: {
  g: GameView;
  room: GameRoomInfo;
  art: Art;
  name: NameOf;
}) {
  const say = useSay();
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  return (
    <ul aria-label="Players" className="flex flex-wrap gap-1 sm:gap-1.5">
      {g.players.map((p) => {
        const current = g.stage === 'play' && g.current === p.id && !g.winners.length;
        const owner = g.table?.owner === p.id && g.stage === 'play';
        return (
          <li
            key={p.id}
            className={cn(
              'flex items-center gap-0.5 rounded-full bg-card px-2 py-0.5 text-xs shadow-sm sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-sm ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
              current && 'ring-2 ring-accent dark:ring-amber-500',
              p.left && 'opacity-60',
            )}
            data-seat={p.id}
            aria-label={say(
              `${p.name}: ${plural(p.hand, 'card')} in hand, ${p.captured} captured, ${plural(p.chips, 'chip')}${p.marker ? ', Recruit & Show unused' : ''}, ${p.total} points so far${current ? ', playing now' : ''}`,
            )}
          >
            <PlayerTag
              name={p.name}
              you={p.id === room.you}
              host={p.id === room.hostId}
              offline={offline(p.id) || p.left}
              className="max-w-28"
            />
            <span className="flex items-center gap-0.5 tabular-nums" title="Cards in hand">
              <CardBack art={art} className="h-4 w-3" />
              {p.hand}
            </span>
            <span className="tabular-nums text-ink-muted dark:text-stone-400" title="Captured">
              ▢{p.captured}
            </span>
            <span className="flex items-center gap-0.5 tabular-nums" title="Chips">
              <ChipIcon art={art} />
              {p.chips}
            </span>
            {!g.twoPlayer &&
              (p.marker ? (
                art.marker ? (
                  <ProtectedImage
                    src={art.marker}
                    alt={say('Recruit & Show unused')}
                    className="h-4 w-auto"
                  />
                ) : (
                  <span title={say('Recruit & Show unused')}>🎪</span>
                )
              ) : null)}
            {owner && (
              <span className="text-xs text-ink-muted dark:text-stone-400" title="Owns the table">
                ★
              </span>
            )}
            {(g.stage === 'flip' || g.stage === 'scores') && p.done && (
              <span className="text-success-ink dark:text-emerald-300" title="Ready">
                ✓
              </span>
            )}
            {g.starter === p.id && g.stage === 'flip' && (
              <span title={`${name(p.id)} starts`} className="text-xs">
                {art.hat ? <ProtectedImage src={art.hat} alt="" className="h-4 w-auto" /> : '🎩'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---- The flip ----

function FlipStep({
  view,
  room,
  act,
  art,
  name,
}: {
  view: EncoreView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const hand = g.hand;
  const me = g.players.find((p) => p.id === room.you);
  const open = g.players.filter((p) => !p.done);
  const choose = (flip: boolean) => void act({ type: 'flip', flip }, { anchor: 'en-flip' });
  return (
    <section className="flex flex-col gap-3" aria-label="Keep or flip">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Round {g.round} of {g.rounds} ·{' '}
          {name(g.starter) === 'You' ? 'You start' : `${name(g.starter)} starts`}
        </span>
        <Clock
          g={g}
          room={room}
          name={name}
          label="to decide"
          strict={view.settings.timerMode === 'strict'}
        />
      </div>
      {hand && me ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[false, true].map((flip) => {
            const shown = flip ? flipHand(hand) : hand;
            const chosen = g.myFlip === flip;
            return (
              <div
                key={String(flip)}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
                  chosen && 'ring-[3px] ring-accent dark:ring-amber-400',
                )}
                data-testid={flip ? 'en-flip-turned' : 'en-flip-kept'}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{flip ? 'Turned round' : 'As dealt'}</h3>
                  <span className="text-xs text-ink-muted dark:text-stone-400">
                    {shapeLine(shown)}
                  </span>
                </div>
                <Hand
                  cards={shown}
                  art={art}
                  label={flip ? 'Hand turned round' : 'Hand as dealt'}
                />
                <Button
                  variant={chosen ? 'primary' : 'soft'}
                  onClick={() => choose(flip)}
                  aria-pressed={chosen}
                >
                  {chosen ? '✓ ' : ''}
                  {flip ? 'Turn it round' : 'Keep it'}
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-ink-muted dark:text-stone-400">
          The players are looking at their new hands.
        </p>
      )}
      <RefusalSlot anchor="en-flip" />
      {open.length > 0 && (
        <p className="text-sm text-ink-muted dark:text-stone-400">
          {waitingFor(
            open.map((p) => p.id),
            room.players,
            { you: room.you },
          )}
        </p>
      )}
      {room.isHost && g.clock?.reminded && open.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {open.map((p) => (
            <Button
              key={p.id}
              variant="secondary"
              size="sm"
              onClick={() => void act({ type: 'act-for', player: p.id }, { anchor: 'en-flip' })}
            >
              Decide for {p.name}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

// ---- A turn ----

/** The newest Show, played big for a moment as it lands. */
function useLastShow(view: EncoreView) {
  const last = [...view.log].reverse().find((e) => e.kind === 'show' || e.kind === 'round');
  const id = last?.kind === 'show' ? last.id : 0;
  // The show already on the table when the page opened plays no animation.
  const [seen, setSeen] = useState(id);
  const [fresh, setFresh] = useState<number | null>(null);
  if (id !== seen) {
    setSeen(id);
    if (id) setFresh(id);
  }
  useEffect(() => {
    if (fresh === null) return;
    const t = setTimeout(() => {
      setFresh(null);
    }, 2600);
    return () => {
      clearTimeout(t);
    };
  }, [fresh]);
  return last?.kind === 'show' ? { entry: last, fresh: fresh === last.id } : null;
}

function Play({
  view,
  room,
  act,
  art,
  name,
  showGuide,
  turnedNow,
}: TableProps & { turnedNow: boolean }) {
  const say = useSay();
  const g = view.game!;
  const hand = g.hand ?? [];
  const mine = view.phase === 'playing' && g.stage === 'play' && g.current === room.you && !!g.hand;
  const me = g.players.find((p) => p.id === room.you);
  const table = g.table?.cards ?? [];
  const turnKey = `${g.round}:${view.log.at(-1)?.id ?? 0}:${g.current}`;
  const [recruiting, setRecruiting] = useState<Recruiting | null>(null);
  const [picking, setPicking] = useState<{ double: boolean } | null>(null);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  // A new move anywhere clears a half-made one.
  const [key, setKey] = useState(turnKey);
  if (key !== turnKey) {
    setKey(turnKey);
    setRecruiting(null);
    setPicking(null);
    setSel(null);
  }

  // The hand as it would be with the recruited card in it, and what stays on the table.
  const taken =
    recruiting && table.length ? (recruiting.end === 'left' ? table[0]! : table.at(-1)!) : null;
  const placedCard = taken && recruiting ? (recruiting.flip ? turned(taken) : taken) : null;
  const shownHand =
    placedCard && recruiting?.at !== null && recruiting
      ? insertAt(hand, placedCard, recruiting.at)
      : hand;
  const rest = recruiting
    ? recruiting.end === 'left'
      ? table.slice(1)
      : table.slice(0, -1)
    : table;
  const against: Strength | null = rest.length ? strengthOf(rest) : null;
  const choosingShow = !recruiting || (recruiting.double && recruiting.at !== null);
  const shows = useMemo(
    () => (mine && choosingShow ? legalShows(shownHand, against) : []),
    [mine, choosingShow, shownHand, against],
  );
  const legal = useMemo(() => {
    const s = new Set<number>();
    for (const [a, b] of shows) for (let i = a; i <= b; i++) s.add(i);
    return s;
  }, [shows]);

  const tapCard = (i: number) => {
    if (!mine || !choosingShow) return;
    const options = containing(shows, i);
    const at = sel ? options.findIndex(([a, b]) => a === sel[0] && b === sel[1]) : -1;
    if (sel && at >= 0) setSel(options[at + 1] ?? null);
    else setSel(options[0] ?? [i, i]);
  };

  const send = async (action: EncoreAction) => {
    setBusy(true);
    const ok = await act(action, { anchor: 'en-play' });
    setBusy(false);
    if (ok) {
      setRecruiting(null);
      setPicking(null);
      setSel(null);
    }
  };

  const canRecruit = mine && table.length > 0 && (!g.twoPlayer || (me?.chips ?? 0) > 0);
  const startRecruit = (end: End, double: boolean) => {
    setSel(null);
    setPicking(null);
    setRecruiting({ end, flip: false, at: null, double });
  };
  const beginRecruit = (double: boolean) => {
    if (table.length === 1) startRecruit('left', double);
    else setPicking({ double });
  };

  const selected = sel ? shownHand.slice(sel[0], sel[1] + 1) : [];
  const problem = sel ? showProblem(selected, against) : null;
  const strength = selected.length ? strengthOf(selected) : null;
  const ownerName = g.table ? name(g.table.owner) : '';
  const last = useLastShow(view);
  // The half-turn plays once as the round's play begins, not on cards recruited later.
  const [turning, setTurning] = useState(turnedNow);
  useEffect(() => {
    if (!turning) return;
    const t = setTimeout(() => {
      setTurning(false);
    }, 600);
    return () => {
      clearTimeout(t);
    };
  }, [turning]);

  return (
    <section className="flex flex-col gap-3" aria-label="The table">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Round {g.round} of {g.rounds}
          {g.twoPlayer &&
            g.round < g.rounds &&
            view.phase === 'playing' &&
            ` · ${plural(g.reserve, 'card')} waiting for round ${g.round + 1}`}
        </span>
        <Clock
          g={g}
          room={room}
          name={name}
          label="for this turn"
          strict={view.settings.timerMode === 'strict'}
        />
      </div>
      <div
        className="relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-panel px-3 py-3 ring-1 sm:min-h-36 sm:py-4 ring-line dark:bg-stone-900 dark:ring-stone-700"
        data-testid="en-table"
      >
        {table.length ? (
          <>
            <p className="text-center text-sm">
              <span className="font-semibold">{poss(ownerName, true)} show</span>{' '}
              <span className="text-ink-muted dark:text-stone-400">· {kindLine(table)}</span>
            </p>
            <div
              key={last?.entry.id ?? 0}
              className={cn(
                'flex flex-wrap items-end justify-center gap-1.5',
                last?.fresh && (table.length >= 4 ? 'en-big' : 'en-show'),
              )}
            >
              {table.map((c, i) => {
                const end: End | null = i === 0 ? 'left' : i === table.length - 1 ? 'right' : null;
                const gone = !!recruiting && end === recruiting.end && taken === c;
                const recruitable = canRecruit && !!end && !recruiting && !gone;
                const face = (
                  <CardFace
                    card={c}
                    art={art}
                    size="table"
                    className={cn(
                      gone && 'opacity-25',
                      recruitable && picking && 'ring-[3px] ring-info dark:ring-sky-400',
                    )}
                  />
                );
                return recruitable ? (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => startRecruit(end, picking?.double ?? false)}
                    className="flex flex-col items-center gap-0.5 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={say(`Recruit the ${c.up} (other end ${downOf(c)})`)}
                    data-table-end={end}
                  >
                    {face}
                    <span className="text-[11px] text-info-ink dark:text-sky-300">
                      {say('recruit')}
                    </span>
                  </button>
                ) : (
                  <span key={c.id} className="flex flex-col items-center gap-0.5">
                    {face}
                    {canRecruit && end && <span className="h-4" />}
                  </span>
                );
              })}
            </div>
            {last?.fresh && last.entry.beat.length > 0 && (
              <p
                role="status"
                className="en-pop text-center text-sm font-bold text-accent dark:text-amber-300"
              >
                {beatReason(strengthOf(last.entry.cards)!, strengthOf(last.entry.beat))}!
              </p>
            )}
          </>
        ) : (
          <p className="text-center text-sm text-ink-muted dark:text-stone-400">
            {g.table ? say(`${poss(ownerName, true)} show was recruited away. `) : ''}
            The table is empty: the next player shows anything.
          </p>
        )}
      </div>

      {recruiting && placedCard && (
        <Placing
          recruiting={recruiting}
          card={placedCard}
          hand={shownHand}
          art={art}
          owner={ownerName}
          twoPlayer={g.twoPlayer}
          onFlip={() => setRecruiting({ ...recruiting, flip: !recruiting.flip })}
        />
      )}

      {g.hand ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Your hand · {plural(hand.length, 'card')}</h3>
            <span className="text-xs text-ink-muted dark:text-stone-400">
              {mine && choosingShow && shows.length
                ? '✦ can be shown · tap to pick'
                : shapeLine(hand)}
            </span>
          </div>
          <Hand
            cards={shownHand}
            turning={turning}
            art={art}
            selected={choosingShow ? sel : null}
            legal={mine && choosingShow ? legal : undefined}
            preview={recruiting?.at ?? null}
            onCard={mine && choosingShow ? tapCard : undefined}
            onGap={
              recruiting
                ? (at) => {
                    // Gaps are counted in the hand without the recruited card.
                    const real = recruiting.at !== null && at > recruiting.at ? at - 1 : at;
                    setSel(null);
                    setRecruiting({ ...recruiting, at: real });
                  }
                : undefined
            }
          />
          {mine && (
            <StickyBar whole>
              <div className="flex flex-col gap-2" data-testid="en-actions">
                {recruiting ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRecruiting(null);
                        setSel(null);
                      }}
                    >
                      Cancel
                    </Button>
                    {!recruiting.double ? (
                      <Button
                        className="flex-1"
                        disabled={recruiting.at === null || busy}
                        onClick={() =>
                          void send({
                            type: 'recruit',
                            end: recruiting.end,
                            flip: recruiting.flip,
                            at: recruiting.at!,
                          })
                        }
                      >
                        {recruiting.at === null
                          ? 'Tap a gap in your hand'
                          : g.twoPlayer
                            ? say('Pay a chip and recruit it here')
                            : say(`Recruit it here · ${ownerName} +1`)}
                      </Button>
                    ) : (
                      <Button
                        className="flex-1"
                        disabled={recruiting.at === null || !sel || !!problem || busy}
                        onClick={() =>
                          void send({
                            type: 'recruit-show',
                            end: recruiting.end,
                            flip: recruiting.flip,
                            at: recruiting.at!,
                            from: sel![0],
                            to: sel![1],
                          })
                        }
                      >
                        {recruiting.at === null
                          ? 'Tap a gap in your hand'
                          : !sel
                            ? 'Now tap the cards to show'
                            : problem
                              ? problem
                              : say(
                                  `🎪 Recruit & show ${groupLine(selected)} · ${beatReason(strength!, against)}`,
                                )}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    <Button
                      disabled={!sel || !!problem || busy}
                      onClick={() => void send({ type: 'show', from: sel![0], to: sel![1] })}
                      data-testid="en-show"
                    >
                      {!sel
                        ? shows.length
                          ? 'Tap your cards to pick a show'
                          : 'Nothing in your hand beats the table'
                        : problem
                          ? problem
                          : `Show ${groupLine(selected)} · ${beatReason(strength!, against)}`}
                    </Button>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="soft"
                        className="flex-1 px-2 whitespace-nowrap"
                        disabled={!canRecruit || busy}
                        onClick={() => beginRecruit(false)}
                        data-testid="en-recruit"
                      >
                        🤝 {say('Recruit')}
                        {table.length
                          ? g.twoPlayer
                            ? ` (${plural(me?.chips ?? 0, 'chip')} left)`
                            : ` · ${ownerName} +1`
                          : ''}
                      </Button>
                      {!g.twoPlayer && (
                        <Button
                          variant="soft"
                          className="flex-1 px-2 whitespace-nowrap"
                          disabled={!canRecruit || !me?.marker || busy}
                          onClick={() => beginRecruit(true)}
                          data-testid="en-recruit-show"
                        >
                          🎪 {say('Recruit & Show')}
                          {me?.marker ? '' : ' (used)'}
                        </Button>
                      )}
                    </div>
                    {picking && (
                      <p className="text-sm text-info-ink dark:text-sky-300">
                        Tap the card you want at either end of the table.
                      </p>
                    )}
                  </>
                )}
                <RefusalSlot anchor="en-play" resetKey={turnKey} />
              </div>
            </StickyBar>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-muted dark:text-stone-400">
          You’re watching: hands stay hidden.
        </p>
      )}
      {!mine && view.phase === 'playing' && <HostActFor g={g} room={room} act={act} name={name} />}
      {g.results.length === 0 && g.round === 1 && (
        <button
          type="button"
          className="self-start text-xs text-ink-muted underline dark:text-stone-400"
          onClick={() => showGuide('cards')}
        >
          What beats what?
        </button>
      )}
    </section>
  );
}

/** The recruited card, floating with its flip button and what it builds where it sits. */
function Placing({
  recruiting,
  card,
  hand,
  art,
  owner,
  twoPlayer,
  onFlip,
}: {
  recruiting: Recruiting;
  card: HandCard;
  hand: HandCard[];
  art: Art;
  owner: string;
  twoPlayer: boolean;
  onFlip: () => void;
}) {
  const say = useSay();
  const at = recruiting.at;
  const seg = at === null ? undefined : segments(hand).find((s) => s.from <= at && at <= s.to);
  const builds = seg
    ? `Makes a ${seg.kind} of ${seg.to - seg.from + 1}: ${groupLine(hand.slice(seg.from, seg.to + 1))}`
    : 'Joins nothing there yet';
  return (
    <div
      className="en-rise flex items-center gap-3 rounded-2xl bg-info-soft p-3 text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
      data-testid="en-placing"
    >
      <CardFace card={card} art={art} size="float" className="en-lift shrink-0 shadow-lg" />
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">
        <p className="font-semibold">
          {say(`${recruiting.double ? '🎪 Recruit & Show: ' : ''}Recruiting the ${card.up}`)}
          {twoPlayer ? ' (costs a chip)' : ` (${owner} +1)`}
        </p>
        <p>{at === null ? 'Tap a glowing gap in your hand to put it there.' : builds}</p>
        <Button variant="secondary" size="sm" className="self-start" onClick={onFlip}>
          ↻ Turn it: {downOf(card)} instead of {card.up}
        </Button>
        {recruiting.double && at !== null && <p>Then tap the cards you want to show.</p>}
      </div>
    </div>
  );
}

function Clock({
  g,
  room,
  name,
  label,
  strict,
}: {
  g: GameView;
  room: GameRoomInfo;
  name: NameOf;
  label: string;
  strict: boolean;
}) {
  if (!g.clock?.deadline) return null;
  const whose =
    g.clock.who && g.clock.who !== room.you ? `for ${poss(name(g.clock.who))} turn` : label;
  return strict ? (
    <Countdown
      deadline={g.clock.deadline}
      clockOffset={room.clockOffset}
      label={whose}
      atZero="then the app plays for them"
    />
  ) : (
    <Countdown
      deadline={g.clock.deadline}
      clockOffset={room.clockOffset}
      label={whose}
      soft
      expiredHint={
        room.isHost ? 'Time’s up: you can act for them.' : 'Time’s up: the host can act for them.'
      }
    />
  );
}

/** The host's Act for, once the soft clock has run out or the player is offline. */
function HostActFor({
  g,
  room,
  act,
  name,
}: {
  g: GameView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const offline = room.players.find((p) => p.id === g.current)?.connected === false;
  if (!room.isHost || g.stage !== 'play' || (!g.clock?.reminded && !offline)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void act({ type: 'act-for', player: g.current }, { anchor: 'en-host' })}
      >
        Act for {name(g.current)}
      </Button>
      <RefusalSlot anchor="en-host" />
    </div>
  );
}

// ---- Between rounds ----

function ScoresStep({
  view,
  room,
  act,
  art,
  name,
}: {
  view: EncoreView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const say = useSay();
  const g = view.game!;
  const r = g.results.at(-1)!;
  const me = g.players.find((p) => p.id === room.you);
  const open = g.players.filter((p) => !p.done && !p.left);
  return (
    <section className="en-rise flex flex-col gap-3" aria-label="Round scores">
      <div
        className="rounded-2xl bg-special-soft p-3 text-special-ink ring-1 ring-special-line dark:bg-violet-500/15 dark:text-violet-100 dark:ring-violet-500/40"
        data-testid="en-round-end"
      >
        <p className="font-semibold">👏 Round {r.round} is over</p>
        <p className="text-sm">{say(endLine(r, name))}</p>
      </div>
      <div className="rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
        <RoundBreakdown g={g} round={r.round} name={name} you={room.you} art={art} />
      </div>
      <div className="flex flex-wrap gap-2">
        {me && (
          <Button
            className="flex-1"
            disabled={me.done}
            onClick={() => void act({ type: 'ready' }, { anchor: 'en-scores' })}
            data-testid="en-ready"
          >
            {me.done ? '✓ Ready' : `Ready for round ${g.round + 1}`}
          </Button>
        )}
        {room.isHost && (
          <Button
            variant="secondary"
            onClick={() => void act({ type: 'next-round' }, { anchor: 'en-scores' })}
          >
            Deal now
          </Button>
        )}
      </div>
      <RefusalSlot anchor="en-scores" />
      {open.length > 0 && (
        <p className="text-sm text-ink-muted dark:text-stone-400">
          {waitingFor(
            open.map((p) => p.id),
            room.players,
            { you: room.you },
          )}
        </p>
      )}
    </section>
  );
}

/** One round's scores: captured + chips − cards in hand. */
export function RoundBreakdown({
  g,
  round,
  name,
  you,
  art,
}: {
  g: GameView;
  round: number;
  name: NameOf;
  you: string;
  art: Art;
}) {
  const r = g.results.find((x) => x.round === round);
  if (!r) return null;
  return (
    <table className="w-full text-sm tabular-nums" aria-label={`Round ${round} scores`}>
      <thead className="text-xs text-ink-muted dark:text-stone-400">
        <tr>
          <th className="text-left font-normal">Player</th>
          <th className="font-normal" title="Captured cards">
            ▢ +
          </th>
          <th className="font-normal" title="Chips">
            <span className="inline-flex items-center gap-0.5">
              <ChipIcon art={art} /> +
            </span>
          </th>
          <th className="font-normal" title="Cards in hand">
            ✋ −
          </th>
          <th className="text-right font-normal">Round</th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((row) => (
          <tr key={row.id} className={cn(row.id === you && 'font-semibold')}>
            <td className="max-w-28 truncate py-0.5">
              {name(row.id)}
              {row.id === r.ender && ' 👏'}
            </td>
            <td className="text-center">{row.captured}</td>
            <td className="text-center">{row.chips}</td>
            <td className="text-center">
              {row.penalty ? (
                row.hand
              ) : (
                <span title="No penalty">{row.hand ? `(${row.hand})` : 0}</span>
              )}
            </td>
            <td
              className={cn(
                'text-right font-bold',
                row.points < 0 && 'text-danger-ink dark:text-rose-300',
              )}
            >
              {row.points > 0 ? `+${row.points}` : row.points}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every round's points and the running totals. */
export function ScoreTable({
  g,
  name,
  you,
  className,
}: {
  g: GameView;
  name: NameOf;
  you: string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm tabular-nums" aria-label="Scores by round">
        <thead className="text-xs text-ink-muted dark:text-stone-400">
          <tr>
            <th className="text-left font-normal">Player</th>
            {g.results.map((r) => (
              <th key={r.round} className="font-normal">
                R{r.round}
              </th>
            ))}
            <th className="text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {g.players.map((p: PlayerView) => (
            <tr key={p.id} className={cn(p.id === you && 'font-semibold')}>
              <td className="max-w-24 truncate py-0.5">{name(p.id)}</td>
              {g.results.map((r) => {
                const row = r.rows.find((x) => x.id === p.id);
                return (
                  <td key={r.round} className="text-center">
                    {row?.points ?? '–'}
                    {r.ender === p.id ? '👏' : ''}
                  </td>
                );
              })}
              <td className="text-right font-bold">{p.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Log({ view, name }: { view: EncoreView; name: NameOf }) {
  const say = useSay();
  const lines = view.log
    .map((e) => {
      const text = logLine(e, name);
      return { id: e.id, text: text && say(text) };
    })
    .filter((l): l is { id: number; text: string } => !!l.text)
    .slice(-6)
    .reverse();
  if (!lines.length) return null;
  // Phones show the newest three, so a turn fits the screen.
  return (
    <section
      aria-label="What happened"
      className="rounded-2xl bg-panel p-3 text-sm ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
    >
      <h3 className="mb-1 text-xs font-semibold text-ink-muted dark:text-stone-400">
        What happened
      </h3>
      <ul className="flex flex-col gap-0.5" data-testid="en-log">
        {lines.map((l, i) => (
          <li
            key={l.id}
            className={cn(i > 0 && 'text-ink-muted dark:text-stone-400', i > 2 && 'max-sm:hidden')}
          >
            {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
