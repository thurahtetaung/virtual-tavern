import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, Peek, RefusalSlot, cn } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import type { InquestAction, InquestView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content, Deck } from './assets.ts';
import { nameOf } from './status.ts';
import { suspectsOf } from './Suspects.tsx';

type Act = (a: InquestAction, o?: { anchor?: string }) => Promise<boolean>;

/** A hand of cards to pick from: full width on phones, capped so 8 cards fit a desktop screen. */
const HAND = 'mx-auto grid w-full max-w-lg gap-2';

/**
 * The Allies Phase (Allies expansion), once after round 1, night-style: the Lab Technician checks
 * one card on the table, then the Inside Man takes one badge. Everyone else waits, told only which
 * step is on, so nobody learns who holds those roles.
 */
export function AlliesPanel({
  view,
  content,
  act,
  room,
}: {
  view: InquestView;
  content: Content;
  act: Act;
  room: GameRoomInfo;
}) {
  const g = view.game!;
  const phase = g.allies;
  if (g.stage !== 'allies' || !phase?.step) return null;
  const clock = (
    <Countdown
      deadline={phase.deadline}
      clockOffset={room.clockOffset}
      label={phase.step === 'lab' ? 'for the check' : 'to take a badge'}
      atZero={phase.step === 'lab' ? 'then no card is checked' : 'then a badge is taken at random'}
    />
  );
  if (phase.step === 'lab' && g.myRole === 'lab-technician')
    return <LabPick view={view} content={content} act={act} clock={clock} />;
  if (phase.step === 'inside' && g.myRole === 'inside-man')
    return <InsidePick view={view} act={act} clock={clock} />;
  const lab = g.myRole === 'lab-technician' ? phase.lab : null;
  return (
    <Panel
      role="region"
      aria-label="Allies Phase"
      className="space-y-2 bg-stone-900 text-center text-stone-100 dark:bg-stone-950"
    >
      <p className="text-2xl" aria-hidden>
        🕵️
      </p>
      <p className="font-semibold">The allies are at work…</p>
      <p className="text-sm text-stone-300">
        {phase.step === 'lab'
          ? `The ${content.roleName('lab-technician')} is checking a card.`
          : `The ${content.roleName('inside-man')} is choosing whose badge to take.`}
      </p>
      <div className="flex justify-center">{clock}</div>
      {lab && (
        <LabResult>
          🤫 Your check: {nameOf(view, lab.owner)}’s {content.cardName(lab.deck, lab.n)}{' '}
          {lab.hit ? <b>is part of the crime 👍</b> : <b>is not part of the crime 👎</b>}
        </LabResult>
      )}
    </Panel>
  );
}

/** The Lab Technician's answer on the shared waiting screen: covered until they hold or Show. */
function LabResult({ children }: { children: ReactNode }) {
  return (
    <div data-testid="lab-result">
      <Peek
        what="your check"
        cover={
          <span className="block rounded-lg bg-stone-800 px-2 py-1 text-center text-sm">
            🤫 Your check is in: hold to read it
          </span>
        }
      >
        <p className="rounded-lg bg-stone-800 px-2 py-1 text-sm">{children}</p>
      </Peek>
    </div>
  );
}

function LabPick({
  view,
  content,
  act,
  clock,
}: {
  view: InquestView;
  content: Content;
  act: Act;
  clock: ReactNode;
}) {
  const g = view.game!;
  const suspects = suspectsOf(g);
  const [owner, setOwner] = useState<string | null>(null);
  const [card, setCard] = useState<{ deck: Deck; n: number } | null>(null);
  const who = suspects.find((p) => p.id === owner);
  return (
    <Panel
      role="region"
      aria-label="Check a card"
      className="space-y-2 ring-2 ring-info dark:ring-sky-500"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="shrink-0 font-bold whitespace-nowrap">🧪 Check one card</h3>
        {clock}
      </div>
      <p className="text-sm">
        Pick any card on the table: only you learn whether it is part of the crime.
      </p>
      <div className="flex flex-wrap gap-1.5" aria-label="Whose card">
        {suspects.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={owner === p.id}
            onClick={() => {
              setOwner(p.id);
              setCard(null);
            }}
            className={cn(
              'min-h-9 rounded-full px-3 text-sm font-semibold ring-1',
              owner === p.id
                ? 'bg-info dark:bg-sky-600 text-white ring-info dark:ring-sky-700'
                : 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600',
            )}
          >
            {p.id === view.me?.id ? `${p.name} (you)` : p.name}
          </button>
        ))}
      </div>
      {who && (
        <>
          <div className={cn(HAND, who.clue.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
            {who.clue.map((n) => (
              <ArtCard
                key={`c${n}`}
                deck="clue"
                n={n}
                content={content}
                ruledOut={who.ruledOut.includes(n)}
                selected={card?.deck === 'clue' && card.n === n}
                onTap={() => setCard({ deck: 'clue', n })}
              />
            ))}
          </div>
          <div className={cn(HAND, who.means.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
            {who.means.map((n) => (
              <ArtCard
                key={`m${n}`}
                deck="means"
                n={n}
                content={content}
                selected={card?.deck === 'means' && card.n === n}
                onTap={() => setCard({ deck: 'means', n })}
              />
            ))}
          </div>
        </>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={!who || !card}
        onClick={() =>
          void act(
            { type: 'lab-check', owner: who!.id, deck: card!.deck, n: card!.n },
            { anchor: 'inquest-allies' },
          )
        }
      >
        {who && card
          ? `Check ${who.name}’s ${content.cardName(card.deck, card.n)}`
          : 'Tap a player, then a card'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => void act({ type: 'lab-skip' }, { anchor: 'inquest-allies' })}
      >
        Skip the check
      </Button>
      <RefusalSlot anchor="inquest-allies" />
    </Panel>
  );
}

function InsidePick({ view, act, clock }: { view: InquestView; act: Act; clock: ReactNode }) {
  const g = view.game!;
  const [target, setTarget] = useState<string | null>(null);
  const holders = g.players.filter((p) => !p.isFs && !p.formerFs && !p.gone && p.badges > 0);
  return (
    <Panel
      role="region"
      aria-label="Take a badge"
      className="space-y-2 ring-2 ring-danger dark:ring-rose-500"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="shrink-0 font-bold whitespace-nowrap">🕴️ Take a badge</h3>
        {clock}
      </div>
      <p className="text-sm">
        Pick a player who still has a badge: they lose it. Everyone hears who lost one, never who
        took it. You may pick yourself to look innocent.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {holders.map((p) => (
          <Button
            key={p.id}
            variant={target === p.id ? 'primary' : 'secondary'}
            className="min-h-12"
            onClick={() => setTarget(p.id)}
          >
            {p.id === view.me?.id ? `${p.name} (you)` : p.name}
          </Button>
        ))}
      </div>
      <Button
        variant="red"
        size="lg"
        className="w-full"
        disabled={!target}
        onClick={() =>
          void act({ type: 'inside-pick', target: target! }, { anchor: 'inquest-allies' })
        }
      >
        {target ? `Take ${nameOf(view, target)}’s badge` : 'Tap a player first'}
      </Button>
      <RefusalSlot anchor="inquest-allies" />
    </Panel>
  );
}

/** The end: what the allies did and every Change of Heart, revealed. */
export function AlliesReveal({ view, content }: { view: InquestView; content: Content }) {
  const g = view.game!;
  const a = g.allies;
  if (!a && !g.perfect.length) return null;
  return (
    <Panel className="space-y-1">
      <h3 className="text-sm font-bold">Allies</h3>
      <ul className="space-y-0.5 text-sm">
        {a?.steps.includes('lab') && (
          <li>
            🧪{' '}
            {a.lab
              ? `The ${content.roleName('lab-technician')} checked ${nameOf(view, a.lab.owner)}’s ${content.cardName(a.lab.deck, a.lab.n)}: ${a.lab.hit ? 'part of the crime 👍' : 'not part of it 👎'}`
              : `The ${content.roleName('lab-technician')} made no check`}
          </li>
        )}
        {a?.steps.includes('inside') && (
          <li>
            🕴️{' '}
            {a.lostBadge
              ? `The ${content.roleName('inside-man')} took ${nameOf(view, a.lostBadge)}’s badge`
              : `The ${content.roleName('inside-man')} took no badge`}
          </li>
        )}
        {g.perfect.map((p, i) => (
          <li key={i}>
            🎭 {content.eventName('perfect-crime')}: {nameOf(view, p.by)} peeked at{' '}
            {p.tile === null ? 'nothing (no tile was left)' : `“${content.tileTitle(p.tile)}”`}
            {p.switched
              ? ', an event, and switched to the Murderer’s side.'
              : ', not an event, so stayed with the Investigators.'}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
