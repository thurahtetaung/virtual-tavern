import { Button, Panel, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { PILLARS } from '../logic/cards.ts';
import type { SeanceAction, SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Tip } from './Tips.tsx';
import { Avatar, Card } from './Card.tsx';
import { type CompareSpec, visionCaptions } from './Psychic.tsx';
import { atTable } from './status.ts';

type Act = (a: SeanceAction, o?: { anchor?: string }) => Promise<boolean>;

/** The silent reminder on every ghost screen. */
export function SilentNote() {
  return (
    <p className="rounded-xl bg-violet-950 px-3 py-1.5 text-center text-sm text-violet-100 ring-1 ring-special dark:ring-violet-700">
      🤫 You’re the ghost: not a word, a nod or a sigh. Your pictures do the talking.
    </p>
  );
}

/** The ghost's screen: one row per psychic, their target, what they hold and what they guess. */
export function GhostPsychics({
  view,
  content,
  compare,
}: {
  view: SeanceView;
  content: Content;
  compare: (spec: CompareSpec) => void;
}) {
  const g = view.game!;
  const sending = g.stage === 'visions';
  return (
    <>
      <Tip id="ghost-compare">
        Tap a target (or Choose) to see it big above your hand, then tap the cards that point to it.
      </Tip>
      <ul className="space-y-2" aria-label="Psychics">
        {atTable(g).map((p) => {
          const pillar = PILLARS[p.step];
          const target = pillar ? p.targets?.[p.step] : undefined;
          const sent = g.sent.includes(p.color);
          const needs = sending && pillar && !sent && !p.gone;
          const openSend = () => {
            if (!pillar || target === undefined) return;
            compare({
              title: needs
                ? `Vision for ${p.name}: pick from your hand`
                : `${p.name}’s ${content.pillarName(pillar).toLowerCase()}`,
              pinned: {
                kind: pillar,
                cards: [target],
                captions: { [target]: `${p.name}’s ${content.pillarName(pillar).toLowerCase()}` },
              },
              pinnedLabel: `${p.name}’s target`,
              strip: needs
                ? { kind: 'vision', cards: g.hand ?? [] }
                : p.visions.length
                  ? {
                      kind: 'vision',
                      cards: p.visions.map((v) => v.card),
                      captions: visionCaptions(p, g.hour),
                    }
                  : null,
              stripLabel: needs ? 'Your hand: tap the cards to send' : `What ${p.name} holds`,
              mode: needs ? 'send' : 'view',
              to: p.color,
            });
          };
          return (
            <li key={p.color}>
              <Panel
                role="region"
                className={cn('p-2', needs && 'ring-2 ring-accent dark:ring-amber-400')}
                aria-label={`${p.name} (ghost view)`}
              >
                <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  {pillar && target !== undefined ? (
                    <Card
                      kind={pillar}
                      n={target}
                      content={content}
                      note={`${p.name}’s target`}
                      onTap={openSend}
                    >
                      <span className="absolute top-1 left-1 rounded bg-black/70 px-1 text-[10px] font-bold text-white uppercase">
                        Target
                      </span>
                    </Card>
                  ) : (
                    <div className="flex aspect-[1024/700] items-center justify-center rounded-lg bg-success/15 dark:bg-emerald-600/15 text-2xl">
                      ✅
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Avatar color={p.color} content={content} name={p.name} size="sm" />
                      <p className="min-w-0 flex-1 truncate text-sm leading-tight font-semibold">
                        {p.name}
                        {p.gone && <span className="ml-1 text-xs font-normal">(left)</span>}
                        <span className="block text-xs font-normal text-ink-muted">
                          {pillar
                            ? `${content.pillarName(pillar).toLowerCase()} ${p.step + 1}/3`
                            : 'found all three'}
                        </span>
                      </p>
                      {needs ? (
                        <span className="rounded-full bg-accent-line dark:bg-amber-400 px-2 text-[11px] font-bold text-stone-950">
                          needs a vision
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
                        className="flex items-end gap-1 overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
                        aria-label={`What ${p.name} holds`}
                      >
                        {p.visions.map((v, i) => (
                          <div key={`${v.card}-${i}`} className="w-7 shrink-0">
                            <Card kind="vision" n={v.card} content={content} />
                          </div>
                        ))}
                        {p.intuition !== null && (
                          <div className="ml-1 w-14 shrink-0">
                            <Card
                              kind={pillar}
                              n={p.intuition}
                              content={content}
                              note={`${p.name}’s guess`}
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
      {raven && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          Tap the cards to throw away, then draw back up to 7.
          {g.difficulty === 'easy' ? ' One raven per hour.' : ''}
        </p>
      )}
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-7" aria-label="Your hand">
        {hand.map((c) => (
          <li key={c}>
            <Card
              kind="vision"
              n={c}
              content={content}
              selected={raven && live.includes(c)}
              dimmed={raven && !live.includes(c) && live.length > 0}
              onTap={
                raven
                  ? () => setPicked(live.includes(c) ? live.filter((x) => x !== c) : [...live, c])
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
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
