import { Button, Card, Icon, Modal, NameDot, Peek, cn, usePhone } from '@vt/ui';
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
  if (k.as === 'evil') return { text: 'Evil', cls: 'bg-team-a text-on-fill' };
  const merlin = deck.includes('merlin');
  const morgana = deck.includes('morgana');
  return {
    text: merlin && morgana ? 'Merlin or Morgana' : merlin ? 'Merlin' : 'Morgana',
    cls: 'bg-special text-on-fill',
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
      {/* The role band: the loyalty's colour, as the emblem shows it. */}
      <div
        aria-hidden
        className={cn('h-1 rounded-full', role.loyalty === 'good' ? 'bg-team-b' : 'bg-team-a')}
      />
      <div className="flex items-center gap-3">
        <Emblem role={role.role} className="size-16" />
        <div className="min-w-0">
          <p className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
            You are
          </p>
          <p
            className={cn('text-heading leading-tight font-bold', SIDE_TEXT[role.loyalty])}
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
      <p className="rounded-lg bg-sunk px-3 py-2 text-small">
        <b>Your goal: </b>
        {ROLE_GOAL[role.loyalty]}
      </p>
      <p className="text-sm">{def.detail}</p>
      {role.assassin && (
        <p className="rounded-lg bg-team-a-soft px-3 py-2 text-small text-team-a-ink ring-1 ring-team-a-line">
          🗡️{' '}
          {role.designated
            ? 'There’s no Assassin card this game: you name Merlin if Good wins three quests. Nobody else is told.'
            : 'If Good wins three quests, you name Merlin.'}
        </p>
      )}
      <div>
        <p className="text-small font-semibold">{knowledgeLine(role.role, role.known, g.deck)}</p>
        {role.known.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-2" aria-label="What you know">
            {role.known.map((k) => {
              const label = knownLabel(k, g.deck);
              return (
                <li
                  key={k.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pr-1 pl-3 text-small font-semibold ring-1 ring-line-strong"
                >
                  {nameOf(view, k.id)}
                  <NameDot name={nameOf(view, k.id)} className="order-first" />
                  <span className={cn('rounded-full px-2 py-0.5 text-caption', label.cls)}>
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
          <p className="text-small font-semibold">
            🌊 Your Lady of the Lake checks (only you see these):
          </p>
          <ul className="text-small">
            {checks.map((c) => (
              <li key={c.round}>
                {nameOf(view, c.target)} is{' '}
                <b className={SIDE_TEXT[c.loyalty]}>{SIDE_LABEL[c.loyalty]}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="quiet"
        size="sm"
        className="-ml-3"
        onClick={() => openRoleGuide(showGuide, role.role)}
      >
        About {def.name} in the rules →
      </Button>
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
  // A mouse can't slide the cover, so wider screens name the hold and the Show button.
  const phone = usePhone();
  return (
    <section aria-label="Your role card">
      {/* Only in the page while uncovered: a covered card carries nothing a neighbour (or the
          page's text) could read. */}
      <Peek
        what="my role"
        slide
        cover={
          // The card's back: the theme's card surface with the accent band, and both sides'
          // emblems, since it could be either.
          <span className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border-t-4 border-accent bg-card text-ink shadow-vt-3 ring-1 ring-line">
            <span aria-hidden className="flex items-center gap-3">
              <Emblem role="servant" className="size-16" />
              <span className="font-display text-title font-bold text-ink-muted">?</span>
              <Emblem role="minion" className="size-16" />
            </span>
            <span className="font-semibold">
              {phone ? (
                <>
                  <span aria-hidden>⬆️ </span>Slide up, or hold, to see your role
                </>
              ) : (
                'Hold the card (or press Show) to see your role'
              )}
            </span>
            <span className="text-caption text-ink-2">Keep it hidden from the others</span>
          </span>
        }
      >
        <Card className="shadow-vt-3">
          <RoleDetails view={view} showGuide={showGuide} />
        </Card>
      </Peek>
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

/**
 * Over the seats: the badges for what you know (Evil teammates, Merlin or Morgana, your Lady
 * checks) only show while you hold this or switch it on, and `onShownChange` tells the table.
 * It looks the same for every player, so having it says nothing about your role. Key it per game
 * so a new game starts covered.
 */
export function KnowledgePeek({ onShownChange }: { onShownChange: (shown: boolean) => void }) {
  const bar =
    'flex min-h-11 items-center gap-1.5 rounded-xl bg-sunk px-3 text-caption text-ink-2 ring-1 ring-line';
  return (
    <div data-testid="knowledge-peek">
      <Peek
        what="what you know"
        inline
        onShownChange={onShownChange}
        cover={
          <span className={bar}>
            <Icon name="lock" size={16} />
            Hidden: hold to see what you know
          </span>
        }
      >
        <p className={bar}>👁️ Showing what you know on the seats</p>
      </Peek>
    </div>
  );
}
