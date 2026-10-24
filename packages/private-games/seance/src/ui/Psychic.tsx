import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, RefusalSlot, cn } from '@vt/ui';
import { PILLARS, type Pillar, isPillarCard, kindOf } from '../logic/cards.ts';
import type { GameView, PsychicView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Tip } from './Tips.tsx';
import { Avatar, Card } from './Card.tsx';
import { PickButton, PickableCard, cardsOf, useLook } from './Look.tsx';
import { useReadyNoteText } from './ready-note.ts';
import { PastGuesses } from './PastGuesses.tsx';
import type { CardRow } from './Compare.tsx';
import { atTable, myPsychic, notReady, pastGuesses, roman, triedCards } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** What a compare view should show: the pinned cards over a strip. */
export interface CompareSpec {
  title: string;
  pinned: CardRow;
  pinnedLabel?: string;
  strip?: CardRow | null;
  stripLabel?: string;
  /** psychic: the strip picks the viewer's guess; send: the ghost picks cards for a psychic. */
  mode: 'view' | 'guess' | 'send' | 'shared';
  to?: PsychicView['color'];
  start?: number;
}

export const visionCaptions = (p: PsychicView, hour: number) =>
  Object.fromEntries(
    p.visions.map((v) => [
      v.card,
      v.hour === hour ? `new · hour ${roman(v.hour)}` : `hour ${roman(v.hour)}`,
    ]),
  );

/** Who guessed each card of a pillar this hour: avatars on the card. */
export function guessersOf(g: GameView, card: number, pillar: Pillar) {
  return g.psychics.filter((p) => PILLARS[p.step] === pillar && p.intuition === card);
}

function Guessers({
  g,
  card,
  pillar,
  content,
}: {
  g: GameView;
  card: number;
  pillar: Pillar;
  content: Content;
}) {
  const list = guessersOf(g, card, pillar);
  if (!list.length) return null;
  return (
    <span className="absolute top-1 left-1 flex -space-x-1.5">
      {list.map((p) => (
        <Avatar key={p.color} color={p.color} content={content} name={p.name} size="sm" />
      ))}
    </span>
  );
}

/** A row of vision thumbnails; the newest ones get a dot. */
export function VisionStrip({
  p,
  g,
  content,
  onOpen,
  onLook,
  small,
}: {
  p: PsychicView;
  g: GameView;
  content: Content;
  onOpen: (i: number) => void;
  /** A long press: the vision full screen, where a tap opens the compare view. */
  onLook?: (i: number) => void;
  small?: boolean;
}) {
  if (!p.visions.length) return <p className="text-sm text-ink-muted">No vision yet.</p>;
  return (
    <ul
      tabIndex={0}
      className="flex gap-1.5 overflow-x-auto pb-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
      aria-label={`${p.name}’s visions`}
    >
      {p.visions.map((v, i) => (
        <li
          key={`${v.card}-${i}`}
          className={cn('shrink-0', small ? 'w-16 sm:w-20' : 'w-20 sm:w-28 xl:w-32')}
        >
          <Card
            kind="vision"
            n={v.card}
            content={content}
            note={`hour ${roman(v.hour)}`}
            onTap={() => onOpen(i)}
            onLongPress={onLook && (() => onLook(i))}
          >
            {v.hour === g.hour && g.stage !== 'done' && (
              <span className="absolute top-1 right-1 size-2.5 rounded-full bg-accent-line dark:bg-amber-400 ring-2 ring-stone-900" />
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** The viewer's own reading: their visions, the candidates for their current pillar, Ready. */
export function MineTab({
  view,
  room,
  act,
  content,
  compare,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  compare: (spec: CompareSpec) => void;
}) {
  const g = view.game!;
  const me = myPsychic(view)!;
  const pillar = PILLARS[me.step];
  const open = g.stage === 'visions';
  const candidates = pillar ? g.table[pillar] : [];
  const { look, viewer } = useLook(content, (c) =>
    pillar && isPillarCard(c.kind, pillar, g.third) && candidates.includes(c.n) ? (
      <PickButton
        kind={c.kind}
        n={c.n}
        big
        on={me.intuition === c.n}
        label="Guess this one"
        onLabel="✓ Your guess"
        disabled={!open}
        onToggle={() =>
          void act(
            { type: 'intuition', card: me.intuition === c.n ? null : c.n },
            { anchor: 'seance-ready' },
          )
        }
      />
    ) : null,
  );
  if (!pillar)
    return (
      <Panel className="space-y-2 p-3">
        {viewer}
        <h3 className="font-bold">🎉 You found all three</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {PILLARS.map((pl, i) => (
            <Card
              key={pl}
              kind={content.kindOf(pl)}
              n={me.found[i]!}
              content={content}
              onTap={() =>
                look(
                  PILLARS.map((k, j) => ({ kind: content.kindOf(k), n: me.found[j]! })),
                  i,
                  'Your three cards',
                )
              }
            />
          ))}
        </div>
        <PastGuesses g={g} p={me} content={content} compact />
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {g.clairvoyance && me.tokens > 0
            ? `Help the others: put your ${me.tokens} clairvoyance token${me.tokens === 1 ? '' : 's'} on their guesses (Others) before they lock in.`
            : 'Help the others talk it through.'}
        </p>
      </Panel>
    );
  const openCompare = (start = 0) =>
    compare({
      title: `Your vision → which ${content.pillarName(pillar).toLowerCase()}?`,
      pinned: {
        kind: 'vision',
        cards: me.visions.map((v) => v.card),
        captions: visionCaptions(me, g.hour),
      },
      pinnedLabel: 'Your vision',
      strip: { kind: content.kindOf(pillar), cards: candidates },
      stripLabel: `${content.pillarPlural(pillar)} on the table: tap your guess`,
      mode: 'guess',
      start,
    });
  const tried = triedCards(g, me);
  const kind = content.kindOf(pillar);
  const pillarWord = content.pillarName(pillar).toLowerCase();
  return (
    // One panel, top to bottom: your vision as a strip, the cards on the table, Ready. On a phone
    // that is one screen; past guesses and tips come after it.
    <div className="space-y-2">
      {viewer}
      <Panel className="space-y-2 p-2.5 sm:p-3">
        <div className="flex items-center gap-2">
          <Avatar color={me.color} content={content} name={me.name} size="sm" />
          <p className="min-w-0 flex-1 leading-tight">
            <span className="font-bold">Your vision</span>{' '}
            <span className="text-xs text-stone-600 dark:text-stone-400">
              · {pillarWord} {me.step + 1} of 3
            </span>
          </p>
          {me.visions.length > 0 && (
            <Button size="sm" onClick={() => openCompare()}>
              🔍 Compare
            </Button>
          )}
        </div>
        <VisionStrip
          p={me}
          g={g}
          content={content}
          onOpen={(i) => openCompare(i)}
          onLook={(i) =>
            look(
              cardsOf(
                'vision',
                me.visions.map((v) => v.card),
                visionCaptions(me, g.hour),
              ),
              i,
              'Your vision',
            )
          }
        />
        <h3 className="text-sm font-bold">
          {content.pillarPlural(pillar)} on the table{' '}
          <span className="font-normal text-ink-muted">· tap to look</span>
        </h3>
        <ul
          className={cn(
            'grid gap-1.5 sm:grid-cols-3 2xl:grid-cols-4',
            candidates.length > 6 ? 'grid-cols-3' : 'grid-cols-2',
          )}
          aria-label="Candidates"
        >
          {candidates.map((c, i) => {
            const triedIn = tried.get(c);
            const notes = [
              me.intuition === c && 'your guess',
              triedIn !== undefined && `tried in hour ${roman(triedIn)}`,
            ].filter(Boolean);
            return (
              <li key={c}>
                <PickableCard
                  kind={kind}
                  n={c}
                  content={content}
                  note={notes.join(', ') || undefined}
                  onLook={() =>
                    look(
                      cardsOf(
                        kindOf(pillar, g.third),
                        candidates,
                        Object.fromEntries(
                          [...tried].map(([card, h]) => [
                            card,
                            `✗ You tried it in hour ${roman(h)}`,
                          ]),
                        ),
                      ),
                      i,
                      `${content.pillarPlural(pillar)} on the table`,
                    )
                  }
                  pick={{
                    on: me.intuition === c,
                    label: 'Guess',
                    onLabel: '✓ Guess',
                    disabled: !open,
                    onToggle: () =>
                      void act(
                        { type: 'intuition', card: me.intuition === c ? null : c },
                        { anchor: 'seance-ready' },
                      ),
                  }}
                >
                  <Guessers g={g} card={c} pillar={pillar} content={content} />
                  {triedIn !== undefined && <TriedStamp hour={triedIn} />}
                </PickableCard>
              </li>
            );
          })}
        </ul>
        {open && <ReadyBar view={view} room={room} act={act} content={content} />}
      </Panel>
      {pastGuesses(g, me.color).length > 0 && (
        <Panel className="p-2.5 sm:p-3">
          <PastGuesses g={g} p={me} content={content} />
        </Panel>
      )}
      {me.visions.length > 0 && (
        <Tip id="compare">
          Tap your vision to pin it above the cards on the table and swipe through them; press and
          hold it to see it full screen. Tap any other card to see it full screen; pinch or
          double-tap to zoom.
        </Tip>
      )}
    </div>
  );
}

/** "✗ tried in hour II" across the top of a candidate the viewer already guessed wrong. */
export function TriedStamp({ hour }: { hour: number }) {
  return (
    <span
      aria-hidden
      className="absolute top-1 right-1 rounded bg-danger px-1 text-[10px] leading-snug font-bold text-white shadow dark:bg-rose-700"
    >
      ✗ tried in hour {roman(hour)}
    </span>
  );
}

/** The hour's clock, saying what it does: a reminder, or the end of the hour. */
export function HourClock({ view, room }: { view: SeanceView; room: GameRoomInfo }) {
  const strict = view.settings.timerMode === 'strict';
  return (
    <Countdown
      deadline={view.game!.deadline}
      clockOffset={room.clockOffset}
      label={strict ? 'The hour ends when this runs out' : 'Talk time (a reminder only)'}
      soft={!strict}
      atZero={strict ? 'then the guesses lock' : undefined}
      expiredHint={strict ? undefined : 'The ghost reveals once everyone is Ready.'}
    />
  );
}

/** The guess and Ready in one row (plus the clock in the compare view, which hides the steps). */
export function ReadyBar({
  view,
  room,
  act,
  content,
  clock,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  clock?: boolean;
}) {
  const g = view.game!;
  const me = myPsychic(view);
  const note = useReadyNoteText();
  if (!me || g.stage !== 'visions') return null;
  const pillar = PILLARS[me.step];
  const canReady = me.step >= 3 || me.intuition !== null;
  const waiting = notReady(g).filter((p) => p.color !== me.color);
  return (
    // Never sticky: a bar floating over the cards (or just above the tab bar) caught taps meant
    // for them. One row, with Ready at a fixed spot, so nothing moves under the finger.
    <div className="mt-3 space-y-1">
      <div className="flex items-center gap-2 rounded-xl bg-special-soft px-2 py-1.5 ring-1 ring-special-line dark:bg-violet-950 dark:ring-violet-500/30">
        {pillar && me.intuition !== null && (
          // The guessed card itself: cards carry no visible number, so a name like "Suspect 4"
          // would mean nothing.
          <span className="w-14 shrink-0">
            <Card
              kind={kindOf(pillar, g.third)}
              n={me.intuition}
              content={content}
              note="your guess"
              preview={false}
            />
          </span>
        )}
        <p className="min-w-0 flex-1 truncate text-sm">
          {pillar
            ? me.intuition !== null
              ? 'Your guess'
              : 'No guess yet: pick a card first'
            : 'Tokens placed?'}
          {me.ready && waiting.length > 0 && (
            <span className="block truncate text-xs text-ink-muted">
              Waiting for {waiting.map((p) => p.name).join(', ')}
            </span>
          )}
          {note && !me.ready && (
            <span
              role="status"
              className="block text-xs font-semibold whitespace-normal text-special-ink dark:text-violet-200"
            >
              ↻ {note}
            </span>
          )}
        </p>
        {clock && (
          <div className="max-w-[45%] min-w-0">
            <HourClock view={view} room={room} />
          </div>
        )}
        <Button
          size="md"
          className="min-w-24 shrink-0 self-start"
          variant={me.ready ? 'secondary' : 'primary'}
          disabled={!canReady}
          aria-pressed={me.ready}
          onClick={() => void act({ type: 'ready', on: !me.ready }, { anchor: 'seance-ready' })}
        >
          {me.ready ? '✓ Ready' : 'Ready'}
        </Button>
      </div>
      <RefusalSlot anchor="seance-ready" />
    </div>
  );
}

/** The other psychics: their visions, their guesses, and the viewer's clairvoyance tokens. */
export function OthersTab({
  view,
  act,
  content,
  compare,
}: {
  view: SeanceView;
  act: Act;
  content: Content;
  compare: (spec: CompareSpec) => void;
}) {
  const g = view.game!;
  const me = myPsychic(view);
  const others = atTable(g).filter((p) => p.color !== me?.color);
  const canMark = !!me && g.clairvoyance && g.stage === 'visions';
  const note = useReadyNoteText();
  const { look, viewer } = useLook(content);
  return (
    <div className="space-y-2">
      {viewer}
      {note && me && !me.ready && (
        <p
          role="status"
          className="rounded-xl bg-special-soft px-3 py-1.5 text-sm font-semibold ring-1 ring-special-line dark:bg-violet-950 dark:ring-violet-500/30"
        >
          ↻ {note}
        </p>
      )}
      {canMark && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          You have <b>{me.tokens}</b> clairvoyance token{me.tokens === 1 ? '' : 's'}
          {g.hour < 4 ? ' until hour IV' : ''}: ✓ if you think a guess is right, ✗ if not.
        </p>
      )}
      <ul className="space-y-2" aria-label="Other psychics">
        {others.map((p) => {
          const pillar = PILLARS[p.step];
          const mine = g.marks.find((m) => m.by === me?.color && m.target === p.color);
          const marks = g.marks.filter((m) => m.target === p.color);
          return (
            <li key={p.color}>
              <Panel role="region" className="space-y-1.5 p-2.5" aria-label={`${p.name}’s reading`}>
                <div className="flex items-center gap-2">
                  <Avatar color={p.color} content={content} name={p.name} size="sm" />
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {p.name}
                    {p.gone && <span className="ml-1 text-xs font-normal">(left)</span>}
                    <span className="ml-1 font-normal text-ink-muted">
                      ·{' '}
                      {pillar
                        ? `${content.pillarName(pillar).toLowerCase()} ${p.step + 1}/3`
                        : 'found all three'}
                    </span>
                  </p>
                  {p.ready && g.stage === 'visions' && (
                    <span className="rounded-full bg-success dark:bg-emerald-700 px-2 text-xs font-bold text-white">
                      ready
                    </span>
                  )}
                  {marks.length > 0 && (
                    <span className="text-xs" aria-label="Tokens on this guess">
                      {marks.map((m) => (m.kind === 'yes' ? '✓' : '✗')).join(' ')}
                    </span>
                  )}
                </div>
                {pillar && (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <VisionStrip
                        p={p}
                        g={g}
                        content={content}
                        small
                        onOpen={(i) =>
                          look(
                            [
                              ...cardsOf(
                                'vision',
                                p.visions.map((v) => v.card),
                                visionCaptions(p, g.hour),
                              ),
                              ...(p.intuition !== null
                                ? [
                                    {
                                      kind: content.kindOf(pillar),
                                      n: p.intuition,
                                      caption: `${p.name}’s guess`,
                                    },
                                  ]
                                : []),
                            ],
                            i,
                            `${p.name}’s vision`,
                          )
                        }
                      />
                      {p.visions.length > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-0.5"
                          onClick={() =>
                            compare({
                              title: `${p.name}’s vision → which ${content.pillarName(pillar).toLowerCase()}?`,
                              pinned: {
                                kind: 'vision',
                                cards: p.visions.map((v) => v.card),
                                captions: visionCaptions(p, g.hour),
                              },
                              pinnedLabel: `${p.name}’s vision`,
                              strip: {
                                kind: content.kindOf(pillar),
                                cards: g.table[pillar],
                                captions:
                                  p.intuition !== null
                                    ? { [p.intuition]: `${p.name}’s guess` }
                                    : undefined,
                              },
                              stripLabel: `${content.pillarPlural(pillar)} on the table`,
                              mode: 'view',
                            })
                          }
                        >
                          🔍 Compare with the table
                        </Button>
                      )}
                    </div>
                    <div className="w-24 shrink-0 xl:w-32">
                      {p.intuition !== null ? (
                        <Card
                          kind={content.kindOf(pillar)}
                          n={p.intuition}
                          content={content}
                          note={`${p.name}’s guess`}
                          onTap={() =>
                            look(
                              [
                                {
                                  kind: content.kindOf(pillar),
                                  n: p.intuition!,
                                  caption: `${p.name}’s guess`,
                                },
                              ],
                              0,
                              `${p.name}’s guess`,
                            )
                          }
                        />
                      ) : (
                        <div className="flex aspect-[1024/700] items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-[11px] text-ink-muted dark:border-stone-700">
                          no guess yet
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <PastGuesses g={g} p={p} content={content} compact />
                {canMark && pillar && (
                  <div
                    className="flex gap-1.5"
                    role="group"
                    aria-label={`Your token on ${p.name}’s guess`}
                  >
                    {(['yes', 'no'] as const).map((kind) => (
                      <Button
                        key={kind}
                        size="sm"
                        className="min-h-11"
                        variant={mine?.kind === kind ? 'primary' : 'secondary'}
                        aria-pressed={mine?.kind === kind}
                        disabled={p.intuition === null || (!mine && me.tokens <= 0)}
                        onClick={() =>
                          void act(
                            {
                              type: 'mark',
                              target: p.color,
                              kind: mine?.kind === kind ? null : kind,
                            },
                            { anchor: 'seance-mark' },
                          )
                        }
                      >
                        {kind === 'yes' ? '✓ Right' : '✗ Wrong'}
                      </Button>
                    ))}
                  </div>
                )}
              </Panel>
            </li>
          );
        })}
      </ul>
      {/* Under the list, so a refusal clearing never moves the token buttons. */}
      <RefusalSlot anchor="seance-mark" />
    </div>
  );
}
