import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, RefusalSlot, cn } from '@vt/ui';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import type { GameView, PsychicView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Tip } from './Tips.tsx';
import { Avatar, Card } from './Card.tsx';
import type { CardRow } from './Compare.tsx';
import { myPsychic, notReady, roman } from './status.ts';

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
  small,
}: {
  p: PsychicView;
  g: GameView;
  content: Content;
  onOpen: (i: number) => void;
  small?: boolean;
}) {
  if (!p.visions.length)
    return <p className="text-sm text-stone-500 dark:text-stone-400">No vision yet.</p>;
  return (
    <ul className="flex gap-1.5 overflow-x-auto pb-1" aria-label={`${p.name}’s visions`}>
      {p.visions.map((v, i) => (
        <li key={`${v.card}-${i}`} className={cn('shrink-0', small ? 'w-14' : 'w-20 sm:w-24')}>
          <Card
            kind="vision"
            n={v.card}
            content={content}
            note={`hour ${roman(v.hour)}`}
            onTap={() => onOpen(i)}
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
  if (!pillar)
    return (
      <Panel className="space-y-2 p-3">
        <h3 className="font-bold">🎉 You found all three</h3>
        <div className="grid grid-cols-3 gap-1.5">
          {PILLARS.map((pl, i) => (
            <Card key={pl} kind={pl} n={me.found[i]!} content={content} />
          ))}
        </div>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {g.clairvoyance && me.tokens > 0
            ? `Help the others: put your ${me.tokens} clairvoyance token${me.tokens === 1 ? '' : 's'} on their guesses (Others) before they lock in.`
            : 'Help the others talk it through.'}
        </p>
      </Panel>
    );
  const candidates = g.table[pillar];
  const openCompare = (start = 0) =>
    compare({
      title: `Your vision → which ${content.pillarName(pillar).toLowerCase()}?`,
      pinned: {
        kind: 'vision',
        cards: me.visions.map((v) => v.card),
        captions: visionCaptions(me, g.hour),
      },
      pinnedLabel: 'Your vision',
      strip: { kind: pillar, cards: candidates },
      stripLabel: `${content.pillarName(pillar)}s on the table: tap your guess`,
      mode: 'guess',
      start,
    });
  return (
    <div className="space-y-2">
      <Panel className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Avatar color={me.color} content={content} name={me.name} />
          <div className="min-w-0 flex-1 leading-tight">
            <h3 className="font-bold">Your vision</h3>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Looking for your {content.pillarName(pillar).toLowerCase()} ({me.step + 1} of 3)
            </p>
          </div>
          {me.visions.length > 0 && (
            <Button size="sm" onClick={() => openCompare()}>
              🔍 Compare
            </Button>
          )}
        </div>
        <VisionStrip p={me} g={g} content={content} onOpen={(i) => openCompare(i)} />
        {me.visions.length > 0 && (
          <Tip id="compare">
            Tap 🔍 Compare to pin your vision above the cards on the table and swipe through them.
          </Tip>
        )}
      </Panel>
      <Panel className="space-y-2 p-3">
        <h3 className="text-sm font-bold">
          {content.pillarName(pillar)}s on the table{' '}
          <span className="font-normal text-stone-500">· tap your guess</span>
        </h3>
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Candidates">
          {candidates.map((c) => (
            <li key={c}>
              <Card
                kind={pillar}
                n={c}
                content={content}
                selected={me.intuition === c}
                note={me.intuition === c ? 'your guess' : undefined}
                disabled={!open}
                onTap={() =>
                  void act(
                    { type: 'intuition', card: me.intuition === c ? null : c },
                    { anchor: 'seance-ready' },
                  )
                }
              >
                <Guessers g={g} card={c} pillar={pillar} content={content} />
              </Card>
            </li>
          ))}
        </ul>
        {open && <ReadyBar view={view} room={room} act={act} content={content} />}
      </Panel>
    </div>
  );
}

/** The guess, the timer and Ready, in one row. */
export function ReadyBar({
  view,
  room,
  act,
  content,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
}) {
  const g = view.game!;
  const me = myPsychic(view);
  if (!me || g.stage !== 'visions') return null;
  const pillar = PILLARS[me.step];
  const strict = view.settings.timerMode === 'strict';
  const canReady = me.step >= 3 || me.intuition !== null;
  const waiting = notReady(g).filter((p) => p.color !== me.color);
  return (
    <div className="sticky bottom-16 z-10 space-y-1 lg:static">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-special-soft shadow-lg lg:shadow-none px-2 py-1.5 ring-1 ring-special-line dark:bg-violet-950 dark:ring-violet-500/30">
        <p className="min-w-0 flex-1 text-sm">
          {pillar
            ? me.intuition !== null
              ? `Your guess: ${content.cardLabel(pillar, me.intuition)}`
              : 'No guess yet'
            : 'Tokens placed?'}
          {me.ready && waiting.length > 0 && (
            <span className="block text-xs text-stone-500">
              Waiting for {waiting.map((p) => p.name).join(', ')}
            </span>
          )}
        </p>
        <Countdown
          deadline={g.deadline}
          clockOffset={room.clockOffset}
          soft={!strict}
          atZero={strict ? 'then guesses lock' : undefined}
          expiredHint={strict ? undefined : 'The host can lock the guesses in.'}
        />
        <Button
          size="md"
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
  const others = g.psychics.filter((p) => p.color !== me?.color);
  const canMark = !!me && g.clairvoyance && g.stage === 'visions';
  return (
    <div className="space-y-2">
      {canMark && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          You have <b>{me.tokens}</b> clairvoyance token{me.tokens === 1 ? '' : 's'}
          {g.hour < 4 ? ' until hour IV' : ''}: ✓ if you think a guess is right, ✗ if not.
        </p>
      )}
      <RefusalSlot anchor="seance-mark" />
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
                    <span className="ml-1 font-normal text-stone-500">
                      ·{' '}
                      {pillar
                        ? `${content.pillarName(pillar).toLowerCase()} ${p.step + 1}/3`
                        : 'found all three'}
                    </span>
                  </p>
                  {p.ready && g.stage === 'visions' && (
                    <span className="rounded-full bg-success dark:bg-emerald-600 px-2 text-xs font-bold text-white">
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
                          compare({
                            title: `${p.name}’s vision → which ${content.pillarName(pillar).toLowerCase()}?`,
                            pinned: {
                              kind: 'vision',
                              cards: p.visions.map((v) => v.card),
                              captions: visionCaptions(p, g.hour),
                            },
                            pinnedLabel: `${p.name}’s vision`,
                            strip: {
                              kind: pillar,
                              cards: g.table[pillar],
                              captions:
                                p.intuition !== null
                                  ? { [p.intuition]: `${p.name}’s guess` }
                                  : undefined,
                            },
                            stripLabel: `${content.pillarName(pillar)}s on the table`,
                            mode: 'view',
                            start: i,
                          })
                        }
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      {p.intuition !== null ? (
                        <Card
                          kind={pillar}
                          n={p.intuition}
                          content={content}
                          note={`${p.name}’s guess`}
                        />
                      ) : (
                        <div className="flex aspect-[1024/700] items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-[11px] text-stone-500 dark:border-stone-700">
                          no guess yet
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
    </div>
  );
}
