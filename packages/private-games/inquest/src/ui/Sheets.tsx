import { Button, Modal, ProtectedImage, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { EVENT_TILES, type EventKind } from '../logic/content.ts';
import { EVENT_TEXT } from '../logic/names.ts';
import type { InquestAction, InquestView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content } from './assets.ts';
import { type Mark, type Marks, markKey } from './marks.ts';
import { nameOf } from './status.ts';
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

/** Solving: suspect → Clue → Means, then a summary to confirm. */
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
                Solve with {suspect.id === view.me?.id ? 'your' : `${suspect.name}’s`}{' '}
                {content.cardName('clue', clue)} + {content.cardName('means', means)}?{' '}
                {badges > 1
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
                🔎 Solve the crime
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
          {suspectsOf(g).map((p) => (
            <Button
              key={p.id}
              variant="secondary"
              className="min-h-12"
              disabled={p.isFs}
              onClick={() => setTarget(p.id)}
            >
              {p.id === view.me?.id ? `${p.name} (you)` : p.name}
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
}: {
  kind: EventKind | null;
  view: InquestView;
  content: Content;
  onClose: () => void;
}) {
  const g = view.game;
  const ev = g?.event;
  const art = kind ? content.tileArt(EVENT_TILES[kind]) : null;
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
        <div className="flex gap-3">
          {art && (
            <ProtectedImage
              src={art}
              alt=""
              className="h-48 w-auto shrink-0 rounded-lg object-contain"
            />
          )}
          <div className="space-y-2">
            <p>{EVENT_TEXT[kind]}</p>
            {pending && <p className="font-semibold">{pending}</p>}
            <Button onClick={onClose}>Got it</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
