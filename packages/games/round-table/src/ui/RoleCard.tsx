import { Button, Modal, cn } from '@vt/ui';
import { type PointerEvent, useRef, useState } from 'react';
import { ROLE_GOAL } from '../logic/guide.ts';
import { ROLES } from '../logic/roles.ts';
import type { Known, RoleId, RoundTableView } from '../logic/types.ts';
import { Emblem, SIDE_LABEL, SIDE_TEXT } from './Emblem.tsx';
import { nameOf } from './status.ts';

/** The guide's anchor for a role (GuideView gives each role entry this id). */
export const roleAnchor = (role: RoleId) =>
  `guide-role-${ROLES[role].name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/** Opens the rules drawer at a role's card. */
export function openRoleGuide(showGuide: (topic?: unknown) => void, role: RoleId) {
  showGuide(roleAnchor(role));
}

/** How a known player is labelled, given which of Merlin and Morgana are in the deck. */
function knownLabel(k: Known, deck: readonly RoleId[]): { text: string; cls: string } {
  if (k.as === 'evil')
    return { text: 'Evil', cls: 'bg-team-a text-white dark:bg-red-500 dark:text-red-950' };
  const merlin = deck.includes('merlin');
  const morgana = deck.includes('morgana');
  return {
    text: merlin && morgana ? 'Merlin or Morgana' : merlin ? 'Merlin' : 'Morgana',
    cls: 'bg-special text-white dark:bg-violet-400 dark:text-violet-950',
  };
}

/** One line on what you know at the start. */
function knowledgeLine(role: RoleId, known: Known[], deck: readonly RoleId[]): string {
  if (role === 'percival') {
    if (known.length === 2)
      return 'One of these is Merlin, the other is Morgana. You don’t know which.';
    return known.length ? 'You know this player:' : 'Neither Merlin nor Morgana is in this game.';
  }
  if (role === 'merlin')
    return known.length
      ? `These players are Evil${deck.includes('mordred') ? ' (Mordred is hidden from you)' : ''}:`
      : 'You see no Evil players: they are all hidden from you.';
  if (ROLES[role].loyalty === 'evil')
    return known.length
      ? `Your fellow Evil players${deck.includes('oberon') && role !== 'oberon' ? ' (Oberon isn’t among them)' : ''}:`
      : role === 'oberon'
        ? 'You don’t know the other Evil players, and they don’t know you.'
        : 'You don’t see any other Evil players.';
  return 'You know nothing about the others: watch the votes and the quests.';
}

/** Your role, what it means, and what you know. */
export function RoleDetails({
  view,
  showGuide,
}: {
  view: RoundTableView;
  showGuide: (topic?: unknown) => void;
}) {
  const role = view.role;
  const g = view.game;
  if (!role || !g) return null;
  const def = ROLES[role.role];
  const checks = g.lady?.mine ?? [];
  return (
    <div className="space-y-3 text-left" data-testid="role-details">
      <div className="flex items-center gap-3">
        <Emblem role={role.role} className="size-16" />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">You are</p>
          <p
            className={cn('text-2xl leading-tight font-bold', SIDE_TEXT[role.loyalty])}
            data-testid="role-name"
          >
            {def.name}
          </p>
          <p className="text-sm">
            <span className={cn('font-semibold', SIDE_TEXT[role.loyalty])}>
              {SIDE_LABEL[role.loyalty]}
            </span>{' '}
            · {def.blurb}
          </p>
        </div>
      </div>
      <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm dark:bg-stone-800">
        <b>Your goal: </b>
        {ROLE_GOAL[role.loyalty]}
      </p>
      <p className="text-sm">{def.detail}</p>
      {role.assassin && (
        <p className="rounded-lg bg-team-a-soft px-3 py-2 text-sm text-red-900 ring-1 ring-team-a-line dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/30">
          🗡️{' '}
          {role.designated
            ? 'There’s no Assassin card this game: you name Merlin if Good wins three quests. Nobody else is told.'
            : 'If Good wins three quests, you name Merlin.'}
        </p>
      )}
      <div>
        <p className="text-sm font-semibold">{knowledgeLine(role.role, role.known, g.deck)}</p>
        {role.known.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-2" aria-label="What you know">
            {role.known.map((k) => {
              const label = knownLabel(k, g.deck);
              return (
                <li
                  key={k.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 pr-1 pl-3 text-sm font-semibold ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
                >
                  {nameOf(view, k.id)}
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', label.cls)}>
                    {label.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {checks.length > 0 && (
        <div>
          <p className="text-sm font-semibold">
            🌊 Your Lady of the Lake checks (only you see these):
          </p>
          <ul className="text-sm">
            {checks.map((c) => (
              <li key={c.round}>
                {nameOf(view, c.target)} is{' '}
                <b className={SIDE_TEXT[c.loyalty]}>{SIDE_LABEL[c.loyalty]}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className="text-sm font-semibold text-amber-700 underline dark:text-amber-400"
        onClick={() => openRoleGuide(showGuide, role.role)}
      >
        About {def.name} in the rules →
      </button>
    </div>
  );
}

/**
 * The secret card at the start: covered until you slide the cover up (or hold it, or tap
 * Show), so neighbours can't read it over your shoulder.
 */
export function RoleReveal({
  view,
  showGuide,
}: {
  view: RoundTableView;
  showGuide: (topic?: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const shown = open || held;
  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    setHeld(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    setDrag(Math.max(0, start.current - e.clientY));
  };
  const up = () => {
    if (drag > 60) setOpen(true);
    start.current = null;
    setDrag(0);
    setHeld(false);
  };
  return (
    <section aria-label="Your role card" className="space-y-2">
      <div className="flex justify-center">
        <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? '🙈 Hide my role' : '👁️ Show my role'}
        </Button>
      </div>
      <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
        <div className={cn(!shown && 'invisible')} aria-hidden={!shown}>
          <RoleDetails view={view} showGuide={showGuide} />
        </div>
        {!open && (
          <div
            role="presentation"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            style={{ transform: `translateY(-${drag}px)` }}
            className={cn(
              'absolute inset-0 flex cursor-grab touch-none flex-col items-center justify-center gap-2 bg-gradient-to-b from-stone-800 to-stone-950 text-stone-100 select-none',
              held && drag < 8 && 'opacity-0',
            )}
          >
            <span aria-hidden className="text-3xl">
              ⬆️
            </span>
            <span className="font-semibold">Slide up, or hold, to see your role</span>
            <span className="text-xs text-stone-400">Keep it hidden from the others</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** "My role": re-opens your card any time. */
export function RoleSheet({
  view,
  open,
  onClose,
  showGuide,
}: {
  view: RoundTableView;
  open: boolean;
  onClose: () => void;
  showGuide: (topic?: unknown) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Your secret role">
      {open && (
        <RoleDetails
          view={view}
          showGuide={() => {
            onClose();
            showGuide();
          }}
        />
      )}
    </Modal>
  );
}
