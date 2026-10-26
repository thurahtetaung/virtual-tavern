import { storageKey } from '@vt/game-sdk';
import { TokenIcon } from './Token.tsx';
import { Button, Modal, Panel, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import { type CardId, type Position, isTrump, sortCards, winningIndex } from '../logic/cards.ts';
import type { Trick } from '../logic/checks.ts';
import {
  type AttemptView,
  DUMMY,
  EMOTES,
  type Emote,
  type MissionControlAction,
} from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { CardBack, CardChip, CardFace, cardName } from './Card.tsx';
import { TaskChip } from './Tasks.tsx';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;
const ANCHOR = 'mc-play';

const POS = {
  top: { icon: '▲', label: 'highest' },
  only: { icon: '●', label: 'only' },
  bottom: { icon: '▼', label: 'lowest' },
} as const satisfies Record<Position, { icon: string; label: string }>;

/** "▲ highest", or "? hidden" under currents. */
export function positionText(pos: Position | null) {
  return pos ? `${POS[pos].icon} ${POS[pos].label}` : '? not shown';
}

/** One crew member: name, tricks, cards, token, signal and tasks. */
function Seat({
  a,
  seat,
  me,
  name,
  online,
  emote,
}: {
  a: AttemptView;
  seat: string;
  me: string;
  name: (id: string) => string;
  online: (id: string) => boolean;
  emote: string | null;
}) {
  const art = useArt();
  const c = a.crew.find((x) => x.id === seat)!;
  const signal = a.signals.find((s) => s.by === seat && !s.played);
  const usedSignal = a.signals.find((s) => s.by === seat);
  const tasks = a.tasks.filter((t) => t.owner === seat);
  const turn = a.stage === 'play' && a.turn === seat;
  return (
    <li
      className={cn(
        'relative w-40 shrink-0 space-y-1 rounded-xl bg-card p-1.5 ring-1 ring-line sm:w-auto sm:p-2 dark:bg-stone-800/70 dark:ring-stone-700',
        turn && 'ring-2 ring-accent dark:ring-amber-400',
      )}
      data-testid={`mc-seat-${seat}`}
    >
      <div className="flex items-center justify-between gap-1 text-sm">
        <span className="min-w-0 truncate font-semibold">
          {seat === DUMMY ? (
            <>🤖 {name(DUMMY)}</>
          ) : (
            <PlayerTag name={name(seat)} you={seat === me} offline={!online(seat)} />
          )}
        </span>
        {c.captain && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-1 pr-1.5 text-xs font-bold text-accent-text ring-1 ring-accent-line dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/40"
            data-testid="mc-captain"
          >
            <TokenIcon kind="captain" label={art.say('{Captain}')} className="h-5 w-4" />
            <span className="hidden sm:inline">{art.say('{Captain}')}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-ink-muted tabular-nums">
        <span title="tricks won">🂠 {c.tricks}</span>
        <span title="cards in hand">✋ {c.cards}</span>
        {c.token && (
          <span className="flex items-center gap-0.5" data-testid="mc-token" data-token={c.token}>
            <TokenIcon
              kind={c.token === 'unused' ? 'token' : 'used'}
              label={art.say(c.token === 'unused' ? '{token} unused' : '{token} used')}
              decorative
              className="size-5"
            />
            {c.token === 'unused' ? 'ready' : 'used'}
          </span>
        )}
        {emote && (
          <span className="text-base" aria-label={`${name(seat)} reacted ${emote}`}>
            {emote}
          </span>
        )}
      </div>
      {signal ? (
        <p className="flex items-center gap-1 text-xs" data-testid={`mc-signal-${seat}`}>
          <TokenIcon kind="token" label="" decorative className="size-4" />
          <CardChip card={signal.card} /> {positionText(signal.pos)}
        </p>
      ) : usedSignal ? (
        <p className="text-xs text-ink-muted">
          Signalled <CardChip card={usedSignal.card} /> {positionText(usedSignal.pos)}
        </p>
      ) : null}
      {tasks.length > 0 && (
        <ul className="space-y-1">
          {tasks.map((t) => (
            <li key={t.index}>
              <TaskChip task={t} name={name} compact you={me} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The cards of a trick, each with who played it; the winning card glows. */
export function TrickRow({
  plays,
  name,
  winner,
  size = 'md',
}: {
  plays: Trick['plays'];
  name: (id: string) => string;
  winner?: string | null;
  size?: 'sm' | 'md' | 'hand';
}) {
  const best = plays.length ? plays[winningIndex(plays.map((p) => p.card))]!.by : null;
  const top = winner ?? best;
  return (
    <ul className="flex flex-wrap items-end justify-center gap-2">
      {plays.map((p) => (
        <li key={p.card} className="flex flex-col items-center gap-0.5">
          <CardFace card={p.card} size={size} state={p.by === top ? 'selected' : 'normal'} />
          <span className="max-w-16 truncate text-xs">{name(p.by)}</span>
        </li>
      ))}
    </ul>
  );
}

function SignalDialog({
  a,
  open,
  onClose,
  onSignal,
}: {
  a: AttemptView;
  open: boolean;
  onClose: () => void;
  onSignal: (card: CardId, pos: Position | null) => void;
}) {
  const art = useArt();
  const currents = a.comms === 'currents';
  return (
    <Modal open={open} onClose={onClose} title="📡 Signal a card">
      <p className="mb-3 text-sm">
        Show one colour card and say whether it is your highest, only or lowest of its colour. It
        stays face up until you play it.{' '}
        {currents && 'Currents: the others won’t see which of the three it is.'}
        {art.say(' {Trumps} are never signalled.')}
      </p>
      <ul className="space-y-2">
        {sortCards(Object.keys(a.signalable)).map((c) => (
          <li key={c} className="flex items-center gap-3">
            <CardFace card={c} size="sm" />
            <span className="flex flex-wrap gap-2">
              {currents ? (
                <Button size="sm" onClick={() => onSignal(c, null)} data-testid={`mc-signal-${c}`}>
                  Show it
                </Button>
              ) : (
                a.signalable[c]!.map((pos) => (
                  <Button
                    key={pos}
                    size="sm"
                    onClick={() => onSignal(c, pos)}
                    data-testid={`mc-signal-${c}-${pos}`}
                  >
                    {positionText(pos)}
                  </Button>
                ))
              )}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** The cards played so far, trick by trick (the host's "all played cards" option, else the last). */
export function PlayedCards({ a, name }: { a: AttemptView; name: (id: string) => string }) {
  if (!a.tricks.length) return <p className="text-sm text-ink-muted">No trick played yet.</p>;
  return (
    <ol className="space-y-2" data-testid="mc-played">
      {[...a.tricks].reverse().map((t) => (
        <li key={t.no} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-16 shrink-0 font-semibold tabular-nums">Trick {t.no}</span>
          {t.plays.map((p) => (
            <CardChip key={p.card} card={p.card} />
          ))}
          <span className="text-ink-muted">→ {name(t.winner)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The dummy's two rows: face-up cards on top of face-down ones. */
function DummyRows({
  a,
  name,
  playable,
  onPick,
  picked,
}: {
  a: AttemptView;
  name: (id: string) => string;
  playable: CardId[];
  onPick: ((c: CardId) => void) | null;
  picked: CardId | null;
}) {
  if (!a.dummy) return null;
  return (
    <div className="space-y-1" data-testid="mc-dummy">
      <p className="text-xs font-semibold">
        🤖 {name(DUMMY)} · {a.dummy.down} face down
      </p>
      <div className="flex flex-wrap gap-1">
        {a.dummy.up.map((c, i) =>
          c ? (
            <CardFace
              key={c}
              card={c}
              size="sm"
              state={
                picked === c
                  ? 'selected'
                  : onPick
                    ? playable.includes(c)
                      ? 'legal'
                      : 'dim'
                    : 'normal'
              }
              {...(onPick && playable.includes(c) && { onClick: () => onPick(c) })}
            />
          ) : (
            <CardBack key={`down-${i}`} size="sm" />
          ),
        )}
      </div>
    </div>
  );
}

export function PlayTable({
  a,
  me,
  act,
  name,
  online,
  emotes,
  openTable,
  showAllPlayed,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
  online: (id: string) => boolean;
  emotes: Emote[];
  openTable: boolean;
  showAllPlayed: boolean;
}) {
  const art = useArt();
  const send = (action: MissionControlAction) => act(action, { anchor: ANCHOR });
  const inCrew = a.crew.some((c) => c.id === me);
  const myTurnSeat = a.stage === 'play' && a.controls.includes(a.turn) ? a.turn : null;
  const hand = a.hand ?? [];
  const trickKey = `${a.trickCount}:${a.current.length}`;
  // A picked card counts only in the trick where it was picked.
  const [pick, setPick] = useState<{ at: string; card: CardId } | null>(null);
  const picked = pick?.at === trickKey ? pick.card : null;
  const setPicked = (card: CardId | null) => setPick(card ? { at: trickKey, card } : null);
  // A pre-selected card is for the viewer's next turn: this trick, or the next if they have played.
  const [queue, setQueue] = useState<{ card: CardId; trick: number } | null>(null);
  const queued =
    queue &&
    queue.trick === a.trickCount &&
    hand.includes(queue.card) &&
    !(myTurnSeat === me && !a.legal.includes(queue.card))
      ? queue.card
      : null;
  const setQueued = (card: CardId | null) =>
    setQueue(
      card ? { card, trick: a.trickCount + (a.current.some((p) => p.by === me) ? 1 : 0) } : null,
    );
  const sent = useRef<string | null>(null);
  const [signalling, setSignalling] = useState(false);
  const [playedOpen, setPlayedOpen] = useState(false);

  // The pre-selected card plays itself when the turn comes (once), if it is still legal.
  const waitForSignal = a.holds.length > 0 && a.current.length === 0;
  useEffect(() => {
    if (!queued || myTurnSeat !== me || waitForSignal) return;
    const key = `${trickKey}:${queued}`;
    if (sent.current === key) return;
    sent.current = key;
    void act({ type: 'play', card: queued }, { anchor: ANCHOR });
  }, [queued, myTurnSeat, me, trickKey, waitForSignal, act]);

  const tapHand = (c: CardId) => {
    if (myTurnSeat === me) {
      if (!a.legal.includes(c)) return;
      if (picked === c) void send({ type: 'play', card: c });
      else setPicked(c);
    } else if (a.stage === 'play') {
      setQueued(queued === c ? null : c);
    }
  };
  const tapDummy = (c: CardId) => {
    if (picked === c) void send({ type: 'play', card: c });
    else setPicked(c);
  };
  const lastEmote = (seat: string) => {
    const e = emotes.filter((x) => x.by === seat && x.trick === a.trickCount).at(-1);
    return e ? e.emoji : null;
  };
  const last = a.tricks.at(-1);
  const showLast = !a.current.length && last && last.no === a.trickCount;
  const canHold = !a.signalBlock && !a.current.length && !a.holds.includes(me) && a.turn !== me;
  const order = a.crew.map((c) => c.id);

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-panel px-3 py-1 text-center text-xs ring-1 ring-line sm:text-sm dark:bg-stone-800/70 dark:ring-stone-700">
        {openTable ? (
          '🗣️ Open table'
        ) : (
          <>
            🤫 Silent running
            <span className="hidden sm:inline">: no talking about cards. Let the play speak.</span>
          </>
        )}
      </p>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] sm:overflow-visible">
        {order.map((seat) => (
          <Seat
            key={seat}
            a={a}
            seat={seat}
            me={me}
            name={name}
            online={online}
            emote={lastEmote(seat)}
          />
        ))}
      </ul>
      {a.tasks.some((t) => t.crew) && (
        <ul className="space-y-1">
          {a.tasks
            .filter((t) => t.crew)
            .map((t) => (
              <li key={t.index}>
                <TaskChip task={t} name={name} showOwner you={me} />
              </li>
            ))}
        </ul>
      )}

      <Panel
        className="min-h-28 space-y-2 p-3! text-center sm:min-h-36 sm:p-4!"
        data-testid="mc-trick"
      >
        <p className="text-sm text-ink-muted">
          Trick {Math.min(a.trickCount + 1, a.total)} of {a.total}
          {a.current.length
            ? ` · led by ${name(a.current[0]!.by)}`
            : showLast
              ? ` · last trick won by ${name(last.winner)}`
              : ''}
        </p>
        {a.current.length ? (
          <TrickRow plays={a.current} name={name} size="hand" />
        ) : showLast ? (
          <div className="opacity-70">
            <TrickRow plays={last.plays} name={name} winner={last.winner} size="sm" />
          </div>
        ) : (
          <p className="py-6 text-sm text-ink-muted">{name(a.turn)} leads.</p>
        )}
        {a.stage === 'play' && !a.current.length && a.trickCount > 0 && inCrew && (
          <div className="flex justify-center gap-1" aria-label="React">
            {EMOTES.map((e) => (
              <button
                key={e}
                type="button"
                className="size-11 rounded-full text-xl hover:bg-panel dark:hover:bg-stone-800"
                onClick={() => void send({ type: 'emote', emoji: e })}
                aria-label={`React ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </Panel>

      {a.controls.includes(DUMMY) || a.dummy ? (
        <DummyRows
          a={a}
          name={name}
          playable={myTurnSeat === DUMMY ? a.legal : []}
          onPick={myTurnSeat === DUMMY ? tapDummy : null}
          picked={myTurnSeat === DUMMY ? picked : null}
        />
      ) : null}

      {inCrew && (
        <div className="space-y-2" data-testid="mc-hand">
          <div className="flex flex-wrap justify-center gap-1.5">
            {hand.map((c) => {
              const signalled = a.signals.some((s) => s.card === c && !s.played);
              const state =
                picked === c && myTurnSeat === me
                  ? 'selected'
                  : queued === c
                    ? 'queued'
                    : myTurnSeat === me
                      ? a.legal.includes(c)
                        ? 'legal'
                        : 'dim'
                      : signalled
                        ? 'signalled'
                        : 'normal';
              return (
                <CardFace
                  key={c}
                  card={c}
                  size="hand"
                  state={state}
                  onClick={() => tapHand(c)}
                  testId={`mc-card-${c}`}
                  {...(signalled && {
                    badge: (
                      <TokenIcon
                        kind="reminder"
                        label="Signalled: still face up on the table"
                        className="h-7 w-5 drop-shadow"
                      />
                    ),
                  })}
                  label={`${cardName(c, art.names.trump)}${signalled ? ', signalled' : ''}${myTurnSeat === me && !a.legal.includes(c) ? ', can’t be played now' : ''}`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {picked && myTurnSeat && (
              <Button
                size="lg"
                onClick={() => void send({ type: 'play', card: picked })}
                data-testid="mc-play"
              >
                Play {cardName(picked, art.names.trump)}
              </Button>
            )}
            {queued && myTurnSeat !== me && (
              <span className="text-sm">
                Plays when it’s your turn: <CardChip card={queued} />{' '}
                <button type="button" className="underline" onClick={() => setQueued(null)}>
                  cancel
                </button>
              </span>
            )}
            <Button
              variant="secondary"
              disabled={!!a.signalBlock}
              onClick={() => setSignalling(true)}
              data-testid="mc-signal"
              title={a.signalBlock ?? undefined}
            >
              <TokenIcon kind="token" label="" decorative className="size-6" />
              Signal
            </Button>
            {canHold && (
              <Button
                variant="secondary"
                onClick={() => void send({ type: 'hold', on: true })}
                data-testid="mc-hold"
              >
                ✋ Wait, I’ll signal
              </Button>
            )}
            {a.holds.includes(me) && (
              <Button variant="secondary" onClick={() => void send({ type: 'hold', on: false })}>
                Never mind
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setPlayedOpen(true)}
              data-testid="mc-played-open"
            >
              🃏 {showAllPlayed ? 'Played cards' : 'Last trick'}
            </Button>
          </div>
          {a.signalBlock && a.stage === 'play' && (
            <p className="text-center text-xs text-ink-muted" data-testid="mc-signal-block">
              📡 {art.say(a.signalBlock)}
            </p>
          )}
          {myTurnSeat !== me && a.stage === 'play' && !queued && (
            <p className="text-center text-xs text-ink-muted">
              Tip: tap a card now to play it as soon as your turn comes.
            </p>
          )}
        </div>
      )}
      <RefusalSlot anchor={ANCHOR} resetKey={trickKey} />
      <SignalDialog
        a={a}
        open={signalling}
        onClose={() => setSignalling(false)}
        onSignal={(card, pos) => {
          setSignalling(false);
          void send({ type: 'signal', card, pos });
        }}
      />
      <Modal
        open={playedOpen}
        onClose={() => setPlayedOpen(false)}
        title={showAllPlayed ? 'Played cards' : 'Last trick'}
      >
        <PlayedCards a={a} name={name} />
      </Modal>
    </div>
  );
}

/** Before the dive: send a distress signal or dive in. */
export function DistressPanel({
  a,
  me,
  act,
  name,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
}) {
  const art = useArt();
  const send = (action: MissionControlAction) => void act(action, { anchor: 'mc-distress' });
  const p = a.distress.proposal;
  return (
    <Panel className="space-y-3 text-center" data-testid="mc-distress">
      <p className="text-sm">
        {art.say(
          'Before the first signal the crew may send a {distress}: everyone passes one card (never a {trump}) to the same neighbour. It costs one attempt in the logbook, once per mission.',
        )}
      </p>
      {p ? (
        <>
          <p className="font-semibold">
            {art.say(`${name(p.by)} proposes a {distress}: pass to the ${p.dir}.`)} Agreed:{' '}
            {a.distress.accepted.map(name).join(', ')}
          </p>
          {!a.distress.accepted.includes(me) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => send({ type: 'distress-answer', yes: true })}
                data-testid="mc-distress-yes"
              >
                Agree
              </Button>
              <Button
                variant="secondary"
                onClick={() => send({ type: 'distress-answer', yes: false })}
              >
                No
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button
            size="lg"
            disabled={a.distress.dive.includes(me)}
            onClick={() => send({ type: 'dive' })}
            data-testid="mc-dive"
          >
            {a.distress.dive.includes(me) ? 'Diving ✓' : '🤿 Dive'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => send({ type: 'distress', dir: 'left' })}
            data-testid="mc-distress-left"
          >
            <TokenIcon kind="distress" label="" decorative className="h-7 w-5" />
            Pass left
          </Button>
          <Button variant="secondary" onClick={() => send({ type: 'distress', dir: 'right' })}>
            <TokenIcon kind="distress" label="" decorative className="h-7 w-5" />
            Pass right
          </Button>
        </div>
      )}
      <RefusalSlot anchor="mc-distress" />
    </Panel>
  );
}

/** The distress pass: each seat (the dummy by the captain) picks one colour card. */
export function PassPanel({
  a,
  act,
  name,
}: {
  a: AttemptView;
  act: Act;
  name: (id: string) => string;
}) {
  const art = useArt();
  const seats = a.controls;
  return (
    <Panel className="space-y-3" data-testid="mc-pass-panel">
      <p className="text-center text-sm">
        {art.say(`Pick one card to pass to the ${a.distress.dir}. {Trumps} stay.`)}
      </p>
      {seats.map((seat) => {
        const cards =
          seat === DUMMY ? (a.dummy?.up.filter((c): c is CardId => !!c) ?? []) : (a.hand ?? []);
        const chosen = a.distress.myPass[seat];
        return (
          <div key={seat} className="space-y-1">
            {seat === DUMMY && <p className="text-xs font-semibold">For {name(DUMMY)}</p>}
            <div className="flex flex-wrap justify-center gap-1.5">
              {cards.map((c) => (
                <CardFace
                  key={c}
                  card={c}
                  size="sm"
                  state={chosen === c ? 'selected' : isTrump(c) ? 'dim' : 'legal'}
                  {...(!isTrump(c) && {
                    onClick: () =>
                      void act({
                        type: 'pass-card',
                        card: c,
                        ...(seat === DUMMY && { for: DUMMY }),
                      }),
                  })}
                  testId={`mc-pass-${c}`}
                />
              ))}
            </div>
          </div>
        );
      })}
      {Object.keys(a.distress.received).length > 0 && (
        <p className="text-center text-sm">
          You got <CardChip card={Object.values(a.distress.received)[0]!} />
        </p>
      )}
    </Panel>
  );
}

/** Predictions: the holders of a prediction task name their number of tricks. */
export function PredictPanel({
  a,
  act,
  name,
}: {
  a: AttemptView;
  act: Act;
  name: (id: string) => string;
}) {
  const mine = a.tasks.filter(
    (t) => t.check.kind === 'predict' && t.owner && a.controls.includes(t.owner),
  );
  return (
    <Panel className="space-y-3" data-testid="mc-predict">
      {mine.map((t) => (
        <div key={t.index} className="space-y-2">
          <p className="text-sm font-semibold">
            {t.text}
            {t.owner === DUMMY ? ` (${name(DUMMY)})` : ''}
            {t.predictionSecret ? ' · only you will know the number' : ' · everyone will see it'}
          </p>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: a.total + 1 }, (_, n) => (
              <Button
                key={n}
                size="sm"
                variant={t.prediction === n ? 'primary' : 'secondary'}
                onClick={() => void act({ type: 'predict', task: t.index, n })}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
      ))}
      {!mine.length && <p className="text-center text-sm">Waiting for the predictions…</p>}
    </Panel>
  );
}

/** First-time tips, once per browser (per seat in a playtest). */
export function useTip(id: string): [boolean, () => void] {
  const key = storageKey(`mc.tip.${id}`);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return true;
    }
  });
  return [
    !seen,
    () => {
      setSeen(true);
      try {
        localStorage.setItem(key, '1');
      } catch {
        // Private windows: the tip just shows again next time.
      }
    },
  ];
}
