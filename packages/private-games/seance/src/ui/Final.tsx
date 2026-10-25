import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { PILLARS, type Pillar } from '../logic/cards.ts';
import type { GameView, SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar, Card, CardBack } from './Card.tsx';
import type { CompareSpec } from './Psychic.tsx';
import { HandCards } from './Ghost.tsx';
import { type LookCard, useLook } from './Look.tsx';
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

/** Tapping a group chooses it; tapping the chosen one again lets it go. Nothing is cast yet. */
export const toggleChoice = (choice: number | null, group: number) =>
  choice === group ? null : group;

/** The group the "Cast my vote" bar would send: only on the viewer's turn, and a real group. */
export function castable(g: GameView, myTurn: boolean, choice: number | null): number | null {
  if (!myTurn || choice === null || !g.final) return null;
  return choice >= 0 && choice < g.final.groups.length ? choice : null;
}

/** The shared vision: face-up cards, then face-down ones. */
export function SharedRow({ g, content, tags }: { g: GameView; content: Content; tags?: boolean }) {
  const f = g.final!;
  const { look, viewer } = useLook(content);
  if (!f.sharedCount) return null;
  const visible = [0, 1, 2].flatMap((i): LookCard[] => {
    const card = f.shared[i];
    const up = i < f.revealed || g.stage === 'done';
    const tag = f.tags?.[i];
    return card !== undefined && (up || g.myRole === 'ghost')
      ? [
          {
            kind: 'vision',
            n: card,
            caption: `Shared card ${i + 1}${up ? '' : ' (still face down for them)'}${tags && tag ? ` · ${content.pillarName(tag)}` : ''}`,
          },
        ]
      : [];
  });
  return (
    <section aria-label="Shared vision" className="space-y-1">
      {viewer}
      <h4 className="text-sm font-semibold">
        The shared vision{' '}
        <span className="font-normal text-ink-muted">({Math.min(f.revealed, 3)} of 3 face up)</span>
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
                  onTap={() =>
                    look(
                      visible,
                      visible.findIndex((c) => c.n === card),
                      'The shared vision',
                    )
                  }
                />
              ) : (
                <CardBack content={content} />
              )}
              {tags && tag && (
                <p className="text-center text-xs font-semibold">
                  {content.pillarIcon(tag)} {content.pillarName(tag)}
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
}: {
  view: SeanceView;
  act: Act;
  content: Content;
  draft?: SharedDraft;
  setDraft?: (d: SharedDraft) => void;
}) {
  const g = view.game!;
  const f = g.final!;
  const { look, viewer } = useLook(content);
  const all = f.groups.flatMap((_, i) =>
    groupCards(g, i).map((n, k): LookCard => ({
      kind: content.kindOf(PILLARS[k]!),
      n,
      caption: `Group ${i + 1} · ${content.pillarName(PILLARS[k]!).toLowerCase()}`,
    })),
  );
  const startOf = (i: number) =>
    f.groups.slice(0, i).reduce((sum, _, j) => sum + groupCards(g, j).length, 0);
  const me = myPsychic(view);
  const myTurn =
    !!me && g.stage === 'vote' && me.voteStage === f.revealed && f.myVote === undefined;
  const picking = g.myRole === 'ghost' && g.stage === 'shared' && !!setDraft;
  const over = g.stage === 'done';
  // The vote is two taps: choose a group, then cast it from the bar (scrolling never votes).
  const [choice, setChoice] = useState<number | null>(null);
  const cast = castable(g, myTurn, choice);
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label="Line-up">
        {viewer}
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
                  (selected || culprit || (myTurn && choice === i)) &&
                    'ring-2 ring-special bg-special/10 dark:bg-violet-500/10',
                  chosen && !culprit && 'ring-2 ring-danger',
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
                    <span className="text-xs text-ink-muted">
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
                      kind={content.kindOf(PILLARS[k]!)}
                      n={c}
                      content={content}
                      onTap={() => look(all, startOf(i) + k, 'The line-up')}
                    />
                  ))}
                </div>
                {myTurn && (
                  <Button
                    size="sm"
                    variant={choice === i ? 'primary' : 'secondary'}
                    className="mt-1.5 w-full"
                    aria-pressed={choice === i}
                    onClick={() => setChoice(toggleChoice(choice, i))}
                  >
                    {choice === i ? `✓ Group ${i + 1} chosen` : `Choose group ${i + 1}`}
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
      {myTurn && (
        // Stays in reach above the phone tab bar while the groups scroll past.
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 rounded-xl bg-card/95 p-1.5 shadow-lg ring-1 ring-line backdrop-blur lg:bottom-2 dark:bg-stone-900/95 dark:ring-stone-700">
          <Button
            size="lg"
            className="w-full"
            disabled={cast === null}
            onClick={() =>
              cast !== null && void act({ type: 'vote', group: cast }, { anchor: 'seance-vote' })
            }
          >
            {cast === null
              ? 'Tap a group to choose it first'
              : `Cast my vote for group ${cast + 1}`}
          </Button>
        </div>
      )}
    </div>
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
  const { look, viewer } = useLook(content);
  // The hand only shows here in the final, so the raven (throw away and draw) lives here too.
  const [raven, setRaven] = useState(false);
  const [thrown, setThrown] = useState<number[]>([]);
  const throwing = thrown.filter((c) => hand.includes(c));
  return (
    <Panel role="region" className="space-y-2 p-3" aria-label="Choose the shared vision">
      {viewer}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">The shared vision</h3>
        <Button
          size="sm"
          variant={raven ? 'primary' : 'secondary'}
          aria-pressed={raven}
          disabled={g.ravensLeft <= 0}
          onClick={() => {
            setRaven(!raven);
            setThrown([]);
          }}
        >
          🐦‍⬛ Raven{g.difficulty === 'easy' ? '' : ` (${g.ravensLeft} left)`}
        </Button>
      </div>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-stone-700 dark:text-stone-300">
        <li className={cn(group !== null && 'line-through opacity-60')}>
          You choose the culprit: pick one group (tap “This is the culprit” on it).
        </li>
        <li>
          Pick 3 cards from your hand (tap a card to look, Pick to choose): one for its suspect, one
          for its place, one for its {content.pillarName('object').toLowerCase()}.
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
        🔍 Compare with the group
      </Button>
      {raven ? (
        <>
          <p className="text-xs text-stone-600 dark:text-stone-400">
            Tap Throw away on the cards to lose, then draw back up to 7.
          </p>
          <HandCards
            hand={hand}
            content={content}
            picked={throwing}
            onToggle={(c) =>
              setThrown(throwing.includes(c) ? throwing.filter((x) => x !== c) : [...throwing, c])
            }
            pickLabel="Throw away"
            pickedLabel="✓ Throw away"
          />
          <Button
            className="w-full"
            disabled={!throwing.length}
            onClick={() =>
              void act({ type: 'raven', cards: throwing }, { anchor: 'seance-raven' }).then(
                (ok) => {
                  if (ok) {
                    setRaven(false);
                    setThrown([]);
                  }
                },
              )
            }
          >
            {throwing.length
              ? `🐦‍⬛ Throw away ${throwing.length} and draw`
              : 'Pick the cards to throw away first'}
          </Button>
          <RefusalSlot anchor="seance-raven" />
        </>
      ) : (
        <HandCards
          hand={hand}
          content={content}
          picked={cards}
          canPick={() => cards.length < 3}
          onToggle={(c) =>
            setDraft({
              ...draft,
              cards: cards.includes(c)
                ? cards.filter((x) => x !== c)
                : cards.length < 3
                  ? [...cards, c]
                  : cards,
            })
          }
        />
      )}
      {cards.length > 0 && (
        <ul className="space-y-1" aria-label="Tags">
          {cards.map((c, i) => (
            <li key={c} className="flex items-center gap-2">
              <span className="w-12 shrink-0">
                <Card
                  kind="vision"
                  n={c}
                  content={content}
                  onTap={() =>
                    look(
                      cards.map((n, k) => ({ kind: 'vision', n, caption: `Card ${k + 1}` })),
                      i,
                      'Your shared vision',
                    )
                  }
                />
              </span>
              <span className="text-xs text-ink-muted">Card {i + 1} means:</span>
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
                    {content.pillarIcon(pl)}{' '}
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
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-special-soft px-3 py-1.5 text-sm ring-1 ring-special-line dark:bg-violet-500/10 dark:ring-violet-500/30">
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
