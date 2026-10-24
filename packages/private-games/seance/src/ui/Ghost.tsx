import { Button, Modal, Panel, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { PILLARS, kindOf } from '../logic/cards.ts';
import type { GameView, PsychicView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CandidatesRow, TableOverview, candidateMarks, candidateNote } from './Candidates.tsx';
import { Tip } from './Tips.tsx';
import { Avatar, Card } from './Card.tsx';
import { PastGuesses } from './PastGuesses.tsx';
import { type LookCard, PickableCard, PickButton, cardsOf, useLook } from './Look.tsx';
import { type CompareSpec, visionCaptions } from './Psychic.tsx';
import { atTable, roman } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** The silent reminder on every ghost screen. */
export function SilentNote() {
  return (
    <p className="rounded-xl bg-violet-950 px-3 py-1.5 text-center text-sm text-violet-100 ring-1 ring-special dark:ring-violet-700">
      🤫 You’re the ghost: not a word, a nod or a sigh. Your pictures do the talking.
    </p>
  );
}

/** Everything the ghost can look at for one psychic: the target, the visions they hold, their guess. */
function psychicCards(p: PsychicView, g: GameView): LookCard[] {
  const pillar = PILLARS[p.step];
  const target = pillar ? p.targets?.[p.step] : undefined;
  if (!pillar) return [];
  return [
    ...(target !== undefined
      ? [
          {
            kind: kindOf(pillar, g.third),
            n: target,
            caption: `${p.name}’s target`,
          } satisfies LookCard,
        ]
      : []),
    ...cardsOf(
      'vision',
      p.visions.map((v) => v.card),
      visionCaptions(p, g.hour),
    ).map((c) => ({
      ...c,
      caption: `Sent to ${p.name} · ${c.caption ?? ''}`,
    })),
    ...(p.intuition !== null
      ? [
          {
            kind: kindOf(pillar, g.third),
            n: p.intuition,
            caption: `${p.name}’s guess${p.intuition === target ? ' (right)' : ' (wrong)'}`,
          } satisfies LookCard,
        ]
      : []),
  ];
}

/** One psychic in a sheet: their target big, every vision they hold at a readable size, their guess. */
function PsychicSheet({
  p,
  g,
  content,
  onClose,
  onChoose,
}: {
  p: PsychicView;
  g: GameView;
  content: Content;
  onClose: () => void;
  onChoose?: () => void;
}) {
  const { look, viewer } = useLook(content);
  const pillar = PILLARS[p.step];
  const cards = psychicCards(p, g);
  const target = pillar ? p.targets?.[p.step] : undefined;
  const at = (kind: LookCard['kind'], n: number, from = 0) =>
    cards.findIndex((c, i) => i >= from && c.kind === kind && c.n === n);
  const open = (i: number) => look(cards, Math.max(0, i), `${p.name}’s cards`);
  const visionStart = target !== undefined ? 1 : 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${p.name}’s cards`}
      footer={
        onChoose && (
          <Button className="w-full" onClick={onChoose}>
            🔍 Choose {p.name}’s vision
          </Button>
        )
      }
    >
      {viewer}
      {!pillar || target === undefined ? (
        <div className="space-y-3">
          <p className="text-sm">✅ {p.name} has found all three.</p>
          <PastGuesses g={g} p={p} content={content} />
        </div>
      ) : (
        <div className="space-y-3">
          <section aria-label={`${p.name}’s target`} className="space-y-1">
            <h3 className="text-sm font-semibold">
              Target: their {content.pillarName(pillar).toLowerCase()} ({p.step + 1} of 3)
            </h3>
            <div className="mx-auto max-w-sm">
              <Card
                kind={content.kindOf(pillar)}
                n={target}
                content={content}
                size="big"
                note={`${p.name}’s target`}
                onTap={() => open(0)}
              />
            </div>
          </section>
          <section aria-label={`${p.name}’s candidates`} className="space-y-1">
            <h3 className="text-sm font-semibold">
              {content.pillarPlural(pillar)} on the table{' '}
              <span className="font-normal text-ink-muted">
                (what {p.name} chooses from: steer away from the look-alikes)
              </span>
            </h3>
            <CandidatesRow
              g={g}
              pillar={pillar}
              content={content}
              one={p}
              label={`${content.pillarPlural(pillar)} on the table for ${p.name}`}
            />
          </section>
          <section aria-label={`Visions ${p.name} holds`} className="space-y-1">
            <h3 className="text-sm font-semibold">
              Visions they hold{' '}
              <span className="font-normal text-ink-muted">({p.visions.length})</span>
            </h3>
            {p.visions.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {p.visions.map((v, i) => (
                  <li key={`${v.card}-${i}`} className="space-y-0.5">
                    <Card
                      kind="vision"
                      n={v.card}
                      content={content}
                      note={`hour ${roman(v.hour)}`}
                      onTap={() => open(visionStart + i)}
                    />
                    <p className="text-center text-[11px] text-ink-muted">
                      {visionCaptions(p, g.hour)[v.card]}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No vision yet.</p>
            )}
          </section>
          <section aria-label={`${p.name}’s guess`} className="space-y-1">
            <h3 className="text-sm font-semibold">Their guess</h3>
            {p.intuition !== null ? (
              <div className="max-w-[12rem]">
                <Card
                  kind={content.kindOf(pillar)}
                  n={p.intuition}
                  content={content}
                  note={`${p.name}’s guess`}
                  onTap={() =>
                    open(at(kindOf(pillar, g.third), p.intuition!, visionStart + p.visions.length))
                  }
                  className={
                    p.intuition === target
                      ? 'ring-2 ring-success dark:ring-emerald-500'
                      : 'ring-2 ring-danger dark:ring-rose-500'
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No guess yet.</p>
            )}
          </section>
          <PastGuesses g={g} p={p} content={content} />
        </div>
      )}
    </Modal>
  );
}

/** The ghost's screen: one row per psychic, their target, what they hold and what they guess. */
export function GhostPsychics({
  view,
  content,
  compare,
  away = [],
}: {
  view: SeanceView;
  content: Content;
  compare: (spec: CompareSpec) => void;
  /** Psychics whose device dropped: marked, and their vision can wait until last. */
  away?: readonly PsychicView['color'][];
}) {
  const g = view.game!;
  // Phones: one compact row per psychic, opened with a tap.
  const [expanded, setExpanded] = useState<PsychicView['color'][]>([]);
  const sending = g.stage === 'visions';
  const { look, viewer } = useLook(content);
  const [sheet, setSheet] = useState<PsychicView['color'] | null>(null);
  const sheetFor = sheet ? atTable(g).find((p) => p.color === sheet) : undefined;
  const sendSpec = (p: PsychicView): CompareSpec | null => {
    const pillar = PILLARS[p.step];
    const target = pillar ? p.targets?.[p.step] : undefined;
    if (!pillar || target === undefined) return null;
    const needs = sending && !g.sent.includes(p.color) && !p.gone;
    // The target first, then the other candidates: swipe to check the vision fits it best.
    const others = g.table[pillar].filter((n) => n !== target);
    const marksOf = candidateMarks(g, pillar, [p]);
    const word = content.pillarName(pillar).toLowerCase();
    return {
      title: needs ? `Vision for ${p.name}: pick from your hand` : `${p.name}’s ${word}`,
      pinned: {
        kind: content.kindOf(pillar),
        cards: [target, ...others],
        target,
        captions: {
          [target]: `🎯 ${p.name}’s ${word}${others.length ? ' · swipe for the other candidates' : ''}`,
          ...Object.fromEntries(
            others.map((n) => [
              n,
              `Not it: another ${word} on the table${candidateNote(marksOf(n), p) ? ` · ${candidateNote(marksOf(n), p)}` : ''}`,
            ]),
          ),
        },
      },
      pinnedLabel: `${p.name}’s target and the other candidates`,
      strip: needs
        ? { kind: 'vision', cards: g.hand ?? [] }
        : p.visions.length
          ? {
              kind: 'vision',
              cards: p.visions.map((v) => v.card),
              captions: visionCaptions(p, g.hour),
            }
          : null,
      stripLabel: needs ? 'Your hand: pick the cards to send' : `What ${p.name} holds`,
      mode: needs ? 'send' : 'view',
      to: p.color,
    };
  };
  return (
    <>
      {viewer}
      {sheetFor && (
        <PsychicSheet
          p={sheetFor}
          g={g}
          content={content}
          onClose={() => setSheet(null)}
          onChoose={
            sending && PILLARS[sheetFor.step] && !g.sent.includes(sheetFor.color) && !sheetFor.gone
              ? () => {
                  const spec = sendSpec(sheetFor);
                  setSheet(null);
                  if (spec) compare(spec);
                }
              : undefined
          }
        />
      )}
      <Tip id="zoom">
        Tap any card to see it full screen: swipe for the next, pinch or double-tap to zoom. Tap a
        psychic’s name for all their cards (on a phone, open their row first), and Choose to pick
        their vision.
      </Tip>
      <TableOverview g={g} content={content} />
      <ul className="space-y-2" aria-label="Psychics">
        {/* Away seats last: the ghost serves the psychics who are there first. */}
        {[...atTable(g)]
          .sort((a, b) => Number(away.includes(a.color)) - Number(away.includes(b.color)))
          .map((p) => {
            const pillar = PILLARS[p.step];
            const target = pillar ? p.targets?.[p.step] : undefined;
            const sent = g.sent.includes(p.color);
            const needs = sending && pillar && !sent && !p.gone;
            const cards = psychicCards(p, g);
            const visionStart = target !== undefined ? 1 : 0;
            const open = (i: number) => look(cards, i, `${p.name}’s cards`);
            const openSend = () => {
              const spec = sendSpec(p);
              if (spec) compare(spec);
            };
            const isAway = away.includes(p.color);
            const isOpen = expanded.includes(p.color);
            const toggle = () =>
              setExpanded(isOpen ? expanded.filter((c) => c !== p.color) : [...expanded, p.color]);
            const sentCount = p.visions.length;
            const targetCard = () =>
              pillar && target !== undefined ? (
                <Card
                  kind={content.kindOf(pillar)}
                  n={target}
                  content={content}
                  note={`${p.name}’s target`}
                  onTap={() => open(0)}
                >
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] font-bold text-white uppercase">
                    Target
                  </span>
                </Card>
              ) : (
                <div className="flex aspect-[1024/700] items-center justify-center rounded-lg bg-success/15 dark:bg-emerald-600/15 text-2xl">
                  ✅
                </div>
              );
            return (
              <li key={p.color}>
                <Panel
                  role="region"
                  className={cn(
                    'p-2',
                    needs && !isAway && 'ring-2 ring-accent dark:ring-amber-400',
                  )}
                  aria-label={`${p.name} (ghost view)`}
                >
                  {!isOpen && (
                    <div className="flex items-center gap-2 lg:hidden">
                      <div className="w-24 shrink-0">{targetCard()}</div>
                      <button
                        type="button"
                        aria-expanded={false}
                        aria-label={`Show ${p.name}’s row`}
                        onClick={toggle}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-stone-800 dark:focus-visible:outline-amber-500"
                      >
                        <Avatar color={p.color} content={content} name={p.name} size="sm" />
                        <span className="min-w-0 flex-1 text-sm leading-tight font-semibold">
                          <span className="block truncate">
                            {p.name}
                            {p.gone ? (
                              <span className="ml-1 text-xs font-normal">(left)</span>
                            ) : (
                              isAway && <span className="ml-1 text-xs font-normal">(away)</span>
                            )}
                          </span>
                          <span className="block truncate text-xs font-normal text-ink-muted">
                            {pillar
                              ? `${sentCount} vision${sentCount === 1 ? '' : 's'} · ${p.intuition !== null ? 'guessed' : 'no guess'}`
                              : 'found all three'}
                          </span>
                        </span>
                        <span aria-hidden className="text-ink-muted">
                          ▾
                        </span>
                      </button>
                      {needs ? (
                        <Button
                          size="sm"
                          variant={isAway ? 'secondary' : 'primary'}
                          className="shrink-0"
                          onClick={openSend}
                          aria-label={`🔍 Choose ${p.name}’s vision`}
                        >
                          Choose
                        </Button>
                      ) : pillar && sending && !p.gone ? (
                        <span className="shrink-0 rounded-full bg-stone-200 px-2 text-[11px] font-semibold dark:bg-stone-800">
                          {p.ready ? 'ready' : 'sent'}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {isOpen && (
                    <button
                      type="button"
                      aria-expanded
                      onClick={toggle}
                      className="mb-1 w-full rounded-lg py-0.5 text-right text-xs font-semibold text-ink-muted lg:hidden"
                    >
                      Show less ▴
                    </button>
                  )}
                  <div
                    className={cn(
                      'grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)]',
                      !isOpen && 'hidden lg:grid',
                    )}
                  >
                    {targetCard()}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSheet(p.color)}
                          aria-label={`All of ${p.name}’s cards`}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left hover:bg-line/40 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-stone-800 dark:focus-visible:outline-amber-500"
                        >
                          <Avatar color={p.color} content={content} name={p.name} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm leading-tight font-semibold">
                            {p.name}
                            {p.gone ? (
                              <span className="ml-1 text-xs font-normal">(left)</span>
                            ) : (
                              isAway && <span className="ml-1 text-xs font-normal">(away)</span>
                            )}
                            <span className="block text-xs font-normal text-ink-muted">
                              {pillar
                                ? `${content.pillarName(pillar).toLowerCase()} ${p.step + 1}/3 · all cards ›`
                                : 'found all three'}
                            </span>
                          </span>
                        </button>
                        {needs ? (
                          <span className="rounded-full bg-accent-line dark:bg-amber-400 px-2 text-[11px] font-bold text-stone-950">
                            {isAway ? 'away · needs a vision' : 'needs a vision'}
                          </span>
                        ) : pillar && sending && !p.gone ? (
                          <span className="rounded-full bg-stone-200 px-2 text-[11px] font-semibold dark:bg-stone-800">
                            {p.ready ? 'ready' : 'sent'}
                          </span>
                        ) : null}
                      </div>
                      {pillar && (p.visions.length > 0 || p.intuition !== null) && (
                        <div
                          tabIndex={0}
                          role="group"
                          className="flex items-end gap-1 overflow-x-auto pb-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
                          aria-label={`What ${p.name} holds`}
                        >
                          {p.visions.map((v, i) => (
                            <div key={`${v.card}-${i}`} className="w-11 shrink-0 sm:w-12 xl:w-16">
                              <Card
                                kind="vision"
                                n={v.card}
                                content={content}
                                note={`sent to ${p.name}`}
                                onTap={() => open(visionStart + i)}
                              />
                            </div>
                          ))}
                          {p.intuition !== null && (
                            <div className="ml-1 w-16 shrink-0 xl:w-24">
                              <Card
                                kind={content.kindOf(pillar)}
                                n={p.intuition}
                                content={content}
                                note={`${p.name}’s guess`}
                                onTap={() => open(cards.length - 1)}
                                className={cn(
                                  p.intuition === target
                                    ? 'ring-2 ring-success dark:ring-emerald-500'
                                    : 'ring-2 ring-danger dark:ring-rose-500',
                                )}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <PastGuesses g={g} p={p} content={content} compact />
                      {needs && (
                        <Button size="sm" className="w-full" onClick={openSend}>
                          🔍 Choose {p.name}’s vision
                        </Button>
                      )}
                    </div>
                  </div>
                </Panel>
              </li>
            );
          })}
      </ul>
    </>
  );
}

/**
 * The ghost's hand, big: a swipeable row on phones, a grid on wide screens. A tap looks at a card
 * full screen; picking (for a raven, or a vision) is only ever the Pick button, so looking never
 * selects or sends anything.
 */
export function HandCards({
  hand,
  content,
  picked,
  onToggle,
  pickLabel = 'Pick',
  pickedLabel = '✓ Picked',
  canPick = () => true,
  label = 'Your hand',
}: {
  hand: readonly number[];
  content: Content;
  picked: readonly number[];
  /** Without it the cards can only be looked at. */
  onToggle?: (card: number) => void;
  pickLabel?: string;
  pickedLabel?: string;
  /** Whether a not-yet-picked card may be picked (the shared vision stops at 3). */
  canPick?: (card: number) => boolean;
  label?: string;
}) {
  const pick = (c: number) =>
    onToggle && {
      on: picked.includes(c),
      onToggle: () => onToggle(c),
      label: pickLabel,
      onLabel: pickedLabel,
      disabled: !picked.includes(c) && !canPick(c),
    };
  const { look, viewer } = useLook(content, (c) => {
    const p = pick(c.n);
    return p ? <PickButton kind="vision" n={c.n} {...p} big /> : null;
  });
  return (
    <>
      {viewer}
      <ul
        aria-label={label}
        tabIndex={0}
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent lg:mx-0 lg:grid lg:snap-none lg:grid-cols-3 lg:overflow-visible lg:px-0 2xl:grid-cols-4 dark:focus-visible:outline-amber-500"
      >
        {hand.map((c, i) => (
          <li
            key={c}
            className="w-[62%] max-w-64 shrink-0 snap-center sm:w-[40%] lg:w-auto lg:max-w-none"
          >
            <PickableCard
              kind="vision"
              n={c}
              content={content}
              onLook={() => look(cardsOf('vision', hand), i, label)}
              pick={pick(c) || undefined}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The hand: seven cards, and the ravens (throw any away and draw again). */
export function GhostHand({
  view,
  act,
  content,
}: {
  view: SeanceView;
  act: Act;
  content: Content;
}) {
  const g = view.game!;
  const [picked, setPicked] = useState<number[]>([]);
  const [raven, setRaven] = useState(false);
  const hand = g.hand ?? [];
  const live = picked.filter((c) => hand.includes(c));
  const canRaven = g.ravensLeft > 0 && g.stage !== 'vote' && g.stage !== 'done';
  return (
    <Panel className="space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">Your hand</h3>
        <Button
          size="sm"
          variant={raven ? 'primary' : 'secondary'}
          aria-pressed={raven}
          disabled={!canRaven}
          onClick={() => {
            setRaven(!raven);
            setPicked([]);
          }}
        >
          🐦‍⬛ Raven{g.difficulty === 'easy' ? '' : ` (${g.ravensLeft} left)`}
        </Button>
      </div>
      <p className="text-xs text-stone-600 dark:text-stone-400">
        {raven
          ? `Tap Throw away on the cards to lose, then draw back up to 7.${g.difficulty === 'easy' ? ' One raven per hour.' : ''}`
          : 'Tap a card to see it full screen. To send one, tap Choose on a psychic.'}
      </p>
      <HandCards
        hand={hand}
        content={content}
        picked={raven ? live : []}
        onToggle={
          raven
            ? (c) => setPicked(live.includes(c) ? live.filter((x) => x !== c) : [...live, c])
            : undefined
        }
        pickLabel="Throw away"
        pickedLabel="✓ Throw away"
      />
      {raven && (
        <Button
          className="w-full"
          disabled={!live.length}
          onClick={() =>
            void act({ type: 'raven', cards: live }, { anchor: 'seance-raven' }).then((ok) => {
              if (ok) {
                setRaven(false);
                setPicked([]);
              }
            })
          }
        >
          🐦‍⬛ Throw away {live.length || ''} and draw
        </Button>
      )}
      <RefusalSlot anchor="seance-raven" />
      <p className="text-xs text-ink-muted">{g.deckCount} cards left in the pile.</p>
    </Panel>
  );
}
