import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, StickyBar, cn, useWideScreen } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import type { GameView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card, CardBack } from './Card.tsx';
import { type SharedDraft, groupCards } from './Final.tsx';
import { GAP, GhostFrame, GhostTurnLine, HandPanel } from './GhostShell.tsx';
import { type LookCard, useLook } from './Look.tsx';
import type { CompareSpec } from './Psychic.tsx';
import { atTable, psychicByColor, roman, votersNow } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** What ended the hour, as the verdicts' heading says it. */
export const LOCKED_BY = {
  ghost: '👻 The ghost revealed the verdicts',
  host: '🔒 The host locked the guesses in',
  timer: '⏱ Time ran out',
} as const;

const ravenLabel = (g: GameView) =>
  `Raven${g.difficulty === 'easy' ? '' : ` (${g.ravensLeft} left)`}`;
const ravenSub = (g: GameView) =>
  `Tap Throw away on the cards to lose, then draw back up to 7.${g.difficulty === 'easy' ? ' One raven per hour.' : ''}`;

/** The hand's Raven: the cards to throw away, and the button that throws them. */
function useRaven(g: GameView, act: Act) {
  const [on, setOn] = useState(false);
  const [thrown, setThrown] = useState<number[]>([]);
  const hand = g.hand ?? [];
  const list = thrown.filter((c) => hand.includes(c));
  const toggle = (c: number) =>
    setThrown(list.includes(c) ? list.filter((x) => x !== c) : [...list, c]);
  const button = (
    <Button
      className="w-full"
      disabled={!list.length}
      onClick={() =>
        void act({ type: 'raven', cards: list }, { anchor: 'seance-raven' }).then((ok) => {
          if (ok) {
            setOn(false);
            setThrown([]);
          }
        })
      }
    >
      {list.length ? `🐦‍⬛ Throw away ${list.length} and draw` : 'Pick the cards to throw away first'}
    </Button>
  );
  return {
    on,
    list,
    toggle,
    button,
    flip: () => {
      setOn(!on);
      setThrown([]);
    },
  };
}

/** A clock and an action side by side: the phone's bar at the foot. */
function BarRow({ clock, action }: { clock?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {clock && <div className="shrink-0">{clock}</div>}
      {action && <div className="min-w-0 flex-1 [&>button]:w-full">{action}</div>}
    </div>
  );
}

/**
 * The ghost between hours: the verdicts (one tile per psychic: Found or Missed, the card they
 * guessed, their target beside it when they missed), the hand and Raven beside, and the clock with
 * Next hour (To the final, See the end) in the turn line.
 */
export function GhostReveal({
  view,
  room,
  act,
  content,
  notes,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  notes: ReactNode;
}) {
  const g = view.game!;
  const wide = useWideScreen();
  const raven = useRaven(g, act);
  const { look, viewer } = useLook(content);
  const last = g.hour >= 7;
  const allDone = atTable(g).every((p) => p.step >= 3);
  const go = allDone ? 'To the final' : last ? 'See the end' : 'Next hour';
  const clock = (
    <Countdown
      deadline={g.deadline}
      clockOffset={room.clockOffset}
      label="until the clock moves"
      soft
      expiredLabel="Moving on…"
      expiredHint=""
    />
  );
  const next = (
    <Button
      size={wide ? 'sm' : 'lg'}
      onClick={() => void act({ type: 'continue' }, { anchor: 'seance-continue' })}
    >
      {go}
    </Button>
  );
  const hour = g.verdicts.at(-1)?.hour ?? g.hour;
  const list = g.verdicts.filter((v) => v.hour === hour);
  // Every card of the verdicts, in order, for the full-screen view.
  const cards = list.flatMap((v): LookCard[] => {
    const p = psychicByColor(g, v.color);
    const kind = content.kindOf(PILLARS[v.step]!);
    const target = p?.targets?.[v.step];
    return [
      ...(v.guess !== null
        ? [
            {
              kind,
              n: v.guess,
              caption: `${p?.name ?? v.color}’s guess: ${v.correct ? 'right' : 'wrong'}`,
            },
          ]
        : []),
      ...(!v.correct && target !== undefined
        ? [{ kind, n: target, caption: `${p?.name ?? v.color}’s target` }]
        : []),
    ];
  });
  const at = (n: number) =>
    Math.max(
      0,
      cards.findIndex((c) => c.n === n),
    );
  const tiles = Math.max(1, list.length);
  // Each tile's height, and its cards' width: the tiles share the panel's height.
  const tileH = `((100cqh - ${tiles - 1} * ${GAP}) / ${tiles})`;
  const cardW = wide
    ? `min((100cqw - 14rem - 2 * ${GAP}) / 2, (${tileH} - 2.75rem) * 1024 / 700)`
    : `min((100cqw - 7.5rem - 2 * ${GAP}) / 2, (${tileH} - 1.25rem) * 1024 / 700)`;
  return (
    <>
      {viewer}
      <GhostTurnLine
        view={view}
        content={content}
        lead={`Hour ${roman(g.hour)}`}
        doing="The verdicts are in"
        rest={
          allDone
            ? 'The final next'
            : last
              ? 'That was the last hour'
              : `Hour ${roman(g.hour + 1)} next`
        }
        clock={clock}
        actions={next}
        refusal="seance-continue"
        notes={notes}
      />
      <GhostFrame name="ghost-reveal">
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-3 lg:[container-type:inline-size]">
          <Panel
            role="region"
            aria-label="The ghost answers"
            className="flex min-h-0 flex-[5_1_0] flex-col gap-2 p-2 lg:p-3"
          >
            <h3 className="shrink-0 font-semibold">
              <span>{g.lockedHow ? LOCKED_BY[g.lockedHow] : 'The verdicts'}</span>{' '}
              <span className="font-normal text-ink-muted">· Hour {roman(hour)}</span>
            </h3>
            <div className="min-h-0 flex-1 [container-type:size]">
              <ul aria-label="Verdicts" className="grid h-full content-start" style={{ gap: GAP }}>
                {list.map((v) => {
                  const p = psychicByColor(g, v.color);
                  const pillar = PILLARS[v.step]!;
                  const kind = content.kindOf(pillar);
                  const target = p?.targets?.[v.step];
                  const name = p?.name ?? v.color;
                  return (
                    <li
                      key={v.color}
                      className={cn(
                        'flex min-h-0 items-center gap-2 rounded-xl p-1.5 ring-1 lg:gap-3 lg:p-2',
                        v.correct
                          ? 'bg-success-soft ring-success-line'
                          : v.guess === null
                            ? 'bg-sunk ring-line'
                            : 'bg-danger-soft ring-danger-line',
                      )}
                      style={{ height: `calc(${tileH})` }}
                    >
                      <div className="flex w-28 shrink-0 items-center gap-2 lg:w-52 lg:gap-3">
                        <Avatar color={v.color} content={content} name={name} />
                        <div className="min-w-0 space-y-0.5">
                          <p className="truncate font-semibold">{name}</p>
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 text-xs font-bold whitespace-nowrap text-on-fill lg:text-sm',
                              v.correct
                                ? 'bg-success'
                                : v.guess === null
                                  ? 'bg-ink-muted'
                                  : 'bg-danger',
                            )}
                          >
                            {v.correct ? '✓ Found' : v.guess === null ? 'No guess' : '✕ Missed'}
                          </span>
                          <p className="text-xs text-ink-muted max-lg:hidden">
                            their {content.pillarName(pillar).toLowerCase()}
                          </p>
                          {v.marks.length > 0 && (
                            <p className="text-xs text-ink-muted max-lg:hidden">
                              {v.marks
                                .map(
                                  (m) =>
                                    `${m.kind === 'yes' ? '✓' : '✗'} ${psychicByColor(g, m.by)?.name ?? m.by}`,
                                )
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                      {v.guess !== null ? (
                        <figure className="m-0 shrink-0" style={{ width: cardW }}>
                          <Card
                            kind={kind}
                            n={v.guess}
                            content={content}
                            note={`${name}’s guess`}
                            onTap={() => look(cards, at(v.guess!), `Hour ${roman(hour)}`)}
                            className={v.correct ? 'ring-2 ring-success' : 'ring-2 ring-danger'}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                'absolute top-1 right-1 flex size-6 items-center justify-center rounded-full text-sm font-black text-on-fill',
                                v.correct ? 'bg-success' : 'bg-danger',
                              )}
                            >
                              {v.correct ? '✓' : '✕'}
                            </span>
                          </Card>
                          <figcaption className="truncate text-xs text-ink-2 max-lg:hidden">
                            {v.correct ? 'Guessed their target' : `${name} guessed`}
                          </figcaption>
                        </figure>
                      ) : (
                        <div
                          className="flex aspect-[1024/700] shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted"
                          style={{ width: cardW }}
                        >
                          {content.pillarIcon(pillar)} no guess
                        </div>
                      )}
                      {!v.correct && target !== undefined && (
                        <figure className="m-0 shrink-0" style={{ width: cardW }}>
                          <Card
                            kind={kind}
                            n={target}
                            content={content}
                            note={`${name}’s target`}
                            onTap={() => look(cards, at(target), `Hour ${roman(hour)}`)}
                          >
                            <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-xs font-bold text-white uppercase">
                              Target
                            </span>
                          </Card>
                          <figcaption className="text-xs text-ink-2 max-lg:hidden">
                            Their target
                          </figcaption>
                        </figure>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Panel>
          <HandPanel
            className="flex-[4_1_0]"
            hand={g.hand ?? []}
            content={content}
            sub={raven.on ? ravenSub(g) : 'Tap a card to see it full screen.'}
            picked={raven.on ? raven.list : []}
            pickable={raven.on ? () => true : undefined}
            onToggle={raven.toggle}
            pickLabel="Throw away"
            pickedLabel="✓ Throw away"
            raven={raven.on}
            onRaven={raven.flip}
            ravenDisabled={g.ravensLeft <= 0}
            ravenLabel={ravenLabel(g)}
            footer={raven.on ? raven.button : !wide && <BarRow clock={clock} action={next} />}
            refusal={raven.on ? 'seance-raven' : 'seance-continue'}
          />
        </div>
      </GhostFrame>
    </>
  );
}

/**
 * The line-up as the ghost sees it: one row per group (its number, psychic and, while the ghost
 * picks, "This is the culprit"), its three cards beside. Phones: a name line over the cards, which
 * fold away once the culprit's group is chosen.
 */
function GhostLineup({
  g,
  content,
  draft,
  setDraft,
  folded = false,
}: {
  g: GameView;
  content: Content;
  draft?: SharedDraft;
  setDraft?: (d: SharedDraft) => void;
  folded?: boolean;
}) {
  const f = g.final!;
  const wide = useWideScreen();
  const { look, viewer } = useLook(content);
  const picking = !!setDraft;
  const all = f.groups.flatMap((_, i) =>
    groupCards(g, i).map((n, k): LookCard => ({
      kind: content.kindOf(PILLARS[k]!),
      n,
      caption: `Group ${i + 1} · ${content.pillarName(PILLARS[k]!).toLowerCase()}`,
    })),
  );
  const startOf = (i: number) =>
    f.groups.slice(0, i).reduce((sum, _, j) => sum + groupCards(g, j).length, 0);
  const n = Math.max(1, f.groups.length);
  const rowH = `((100cqh - ${n - 1} * ${GAP}) / ${n})`;
  const cardW = wide
    ? `min((100cqw - 15rem - 2 * ${GAP}) / 3, (${rowH} - 1.25rem) * 1024 / 700)`
    : `min((100cqw - 1rem - 2 * ${GAP}) / 3, (${rowH} - 3.25rem) * 1024 / 700)`;
  return (
    <div className={cn('min-h-0 flex-1', !folded && '[container-type:size]')}>
      {viewer}
      <ul aria-label="Line-up" className="grid content-start" style={{ gap: GAP }}>
        {f.groups.map((color, i) => {
          const p = psychicByColor(g, color);
          const cards = groupCards(g, i);
          const selected = picking ? draft?.group === i : f.culprit === i;
          const button = picking && (
            <Button
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              className={cn(wide ? 'min-h-11 w-full' : 'h-9 min-h-9 shrink-0 px-3')}
              aria-pressed={selected}
              aria-label={
                selected ? '👻 The culprit’s group' : `This is the culprit (group ${i + 1})`
              }
              onClick={() => setDraft({ ...(draft ?? { cards: [], tags: {} }), group: i })}
            >
              {selected
                ? '👻 The culprit’s group'
                : wide
                  ? `This is the culprit (group ${i + 1})`
                  : 'Culprit'}
            </Button>
          );
          const head = (
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink font-serif font-bold text-card">
                {i + 1}
              </span>
              {p && <Avatar color={p.color} content={content} name={p.name} size="sm" />}
              <span className="min-w-0 flex-1 truncate text-sm">
                {p ? `${p.name}’s cards` : ''}
              </span>
              {!picking && selected && !wide && (
                <span className="text-sm font-bold text-special-ink">👻 culprit</span>
              )}
              {!wide && button}
            </div>
          );
          const row = (
            <div className="flex gap-2">
              {cards.map((c, k) => (
                <div key={k} className="shrink-0" style={{ width: cardW }}>
                  <Card
                    kind={content.kindOf(PILLARS[k]!)}
                    n={c}
                    content={content}
                    onTap={() => look(all, startOf(i) + k, 'The line-up')}
                  />
                </div>
              ))}
            </div>
          );
          return (
            <li key={color} className="min-w-0">
              <div
                aria-label={`Group ${i + 1}`}
                role="group"
                className={cn(
                  'rounded-xl ring-1 ring-line',
                  folded ? 'px-2 py-1' : 'p-2',
                  selected && 'bg-special/10 ring-2 ring-special',
                  wide && 'flex items-center gap-3',
                )}
              >
                {wide ? (
                  <>
                    <div className="w-56 shrink-0 space-y-2">
                      {head}
                      {!picking && selected && (
                        <p className="text-sm font-bold text-special-ink">👻 culprit</p>
                      )}
                      {button}
                    </div>
                    {row}
                  </>
                ) : (
                  <>
                    {head}
                    {!folded && <div className="mt-1.5">{row}</div>}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The final while the ghost picks: the line-up with "This is the culprit" per group, the hand with
 * Pick (three cards), each picked card tagged, and Send; Compare with the group and Raven stay.
 */
export function GhostShared({
  view,
  act,
  content,
  draft,
  setDraft,
  compare,
  notes,
}: {
  view: SeanceView;
  act: Act;
  content: Content;
  draft: SharedDraft;
  setDraft: (d: SharedDraft) => void;
  compare: (spec: CompareSpec) => void;
  notes: ReactNode;
}) {
  const g = view.game!;
  const wide = useWideScreen();
  const raven = useRaven(g, act);
  const { look, viewer } = useLook(content);
  const hand = g.hand ?? [];
  const cards = draft.cards.filter((c) => hand.includes(c));
  const group = draft.group;
  const ready = group !== null && cards.length === 3;
  const [showCards, setShowCards] = useState(false);
  const folded = !wide && group !== null && !showCards;
  const third = content.pillarName('object').toLowerCase();
  const toggle = (c: number) =>
    setDraft({
      ...draft,
      cards: cards.includes(c)
        ? cards.filter((x) => x !== c)
        : cards.length < 3
          ? [...cards, c]
          : cards,
    });
  const tag = (c: number, pl: Pillar) =>
    setDraft({ ...draft, tags: { ...draft.tags, [c]: draft.tags[c] === pl ? null : pl } });
  const doing =
    group === null
      ? wide
        ? 'Pick the culprit’s group'
        : 'Culprit’s group, then 3 cards'
      : cards.length < 3
        ? 'Pick 3 cards from your hand'
        : 'Tag the cards and send';
  const rest =
    group === null
      ? wide
        ? 'then 3 cards from your hand'
        : undefined
      : cards.length < 3
        ? `${cards.length} of 3`
        : undefined;
  const compareButton = (
    <Button
      size="sm"
      variant="secondary"
      aria-label="🔍 Compare with the group"
      disabled={group === null}
      onClick={() =>
        compare({
          title: `Group ${(group ?? 0) + 1}: pick 3 cards`,
          pinned: {
            kind: 'suspect',
            kinds: PILLARS.map(content.kindOf),
            cards: groupCards(g, group ?? 0),
          },
          pinnedLabel: 'The culprit’s group',
          strip: { kind: 'vision', cards: hand },
          stripLabel: 'Your hand: pick 3',
          mode: 'shared',
        })
      }
    >
      🔍{wide ? ' Compare with the group' : ''}
    </Button>
  );
  const send = (
    <Button
      size="lg"
      className="w-full"
      disabled={!ready}
      onClick={() =>
        void act(
          { type: 'shared', group: group!, cards, tags: cards.map((c) => draft.tags[c] ?? null) },
          { anchor: 'seance-shared' },
        )
      }
    >
      {ready
        ? '👻 Send the shared vision'
        : `Pick ${group === null ? 'a group and ' : ''}${3 - cards.length} more`}
    </Button>
  );
  return (
    <>
      {viewer}
      <GhostTurnLine
        view={view}
        content={content}
        lead="The final"
        doing={doing}
        rest={rest}
        notes={notes}
      />
      <GhostFrame name="ghost-shared">
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-3">
          <Panel
            role="region"
            aria-label="The line-up"
            className={cn(
              'flex min-h-0 flex-col gap-2 p-2 lg:p-3',
              folded ? 'shrink-0' : 'flex-[5_1_0]',
            )}
          >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                The line-up{' '}
                {wide && (
                  <span className="font-normal text-ink-muted">· pick the culprit’s group</span>
                )}
              </h3>
              <div className="flex gap-2">
                {!wide && group !== null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={showCards}
                    onClick={() => setShowCards(!showCards)}
                  >
                    {showCards ? 'Fold the groups' : 'Show the groups’ cards'}
                  </Button>
                )}
                {compareButton}
              </div>
            </div>
            <GhostLineup
              g={g}
              content={content}
              draft={draft}
              setDraft={setDraft}
              folded={folded}
            />
          </Panel>
          <HandPanel
            label="Choose the shared vision"
            className="flex-[6_1_0] lg:[container-type:inline-size]"
            widthCap="100cqw"
            compactSub
            hand={hand}
            content={content}
            sub={
              raven.on
                ? ravenSub(g)
                : `${cards.length ? `${cards.length} picked` : 'Pick 3'}: one for its suspect, one for its place, one for its ${third}`
            }
            picked={raven.on ? raven.list : cards}
            pickable={raven.on ? () => true : () => cards.length < 3}
            onToggle={raven.on ? raven.toggle : toggle}
            pickLabel={raven.on ? 'Throw away' : 'Pick'}
            pickedLabel={raven.on ? '✓ Throw away' : '✓ Picked'}
            raven={raven.on}
            onRaven={raven.flip}
            ravenDisabled={g.ravensLeft <= 0}
            ravenLabel={ravenLabel(g)}
            footer={raven.on ? raven.button : send}
            refusal={raven.on ? 'seance-raven' : 'seance-shared'}
          >
            {!raven.on && cards.length > 0 && (
              <div className="shrink-0 space-y-1">
                <p className="truncate text-sm font-semibold max-lg:sr-only">
                  {wide ? 'Your shared vision' : 'Tag each card'}{' '}
                  <span className="font-normal text-ink-muted">
                    {wide ? '· tag what each card means (only you see it)' : '(only you see it)'}
                  </span>
                </p>
                <ul aria-label="Tags" className="grid grid-cols-3 gap-1.5 lg:gap-2">
                  {cards.map((c, i) => (
                    <li
                      key={c}
                      className="flex items-center gap-1.5 rounded-xl p-1 ring-1 ring-line"
                    >
                      <span className="w-10 shrink-0">
                        <Card
                          kind="vision"
                          n={c}
                          content={content}
                          onTap={() =>
                            look(
                              cards.map((n, k) => ({
                                kind: 'vision',
                                n,
                                caption: `Card ${k + 1}`,
                              })),
                              i,
                              'Your shared vision',
                            )
                          }
                        />
                      </span>
                      {wide ? (
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="sr-only">Card {i + 1} means:</p>
                          {PILLARS.map((pl) => (
                            <Button
                              key={pl}
                              size="sm"
                              variant={draft.tags[c] === pl ? 'primary' : 'secondary'}
                              className="h-7 min-h-7 w-full justify-start px-2 text-xs"
                              aria-pressed={draft.tags[c] === pl}
                              onClick={() => tag(c, pl)}
                            >
                              {content.pillarIcon(pl)} {content.pillarName(pl)}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        // Phones: one joined three-way switch per card, its parts edge to edge
                        // so no tap reaches a neighbour.
                        <div
                          role="group"
                          aria-label={`Card ${i + 1} means`}
                          className="flex min-w-0 flex-1 flex-col divide-y divide-line-strong overflow-hidden rounded-lg ring-1 ring-line-strong"
                        >
                          {PILLARS.map((pl) => (
                            <button
                              key={pl}
                              type="button"
                              aria-pressed={draft.tags[c] === pl}
                              aria-label={`${content.pillarIcon(pl)} ${content.pillarName(pl)}`}
                              onClick={() => tag(c, pl)}
                              className={cn(
                                'grid h-9 touch-manipulation place-items-center text-base',
                                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                                draft.tags[c] === pl
                                  ? 'bg-accent text-accent-fg'
                                  : 'bg-card text-ink',
                              )}
                            >
                              {content.pillarIcon(pl)}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </HandPanel>
        </div>
      </GhostFrame>
    </>
  );
}

/**
 * The final while the psychics vote: the shared vision (the card still face down for them dimmed,
 * every card with its tag) beside the line-up with the culprit marked; whose vote it is, the clock
 * and the host's Close this round in the turn line. No hand.
 */
export function GhostVote({
  view,
  room,
  act,
  content,
  notes,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  notes: ReactNode;
}) {
  const g = view.game!;
  const f = g.final!;
  const wide = useWideScreen();
  const { look, viewer } = useLook(content);
  const now = votersNow(g);
  const strict = view.settings.timerMode === 'strict';
  const clock = (
    <Countdown
      deadline={g.deadline}
      clockOffset={room.clockOffset}
      soft={!strict}
      atZero={strict ? 'missing votes abstain' : undefined}
      expiredHint={strict ? undefined : 'The host can close this round.'}
    />
  );
  const close = room.isHost && (
    <Button
      size={wide ? 'sm' : 'lg'}
      variant="secondary"
      onClick={() => void act({ type: 'lock-now' })}
    >
      Close this round
    </Button>
  );
  const shared = [0, 1, 2].flatMap((i): LookCard[] => {
    const card = f.shared[i];
    return card === undefined
      ? []
      : [
          {
            kind: 'vision',
            n: card,
            caption: `Shared card ${i + 1}${i < f.revealed ? '' : ' (still face down for them)'}`,
          },
        ];
  });
  return (
    <>
      {viewer}
      <GhostTurnLine
        view={view}
        content={content}
        lead="The final"
        doing={`Card ${f.revealed} of 3 is up`}
        rest={now.length ? `Voting now: ${now.map((p) => p.name).join(', ')}` : undefined}
        clock={clock}
        actions={close}
        ravens={false}
        notes={notes}
      />
      <GhostFrame name="ghost-vote">
        <Panel className="flex min-h-0 flex-1 flex-col gap-3 p-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-6 lg:p-3">
          <section
            aria-label="Shared vision"
            className="min-h-0 shrink-0 space-y-1.5 lg:[container-type:size]"
          >
            <h3 className="font-semibold">
              The shared vision{' '}
              <span className="font-normal text-ink-muted">
                · {Math.min(f.revealed, 3)} of 3 face up
              </span>
            </h3>
            <ul
              className="grid grid-cols-3 gap-2"
              style={{
                width: wide
                  ? `min(100cqw, calc((100cqh - 4rem) * 700 / 1024 * 3 + 1rem))`
                  : 'min(100%, 21rem)',
              }}
            >
              {[0, 1, 2].map((i) => {
                const card = f.shared[i];
                const up = i < f.revealed;
                const tag = f.tags?.[i];
                return (
                  <li key={i} className="space-y-0.5">
                    {card !== undefined ? (
                      <Card
                        kind="vision"
                        n={card}
                        content={content}
                        note={`shared card ${i + 1}${up ? '' : ', still face down for them'}`}
                        dimmed={!up}
                        onTap={() =>
                          look(
                            shared,
                            shared.findIndex((c) => c.n === card),
                            'The shared vision',
                          )
                        }
                      >
                        {!up && (
                          <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 py-0.5 text-center text-xs text-white">
                            {wide ? 'still face down for them' : 'face down'}
                          </span>
                        )}
                      </Card>
                    ) : (
                      <CardBack content={content} />
                    )}
                    {tag && (
                      <p className="text-center text-xs font-semibold">
                        {content.pillarIcon(tag)} {content.pillarName(tag)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-label="The line-up" className="flex min-h-0 flex-1 flex-col gap-1.5">
            <h3 className="shrink-0 font-semibold">The line-up</h3>
            <GhostLineup g={g} content={content} />
          </section>
        </Panel>
        {!wide && (clock || close) && (
          <StickyBar fixed>
            <BarRow clock={clock} action={close} />
          </StickyBar>
        )}
      </GhostFrame>
    </>
  );
}
