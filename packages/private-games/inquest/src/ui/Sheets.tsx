import { Button, Modal, ProtectedImage, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { EVENT_TILES, type EventKind } from '../logic/content.ts';
import { eventText } from '../logic/names.ts';
import type { InquestAction, InquestView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content } from './assets.ts';
import { type Mark, type Marks, markKey } from './marks.ts';
import { nameOf, twistOffer } from './status.ts';
import { type OpenCard, suspectsOf } from './Suspects.tsx';

type Act = (a: InquestAction, o?: { anchor?: string }) => Promise<boolean>;

/** A card at full size, with the viewer's private marks. */
export function CardView({
  open,
  view,
  content,
  marks,
  setMark,
  onClose,
}: {
  open: OpenCard | null;
  view: InquestView;
  content: Content;
  marks: Marks;
  setMark: (id: string, mark: Mark | null) => void;
  onClose: () => void;
}) {
  const owner = view.game?.players.find((p) => p.id === open?.owner);
  const key = open ? markKey(open.deck, open.n) : '';
  const mark = marks[key];
  return (
    <Modal
      open={!!open}
      onClose={onClose}
      title={
        open ? `${owner?.name ?? 'A suspect'}’s ${open.deck === 'clue' ? 'Clue' : 'Means'}` : ''
      }
      footer={
        open && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant={mark === 'star' ? 'primary' : 'secondary'}
              onClick={() => setMark(key, mark === 'star' ? null : 'star')}
            >
              ★ Suspicious
            </Button>
            <Button
              variant={mark === 'cross' ? 'primary' : 'secondary'}
              onClick={() => setMark(key, mark === 'cross' ? null : 'cross')}
            >
              ✕ Ruled out
            </Button>
            <span className="w-full text-center text-xs text-stone-500">
              Only you see your marks.
            </span>
          </div>
        )
      }
    >
      {open && (
        <div className="mx-auto w-full max-w-64">
          <ArtCard
            deck={open.deck}
            n={open.n}
            content={content}
            size="big"
            mark={mark}
            ruledOut={open.deck === 'clue' && !!owner?.ruledOut.includes(open.n)}
          />
        </div>
      )}
    </Modal>
  );
}

/** Solving: another player → Clue → Means, then a summary to confirm. Never your own cards. */
export function SolveSheet({
  open,
  view,
  content,
  act,
  onClose,
}: {
  open: boolean;
  view: InquestView;
  content: Content;
  act: Act;
  onClose: () => void;
}) {
  const g = view.game;
  const [target, setTarget] = useState<string | null>(null);
  const [clue, setClue] = useState<number | null>(null);
  const [means, setMeans] = useState<number | null>(null);
  const reset = () => {
    setTarget(null);
    setClue(null);
    setMeans(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  if (!g) return null;
  const me = g.players.find((p) => p.id === view.me?.id);
  const suspect = g.players.find((p) => p.id === target);
  const step = !suspect ? 1 : clue === null ? 2 : means === null ? 3 : 4;
  const badges = me?.badges ?? 0;
  const final = g.stage === 'final';
  const title = [
    'Who did it?',
    'Which Clue is the Key Evidence?',
    'Which Means?',
    'Ready to solve?',
  ][step - 1]!;
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Solve · ${title}`}
      footer={
        <div className="space-y-2">
          {step === 4 && suspect && clue !== null && means !== null && (
            <>
              <p className="text-center font-semibold">
                {final ? 'Accuse' : 'Solve with'} {suspect.name}’s {content.cardName('clue', clue)}{' '}
                + {content.cardName('means', means)}?{' '}
                {final
                  ? 'Everyone sees your accusation and whether it’s right.'
                  : badges > 1
                    ? `This uses 1 of your ${badges} attempts.`
                    : 'This uses your only badge.'}
              </p>
              <Button
                size="lg"
                className="w-full"
                onClick={() =>
                  void act(
                    { type: 'solve', target: suspect.id, clue, means },
                    { anchor: 'inquest-solve' },
                  ).then((ok) => {
                    if (ok) close();
                  })
                }
              >
                {final ? '⚖️ Make my accusation' : '🔎 Solve the crime'}
              </Button>
            </>
          )}
          <RefusalSlot anchor="inquest-solve" />
          <div className="flex justify-between">
            <Button
              variant="ghost"
              size="sm"
              disabled={step === 1}
              onClick={() =>
                step === 4 ? setMeans(null) : step === 3 ? setClue(null) : setTarget(null)
              }
            >
              ← Back
            </Button>
            <span className="text-xs text-stone-500">Step {Math.min(step, 3)} of 3</span>
          </div>
        </div>
      }
    >
      {step === 1 && (
        <div className="grid grid-cols-2 gap-2">
          {suspectsOf(g)
            .filter((p) => p.id !== view.me?.id)
            .map((p) => (
              <Button
                key={p.id}
                variant="secondary"
                className="min-h-12"
                disabled={p.isFs}
                onClick={() => setTarget(p.id)}
              >
                {p.name}
              </Button>
            ))}
        </div>
      )}
      {(step === 2 || step === 3 || step === 4) && suspect && (
        <div className="space-y-2">
          <p className="text-sm text-stone-600 dark:text-stone-400">{suspect.name}’s cards</p>
          <div
            className={cn('grid gap-1.5', suspect.clue.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}
          >
            {suspect.clue.map((n) => (
              <ArtCard
                key={n}
                deck="clue"
                n={n}
                content={content}
                selected={clue === n}
                ruledOut={suspect.ruledOut.includes(n)}
                disabled={suspect.ruledOut.includes(n) || step === 4}
                onTap={() => setClue(n)}
              />
            ))}
          </div>
          <div
            className={cn(
              'grid gap-1.5',
              suspect.means.length > 4 ? 'grid-cols-5' : 'grid-cols-4',
              step === 2 && 'opacity-40',
            )}
          >
            {suspect.means.map((n) => (
              <ArtCard
                key={n}
                deck="means"
                n={n}
                content={content}
                selected={means === n}
                disabled={step !== 3}
                onTap={() => setMeans(n)}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** A plain-language card for an event as it comes up. */
export function EventCard({
  kind,
  view,
  content,
  onClose,
  onSolve,
}: {
  kind: EventKind | null;
  view: InquestView;
  content: Content;
  onClose: () => void;
  /** Opens the Solve sheet: A Good Twist offers its new attempt at once. */
  onSolve: () => void;
}) {
  const g = view.game;
  const ev = g?.event;
  const art = kind ? content.tileArt(EVENT_TILES[kind]) : null;
  // The tile says "immediately": the holder of the extra attempt may spend it now, or keep it.
  const twist = kind === 'good-twist' && twistOffer(view);
  const pending = (() => {
    if (!g || !ev || ev.kind !== kind) return null;
    switch (ev.kind) {
      case 'ruled-out':
        return ev.current === view.me?.id
          ? 'You’re up: flip one of your own Clue cards.'
          : `Now: ${nameOf(view, ev.current)}.`;
      case 'testimony':
        return g.myRole === 'witness'
          ? 'You’re the Witness: pick a tile in secret.'
          : 'Waiting for the Witness.';
      default:
        return g.myRole === 'forensic'
          ? 'Your move, Forensic Scientist.'
          : `Waiting for ${nameOf(view, g.fs)}.`;
    }
  })();
  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={kind ? `Event: ${content.eventName(kind)}` : ''}
    >
      {kind && (
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            {/* The tile's own print is too small to read, so only its heading shows, as a badge. */}
            {art && (
              <ProtectedImage
                src={art}
                alt=""
                aria-hidden
                className="size-16 shrink-0 rounded-lg object-cover object-top shadow ring-1 ring-black/20"
              />
            )}
            <p className="text-base leading-snug">{eventText(kind, view.settings)}</p>
          </div>
          {pending && <p className="font-semibold">{pending}</p>}
          {twist ? (
            <>
              <p className="font-semibold">
                The extra attempt is yours: use it now, or keep it for later.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="red"
                  onClick={() => {
                    onClose();
                    onSolve();
                  }}
                >
                  🔎 Use it now
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  Keep it for later
                </Button>
              </div>
            </>
          ) : (
            <Button className="w-full sm:w-auto" onClick={onClose}>
              Got it
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
