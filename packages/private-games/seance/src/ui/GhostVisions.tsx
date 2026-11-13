import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, cn, useWideScreen } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import { PILLARS, kindOf } from '../logic/cards.ts';
import type { GameView, PsychicView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CandidatesRow } from './Candidates.tsx';
import { Avatar, Card } from './Card.tsx';
import { GAP, GhostFrame, GhostTurnLine, HandPanel } from './GhostShell.tsx';
import { type LookCard, cardsOf, useLook } from './Look.tsx';
import { PastGuesses } from './PastGuesses.tsx';
import { HourClock, visionCaptions } from './Psychic.tsx';
import { atTable, isEmpty, pastGuesses, roman, waitingForVision } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** Everything the ghost can look at for one psychic: the target, the visions they hold, their guess. */
export function psychicCards(p: PsychicView, g: GameView): LookCard[] {
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

  const pillar = sel ? PILLARS[sel.step] : undefined;
  const target = pillar && sel ? sel.targets?.[sel.step] : undefined;
  const { look, viewer } = useLook(content);
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
      <GhostTurnLine
        view={view}
        content={content}
        lead={`Hour ${roman(g.hour)}`}
        doing={doing}
        rest={left}
        clock={<HourClock view={view} room={room} />}
        clockOnPhone
        actions={g.canReveal && revealButton}
        refusal="seance-reveal"
        notes={notes}
        hostTools={hostTools}
      />
      <GhostFrame name="ghost-visions">
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
          <HandPanel
            className="flex-[6_1_0]"
            hand={hand}
            content={content}
            sub={
              raven
                ? `Tap Throw away on the cards to lose, then draw back up to 7.${g.difficulty === 'easy' ? ' One raven per hour.' : ''}`
                : canSend && sel
                  ? live.length
                    ? `${live.length} picked for ${sel.name}`
                    : `Pick cards for ${sel.name}`
                  : 'Tap a card to see it full screen.'
            }
            picked={live}
            pickable={raven || canSend ? () => true : undefined}
            onToggle={toggle}
            pickLabel={raven ? 'Throw away' : 'Pick'}
            pickedLabel={raven ? '✓ Throw away' : '✓ Picked'}
            raven={raven}
            onRaven={() => {
              setRaven(!raven);
              setLive([]);
            }}
            ravenDisabled={!canRaven}
            ravenLabel={`Raven${g.difficulty === 'easy' ? '' : ` (${g.ravensLeft} left)`}`}
            footer={action}
            refusal={raven ? 'seance-raven' : 'seance-send'}
          />
        </div>
      </GhostFrame>
    </>
  );
}
