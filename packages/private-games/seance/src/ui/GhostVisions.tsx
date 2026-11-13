import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Drawer,
  FIT_SIZE_VAR,
  RefusalSlot,
  StickyBar,
  cn,
  useFitSize,
  useFreeHeight,
  useWideScreen,
} from '@vt/ui';
import { type ReactNode, useRef, useState } from 'react';
import { PILLARS } from '../logic/cards.ts';
import { HOURS, type PsychicView, type SeanceAction, type SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CandidatesRow } from './Candidates.tsx';
import { Avatar, Card } from './Card.tsx';
import { psychicCards } from './Ghost.tsx';
import { PickableCard, PickButton, cardsOf, useLook } from './Look.tsx';
import { PastGuesses } from './PastGuesses.tsx';
import { HourClock, visionCaptions } from './Psychic.tsx';
import { TableTab } from './Table.tsx';
import { Tip } from './Tips.tsx';
import { atTable, isEmpty, pastGuesses, roman, waitingForVision } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** The least height the screen keeps on a short window: below it the page scrolls instead. */
const MIN_HEIGHT_PX = 420;
/** The gap between cards, in rem (Tailwind's `gap-2`). */
const GAP = '0.5rem';

/** Whether the ghost still owes this psychic the hour's vision. */
const needsVision = (g: NonNullable<SeanceView['game']>, p: PsychicView) =>
  !!PILLARS[p.step] && !isEmpty(p) && !g.sent.includes(p.color);

/** The chip's state, in a word and in full (for its accessible name). */
function chipState(
  g: NonNullable<SeanceView['game']>,
  p: PsychicView,
  away: boolean,
): { word: string; long: string; tone: 'wait' | 'done' | 'quiet' } {
  if (p.gone) return { word: 'Left', long: 'left', tone: 'quiet' };
  if (p.absent) return { word: '💤 Away', long: 'away, seat empty', tone: 'quiet' };
  if (p.step >= 3) return { word: '✓ Done', long: 'found all three', tone: 'done' };
  if (needsVision(g, p))
    return {
      word: away ? '💤 Waiting' : 'Waiting',
      long: `${away ? 'away, ' : ''}waiting for a vision`,
      tone: 'wait',
    };
  if (p.ready) return { word: '✓ Ready', long: 'vision sent, ready', tone: 'done' };
  return { word: '✓ Sent', long: 'vision sent, not ready', tone: 'done' };
}

/** The seven hours as small marks, the current one lit (the Table drawer has the full clock). */
function HourDots({ hour }: { hour: number }) {
  return (
    <ol aria-label={`Hour ${roman(hour)} of VII`} className="flex items-center gap-0.5">
      {Array.from({ length: HOURS }, (_, i) => i + 1).map((h) => (
        <li
          key={h}
          aria-current={h === hour ? 'step' : undefined}
          className={cn(
            'h-2 w-3 rounded-sm',
            h < hour ? 'bg-line-strong' : h === hour ? 'bg-special' : 'bg-sunk ring-1 ring-line',
            h === HOURS && h !== hour && 'ring-danger/70',
          )}
        />
      ))}
    </ol>
  );
}

/**
 * The ghost's screen while visions are sent: one turn line (what to do now, a small table line
 * and the Table drawer), the psychics as chips, the chosen psychic's target big with their kind
 * of cards on the table beside it, and the hand to pick their vision from. Everything fits the
 * window; the table's details wait in the drawer.
 */
export function GhostVisions({
  view,
  room,
  act,
  content,
  away,
  notes,
  hostTools,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  /** Psychics whose device dropped: their vision can wait until last. */
  away: readonly PsychicView['color'][];
  /** The room's notices (empty seats, the latest news), under the turn line. */
  notes: ReactNode;
  /** The host's own controls (Lock the guesses in), in the Table drawer. */
  hostTools?: ReactNode;
}) {
  const g = view.game!;
  const wide = useWideScreen();
  const psychics = [...atTable(g)].sort(
    (a, b) => Number(away.includes(a.color)) - Number(away.includes(b.color)),
  );
  // The chosen psychic (for this hour); by default the first still waiting for a vision.
  const [chosen, setChosen] = useState<{ color: PsychicView['color']; hour: number } | null>(null);
  const waiting = waitingForVision(g);
  const fallback =
    psychics.find((p) => needsVision(g, p) && !away.includes(p.color)) ??
    psychics.find((p) => needsVision(g, p)) ??
    psychics.find((p) => !isEmpty(p) && p.step < 3) ??
    psychics[0];
  const sel =
    (chosen?.hour === g.hour && psychics.find((p) => p.color === chosen.color)) || fallback;

  // Picks belong to the chosen psychic (and the hour): choosing another starts afresh.
  const pickKey = `${sel?.color}-${g.hour}`;
  const [picks, setPicks] = useState<{ key: string; cards: number[] }>({ key: '', cards: [] });
  // Choosing another psychic drops the picks, so coming back starts afresh too.
  const choose = (c: PsychicView['color']) => {
    if (c === sel?.color) return;
    setChosen({ color: c, hour: g.hour });
    setPicks({ key: '', cards: [] });
  };
  const hand = g.hand ?? [];
  const [raven, setRaven] = useState(false);
  const live = picks.key === pickKey ? picks.cards.filter((c) => hand.includes(c)) : [];
  const setLive = (cards: number[]) => setPicks({ key: pickKey, cards });
  const toggle = (c: number) =>
    setLive(live.includes(c) ? live.filter((x) => x !== c) : [...live, c]);
  const canRaven = g.ravensLeft > 0;
  const canSend = !!sel && needsVision(g, sel) && !raven;
  const [drawer, setDrawer] = useState(false);

  const send = () => {
    if (!sel || !live.length) return;
    void act({ type: 'send', to: sel.color, cards: live }, { anchor: 'seance-send' }).then((ok) => {
      if (!ok) return;
      setLive([]);
      // On to the next psychic still waiting.
      setChosen(null);
    });
  };
  const throwAway = () =>
    void act({ type: 'raven', cards: live }, { anchor: 'seance-raven' }).then((ok) => {
      if (ok) {
        setRaven(false);
        setLive([]);
      }
    });
  const revealButton = (
    <Button
      size="sm"
      className="w-full whitespace-nowrap lg:w-auto"
      onClick={() => void act({ type: 'reveal' }, { anchor: 'seance-reveal' })}
    >
      👻 Reveal the verdicts
    </Button>
  );

  // The turn line: the hour, the one thing to do now, and what is left.
  const searching = atTable(g).filter((p) => !isEmpty(p) && p.step < 3);
  const ready = searching.filter((p) => p.ready).length;
  const doing = waiting.length
    ? sel && needsVision(g, sel)
      ? `Send ${sel.name}’s vision`
      : 'Send the next vision'
    : g.canReveal
      ? 'Everyone’s ready'
      : 'Listen while they decide';
  const left = waiting.length
    ? `${waiting.length} ${wide ? `psychic${waiting.length === 1 ? '' : 's'} ` : ''}left`
    : g.canReveal
      ? ''
      : `${ready} of ${searching.length} ready`;
  const ravens = g.difficulty === 'easy' ? (g.ravenHour === g.hour ? 0 : 1) : g.ravensLeft;

  // The play area takes the height left in the window; the cards size to it.
  const root = useRef<HTMLDivElement>(null);
  const free = useFreeHeight(root);
  const height = free === null ? undefined : Math.max(MIN_HEIGHT_PX, free);

  const pillar = sel ? PILLARS[sel.step] : undefined;
  const target = pillar && sel ? sel.targets?.[sel.step] : undefined;
  const { look, viewer } = useLook(content);
  // Picking from the full-screen view closes it, back to the hand with the card picked.
  const pickLabel = raven ? 'Throw away' : 'Pick';
  const pickedLabel = raven ? '✓ Throw away' : '✓ Picked';
  const canPick = raven || canSend;
  const { look: lookHand, viewer: handViewer } = useLook(content, (c, close) =>
    canPick ? (
      <PickButton
        kind="vision"
        n={c.n}
        on={live.includes(c.n)}
        onToggle={() => {
          toggle(c.n);
          close();
        }}
        label={pickLabel}
        onLabel={pickedLabel}
        big
      />
    ) : null,
  );

  const rows = Math.max(1, Math.ceil(hand.length / 4));
  // Phones: the cards size to the hand's own box. Wide screens: the hand is as tall as the window
  // lets it be (`useFitSize`, a card's height in px), no wider than 45% of the screen, and the
  // target and the table cards take the width left.
  const handWidth = wide
    ? `min(var(${FIT_SIZE_VAR}, 160px) * 700 / 1024, (45cqw - 3 * ${GAP} - 1.5rem) / 4)`
    : `min((100cqw - 3 * ${GAP}) / 4, ((100cqh - ${rows - 1} * ${GAP}) / ${rows}) * 700 / 1024)`;
  const handList = useRef<HTMLUListElement>(null);
  useFitSize(handList, { on: wide, min: 120, max: 520 });
  const tableCards = pillar ? g.table[pillar].length : 0;
  const tableRows = Math.max(1, Math.ceil(tableCards / 2));
  const tableWidth = `min((100cqw - ${GAP}) / 2, ((100cqh - ${tableRows - 1} * ${GAP}) / ${tableRows}) * 1024 / 700)`;

  const action = raven ? (
    <Button className="w-full" disabled={!live.length} onClick={throwAway}>
      🐦‍⬛ Throw away {live.length || ''} and draw
    </Button>
  ) : canSend && sel ? (
    <Button className="w-full" disabled={!live.length} onClick={send}>
      👻{' '}
      {live.length
        ? `Send ${live.length} card${live.length === 1 ? '' : 's'} to ${sel.name}`
        : `Send to ${sel.name}`}
    </Button>
  ) : !wide && g.canReveal ? (
    revealButton
  ) : null;

  const hasHoldings =
    !!sel &&
    ((!!pillar && sel.intuition !== null) ||
      sel.visions.length > 0 ||
      pastGuesses(g, sel.color).length > 0);
  const holdings = sel && (
    <div
      tabIndex={0}
      role="group"
      aria-label={`What ${sel.name} holds`}
      className="flex shrink-0 items-start gap-3 overflow-x-auto pb-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
    >
      {pillar && sel.intuition !== null && (
        <div className="shrink-0 space-y-0.5">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Their guess
          </p>
          <div className="w-16 lg:w-24">
            <Card
              kind={content.kindOf(pillar)}
              n={sel.intuition}
              content={content}
              note={`${sel.name}’s guess`}
              onTap={() => {
                const cards = psychicCards(sel, g);
                look(cards, cards.length - 1, `${sel.name}’s cards`);
              }}
              className={sel.intuition === target ? 'ring-2 ring-success' : 'ring-2 ring-danger'}
            />
          </div>
        </div>
      )}
      {sel.visions.length > 0 && (
        <div className="shrink-0 space-y-0.5">
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Visions they hold
          </p>
          <ul aria-label={`Visions ${sel.name} holds`} className="flex items-end gap-1">
            {sel.visions.map((v, i) => (
              <li key={`${v.card}-${i}`} className="w-10 shrink-0 text-center lg:w-14">
                <Card
                  kind="vision"
                  n={v.card}
                  content={content}
                  note={`sent to ${sel.name}, hour ${roman(v.hour)}`}
                  onTap={() =>
                    look(
                      cardsOf(
                        'vision',
                        sel.visions.map((x) => x.card),
                        visionCaptions(sel, g.hour),
                      ),
                      i,
                      `Visions ${sel.name} holds`,
                    )
                  }
                />
                <p className="text-xs leading-none text-ink-2">hour {roman(v.hour)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PastGuesses g={g} p={sel} content={content} compact />
    </div>
  );

  return (
    <>
      {viewer}
      {handViewer}
      {/* The turn line: what to do now, then a small line of the table and its drawer. */}
      <section
        aria-label="Your turn"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-special-soft px-3 py-2 ring-1 ring-special-line"
      >
        <p role="status" className="min-w-0 flex-1 text-sm lg:text-base">
          <span aria-hidden>👻 </span>
          <span className="font-bold">Hour {roman(g.hour)}</span>
          <span className="text-ink-muted"> · </span>
          <span className="font-semibold">{doing}</span>
          {left && <span className="text-ink-muted"> · {left}</span>}
        </p>
        {wide && g.canReveal && revealButton}
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-2 lg:text-sm">
          <HourClock view={view} room={room} />
          <span className={cn(!wide && 'sr-only')}>
            🐦‍⬛ {ravens} raven{ravens === 1 ? '' : 's'}
          </span>
          {wide && <HourDots hour={g.hour} />}
          <Button
            size="sm"
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => setDrawer(true)}
          >
            {!wide && <span aria-hidden>🐦‍⬛ {ravens} · </span>}Table ›
          </Button>
        </div>
        <RefusalSlot anchor="seance-reveal" className="basis-full" />
      </section>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="The table" className="max-w-md">
        {drawer && (
          <div className="space-y-3">
            {!wide && <HourDots hour={g.hour} />}
            <TableTab view={view} content={content} />
            {hostTools}
          </div>
        )}
      </Drawer>
      {notes}
      <Tip id="ghost-silent">
        🤫 You’re the ghost: not a word, a nod or a sigh. Your pictures do the talking. Tap a card
        to see it full screen; Pick the cards for a psychic, then Send.
      </Tip>
      <div
        ref={root}
        // Wide screens: at least the free height, so a hand too tall for it grows the page and
        // `useFitSize` shrinks it back; phones: exactly that height, which the cards size to.
        style={wide ? { minHeight: height } : { height }}
        className="flex min-h-0 flex-col gap-2"
        data-ui="ghost-visions"
        // Wide screens: the room frame drops its 1440 px cap for this screen (index.css).
        data-vt-full-width=""
      >
        {/* The psychics, one chip each: tap one to see their target and send their vision. */}
        <ul aria-label="Psychics" className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 py-0.5">
          {psychics.map((p) => {
            const isAway = away.includes(p.color);
            const st = chipState(g, p, isAway);
            const pl = PILLARS[p.step];
            const step = pl
              ? `${content.pillarName(pl).toLowerCase()} ${p.step + 1}/3`
              : 'found all 3';
            const on = p.color === sel?.color;
            return (
              <li key={p.color} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${p.name}: ${step}, ${st.long}`}
                  onClick={() => {
                    choose(p.color);
                    setRaven(false);
                  }}
                  className={cn(
                    'flex min-h-11 items-center gap-2 rounded-xl bg-card py-1 pr-3 pl-1 text-left ring-1 ring-line hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent',
                    on && 'bg-accent-soft ring-2 ring-accent',
                    (p.gone || p.absent) && 'opacity-70',
                  )}
                >
                  <Avatar color={p.color} content={content} name={p.name} size="sm" />
                  <span className="leading-tight">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm font-bold">{p.name}</span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 text-xs font-semibold',
                          st.tone === 'wait'
                            ? 'bg-sunk text-ink'
                            : st.tone === 'done'
                              ? 'bg-success-soft text-success-ink'
                              : 'bg-sunk text-ink-muted',
                        )}
                      >
                        {st.word}
                      </span>
                    </span>
                    <span className="block text-xs text-ink-muted">{step}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-3 lg:[container-type:inline-size]">
          {/* The chosen psychic: their target big, what they hold under it, their cards beside. */}
          {sel && (
            <section
              role="region"
              aria-label={`${sel.name} (ghost view)`}
              className="flex min-h-0 flex-[5_1_0] flex-col gap-1.5 rounded-xl bg-card p-2 ring-1 ring-line lg:p-3 lg:[container-type:size]"
            >
              {pillar && target !== undefined ? (
                <div
                  className={cn(
                    'grid min-h-0 flex-1 grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-2 lg:gap-3',
                    hasHoldings ? '[--below:6.75rem] lg:[--below:8.75rem]' : '[--below:1.75rem]',
                  )}
                  // Wide screens: the target's column is as wide as the target (up to 4/7), so a
                  // target limited by the height leaves no gap; the table cards take the rest.
                  style={
                    wide
                      ? {
                          gridTemplateColumns:
                            'min(calc((100% - 0.75rem) * 4 / 7), calc((100cqh - 1.5rem - var(--below)) * 1024 / 700)) minmax(0, 1fr)',
                        }
                      : undefined
                  }
                >
                  {/* The column is the size the target fits: what it holds sits right under it. */}
                  <div className="flex min-h-0 flex-col gap-1.5 [container-type:size]">
                    <h3 className="shrink-0 truncate text-sm font-semibold">
                      {sel.name}’s target{' '}
                      <span className="font-normal text-ink-muted">
                        · {content.pillarName(pillar).toLowerCase()}, {sel.step + 1} of 3
                      </span>
                    </h3>
                    <div className="shrink-0">
                      <div className="w-[min(100cqw,calc((100cqh-var(--below))*1024/700))]">
                        <Card
                          kind={content.kindOf(pillar)}
                          n={target}
                          content={content}
                          size="big"
                          note={`${sel.name}’s target`}
                          onTap={() => look(psychicCards(sel, g), 0, `${sel.name}’s cards`)}
                        >
                          <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-xs font-bold text-white uppercase">
                            Target
                          </span>
                        </Card>
                      </div>
                    </div>
                    {holdings}
                  </div>
                  <div className="flex min-h-0 flex-col gap-1.5">
                    <h3 className="shrink-0 truncate text-sm font-semibold">
                      <span className="lg:hidden">On the table</span>
                      <span className="max-lg:hidden">
                        {content.pillarPlural(pillar)} on the table{' '}
                        <span className="font-normal text-ink-muted">
                          · {sel.name} chooses from these
                        </span>
                      </span>
                    </h3>
                    <div className="min-h-0 flex-1 [container-type:size]">
                      <CandidatesRow
                        g={g}
                        pillar={pillar}
                        content={content}
                        one={sel}
                        label={`${content.pillarPlural(pillar)} on the table for ${sel.name}`}
                        listClassName="content-start"
                        listStyle={{ gridTemplateColumns: `repeat(2, ${tableWidth})`, gap: GAP }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  <p className="text-sm font-semibold">
                    {sel.step >= 3
                      ? `✅ ${sel.name} has found all three.`
                      : `${sel.name}’s seat is empty.`}
                  </p>
                  {holdings}
                </div>
              )}
            </section>
          )}
          {/* The hand: tap to look, Pick to choose, Send under it. */}
          <section className="flex min-h-0 flex-[6_1_0] flex-col gap-1.5 rounded-xl bg-card p-2 ring-1 ring-line lg:p-3">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-bold">Your hand</h3>
                <p className="truncate text-xs text-ink-muted">
                  {raven
                    ? `Tap Throw away on the cards to lose, then draw back up to 7.${g.difficulty === 'easy' ? ' One raven per hour.' : ''}`
                    : canSend && sel
                      ? live.length
                        ? `${live.length} picked for ${sel.name}`
                        : `Pick cards for ${sel.name}`
                      : 'Tap a card to see it full screen.'}
                </p>
              </div>
              <Button
                size="sm"
                variant={raven ? 'primary' : 'secondary'}
                aria-pressed={raven}
                disabled={!canRaven}
                onClick={() => {
                  setRaven(!raven);
                  setLive([]);
                }}
              >
                🐦‍⬛ Raven{g.difficulty === 'easy' ? '' : ` (${g.ravensLeft} left)`}
              </Button>
            </div>
            <div className={cn(wide ? 'shrink-0' : 'min-h-0 flex-1 [container-type:size]')}>
              <ul
                ref={handList}
                aria-label="Your hand"
                className="grid content-start"
                style={{ gridTemplateColumns: `repeat(4, ${handWidth})`, gap: GAP }}
              >
                {hand.map((c, i) => (
                  <li key={c}>
                    <PickableCard
                      kind="vision"
                      n={c}
                      content={content}
                      onLook={() => lookHand(cardsOf('vision', hand), i, 'Your hand')}
                      pick={
                        canPick
                          ? {
                              on: live.includes(c),
                              onToggle: () => toggle(c),
                              label: pickLabel,
                              onLabel: pickedLabel,
                            }
                          : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
            {action && (
              <div className="mt-auto">
                <StickyBar fixed refusal={raven ? 'seance-raven' : 'seance-send'}>
                  {action}
                </StickyBar>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
