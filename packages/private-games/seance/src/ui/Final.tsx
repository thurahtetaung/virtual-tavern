import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, RefusalSlot, cn } from '@vt/ui';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import type { GameView, SeanceAction, SeanceView } from '../logic/types.ts';
import { type Content, PILLAR_ICONS } from './assets.ts';
import { Avatar, Card, CardBack } from './Card.tsx';
import type { CompareSpec } from './Psychic.tsx';
import { myPsychic, psychicByColor, votersNow } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** The ghost's choices for the shared vision, kept by the game root while they pick. */
export interface SharedDraft {
  group: number | null;
  cards: number[];
  tags: Record<number, Pillar | null>;
}

export const groupCards = (g: GameView, i: number) =>
  psychicByColor(g, g.final!.groups[i])?.found ?? [];

/** The shared vision: face-up cards, then face-down ones. */
export function SharedRow({ g, content, tags }: { g: GameView; content: Content; tags?: boolean }) {
  const f = g.final!;
  if (!f.sharedCount) return null;
  return (
    <section aria-label="Shared vision" className="space-y-1">
      <h4 className="text-sm font-semibold">
        The shared vision{' '}
        <span className="font-normal text-stone-500">({Math.min(f.revealed, 3)} of 3 face up)</span>
      </h4>
      <ul className="grid grid-cols-3 gap-2 sm:max-w-sm">
        {[0, 1, 2].map((i) => {
          const card = f.shared[i];
          const up = i < f.revealed || g.stage === 'done';
          const tag = f.tags?.[i];
          return (
            <li key={i} className="space-y-0.5">
              {card !== undefined && (up || g.myRole === 'ghost') ? (
                <Card
                  kind="vision"
                  n={card}
                  content={content}
                  note={`shared card ${i + 1}`}
                  dimmed={!up}
                />
              ) : (
                <CardBack content={content} />
              )}
              {tags && tag && (
                <p className="text-center text-xs font-semibold">
                  {PILLAR_ICONS[tag]} {content.pillarName(tag)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The line-up: one numbered group per psychic, with vote buttons when it's the viewer's turn. */
export function Lineup({
  view,
  act,
  content,
  draft,
  setDraft,
  compare,
}: {
  view: SeanceView;
  act: Act;
  content: Content;
  draft?: SharedDraft;
  setDraft?: (d: SharedDraft) => void;
  compare: (spec: CompareSpec) => void;
}) {
  const g = view.game!;
  const f = g.final!;
  const me = myPsychic(view);
  const myTurn =
    !!me && g.stage === 'vote' && me.voteStage === f.revealed && f.myVote === undefined;
  const picking = g.myRole === 'ghost' && g.stage === 'shared' && !!setDraft;
  const over = g.stage === 'done';
  return (
    <ul className="space-y-2" aria-label="Line-up">
      {f.groups.map((color, i) => {
        const p = psychicByColor(g, color);
        const cards = groupCards(g, i);
        const culprit = over ? g.result?.culprit === i : g.myRole === 'ghost' && f.culprit === i;
        const chosen = over && g.result?.chosen === i;
        const selected = picking && draft?.group === i;
        const votes = over ? (g.result?.tally[i] ?? 0) : null;
        return (
          <li key={color}>
            <div
              className={cn(
                'rounded-xl p-2 ring-1 ring-stone-200 dark:ring-stone-800',
                (selected || culprit) && 'ring-2 ring-violet-500 bg-violet-500/10',
                chosen && !culprit && 'ring-2 ring-rose-500',
              )}
              aria-label={`Group ${i + 1}`}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-stone-900 font-serif font-bold text-white dark:bg-stone-100 dark:text-stone-900">
                  {i + 1}
                </span>
                {p && <Avatar color={p.color} content={content} name={p.name} size="sm" />}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {p ? `${p.name}’s cards` : ''}
                </span>
                {culprit && (
                  <span className="text-sm font-bold text-violet-700 dark:text-violet-300">
                    👻 culprit
                  </span>
                )}
                {votes !== null && (
                  <span className="text-xs text-stone-500">
                    {votes} vote{votes === 1 ? '' : 's'}
                  </span>
                )}
                {f.myVote === i && !over && (
                  <span className="text-xs font-semibold">your vote</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {cards.map((c, k) => (
                  <Card
                    key={k}
                    kind={PILLARS[k]!}
                    n={c}
                    content={content}
                    onTap={() =>
                      compare({
                        title: `Group ${i + 1}`,
                        pinned: { kind: PILLARS[k]!, kinds: PILLARS, cards },
                        mode: 'view',
                        start: k,
                      })
                    }
                  />
                ))}
              </div>
              {myTurn && (
                <Button
                  size="sm"
                  className="mt-1.5 w-full"
                  onClick={() => void act({ type: 'vote', group: i }, { anchor: 'seance-vote' })}
                >
                  Vote for group {i + 1}
                </Button>
              )}
              {picking && (
                <Button
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  className="mt-1.5 w-full"
                  aria-pressed={selected}
                  onClick={() => setDraft({ ...(draft ?? { cards: [], tags: {} }), group: i })}
                >
                  {selected ? '👻 The culprit’s group' : `This is the culprit (group ${i + 1})`}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The ghost's shared-vision picker: three cards from the hand, each tagged privately. */
export function SharedPicker({
  view,
  act,
  content,
  draft,
  setDraft,
  compare,
}: {
  view: SeanceView;
  act: Act;
  content: Content;
  draft: SharedDraft;
  setDraft: (d: SharedDraft) => void;
  compare: (spec: CompareSpec) => void;
}) {
  const g = view.game!;
  const hand = g.hand ?? [];
  const cards = draft.cards.filter((c) => hand.includes(c));
  const group = draft.group;
  const ready = group !== null && cards.length === 3;
  return (
    <Panel role="region" className="space-y-2 p-3" aria-label="Choose the shared vision">
      <h3 className="font-bold">The shared vision</h3>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-stone-700 dark:text-stone-300">
        <li className={cn(group !== null && 'line-through opacity-60')}>
          Tap “This is the culprit” on one group.
        </li>
        <li>
          Pick 3 cards from your hand: one for its suspect, one for its place, one for its object.
        </li>
        <li>Tag what each card means (only you see it until the end), then send.</li>
      </ol>
      <Button
        size="sm"
        variant="secondary"
        disabled={group === null}
        onClick={() =>
          compare({
            title: `Group ${(group ?? 0) + 1}: pick 3 cards`,
            pinned: { kind: 'suspect', kinds: PILLARS, cards: groupCards(g, group ?? 0) },
            pinnedLabel: 'The culprit’s group',
            strip: { kind: 'vision', cards: hand },
            stripLabel: 'Your hand: pick 3',
            mode: 'shared',
          })
        }
      >
        🔍 Compare with the group
      </Button>
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" aria-label="Your hand">
        {hand.map((c) => {
          const on = cards.includes(c);
          return (
            <li key={c}>
              <Card
                kind="vision"
                n={c}
                content={content}
                selected={on}
                onTap={() => {
                  const next = on
                    ? cards.filter((x) => x !== c)
                    : cards.length < 3
                      ? [...cards, c]
                      : cards;
                  setDraft({ ...draft, cards: next });
                }}
              />
            </li>
          );
        })}
      </ul>
      {cards.length > 0 && (
        <ul className="space-y-1" aria-label="Tags">
          {cards.map((c, i) => (
            <li key={c} className="flex items-center gap-2">
              <span className="w-10 shrink-0">
                <Card kind="vision" n={c} content={content} />
              </span>
              <span className="text-xs text-stone-500">Card {i + 1} means:</span>
              <div className="flex flex-wrap gap-1">
                {PILLARS.map((pl) => (
                  <Button
                    key={pl}
                    size="sm"
                    variant={draft.tags[c] === pl ? 'primary' : 'secondary'}
                    aria-pressed={draft.tags[c] === pl}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        tags: { ...draft.tags, [c]: draft.tags[c] === pl ? null : pl },
                      })
                    }
                  >
                    {PILLAR_ICONS[pl]}{' '}
                    <span className="sr-only sm:not-sr-only">{content.pillarName(pl)}</span>
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={!ready}
        onClick={() =>
          void act(
            {
              type: 'shared',
              group: group!,
              cards,
              tags: cards.map((c) => draft.tags[c] ?? null),
            },
            { anchor: 'seance-shared' },
          )
        }
      >
        {ready
          ? '👻 Send the shared vision'
          : `Pick ${group === null ? 'a group and ' : ''}${3 - cards.length} more`}
      </Button>
      <RefusalSlot anchor="seance-shared" />
    </Panel>
  );
}

/** Who votes now, the stage clock, and the host's "close this round". */
export function VoteBar({ view, room, act }: { view: SeanceView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const f = g.final;
  if (g.stage !== 'vote' || !f) return null;
  const now = votersNow(g);
  const strict = view.settings.timerMode === 'strict';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-violet-50 px-3 py-1.5 text-sm ring-1 ring-violet-200 dark:bg-violet-500/10 dark:ring-violet-500/30">
      <p className="min-w-0 flex-1">
        🗳️ Card {f.revealed} of 3 is up.{' '}
        {now.length
          ? `Voting now: ${now.map((p) => (p.color === g.me ? 'you' : p.name)).join(', ')}.`
          : ''}
      </p>
      <Countdown
        deadline={g.deadline}
        clockOffset={room.clockOffset}
        soft={!strict}
        atZero={strict ? 'missing votes abstain' : undefined}
        expiredHint={strict ? undefined : 'The host can close this round.'}
      />
      {room.isHost && (
        <Button size="sm" variant="secondary" onClick={() => void act({ type: 'lock-now' })}>
          Close this round
        </Button>
      )}
      <RefusalSlot anchor="seance-vote" />
    </div>
  );
}
