import { Button, Modal, Panel, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import type { ActOptions } from '@vt/game-sdk';
import type { Proposal, QuestResult, RoundTableAction, RoundTableView } from '../logic/types.ts';
import { RoleReveal } from './RoleCard.tsx';
import { SIDE_LABEL, SIDE_TEXT } from './Emblem.tsx';
import { currentQuest, nameOf, namesFor, who } from './status.ts';

export type Act = (a: RoundTableAction, options?: ActOptions) => Promise<boolean>;

const BIG = 'h-14 w-full text-lg';

export function RevealPanel({
  view,
  act,
  showGuide,
}: {
  view: RoundTableView;
  act: Act;
  showGuide: () => void;
}) {
  if (!view.role) return null;
  const ready = view.game!.ready.includes(view.me!.id);
  return (
    <div className="space-y-3">
      {ready ? (
        <p className="text-center text-sm text-stone-600 dark:text-stone-400">
          ✓ Ready. The game starts once everyone has read their card.
        </p>
      ) : (
        <Button size="lg" className={BIG} onClick={() => void act({ type: 'ready' })}>
          I’ve seen my role
        </Button>
      )}
      <RoleReveal view={view} showGuide={showGuide} />
    </div>
  );
}

export function ProposePanel({ view, act }: { view: RoundTableView; act: Act }) {
  const g = view.game!;
  const q = currentQuest(view);
  if (!q) return null;
  const mine = g.leader === view.me?.id && !!view.role;
  const full = g.draft.length === q.size;
  return (
    <Panel role="region" className="space-y-2" aria-label="Team">
      <p className="text-sm">
        <b>
          {mine ? 'Your team' : `${nameOf(view, g.leader)}’s team`} for quest {q.number}:
        </b>{' '}
        {g.draft.length ? namesFor(view, g.draft) : 'nobody yet'}{' '}
        <span className="text-stone-500 tabular-nums">
          ({g.draft.length}/{q.size})
        </span>
      </p>
      {mine && (
        <>
          <Button
            size="lg"
            className={BIG}
            disabled={!full}
            onClick={() => void act({ type: 'propose' }, { anchor: 'propose' })}
          >
            {full ? 'Send this team to the vote' : `Tap ${q.size - g.draft.length} more`}
          </Button>
          <RefusalSlot anchor="propose" />
        </>
      )}
    </Panel>
  );
}

export function VotePanel({ view, act }: { view: RoundTableView; act: Act }) {
  const vote = view.game!.vote!;
  if (!view.role) return null;
  const choice = (approve: boolean) => (
    <Button
      size="lg"
      variant={approve ? 'blue' : 'red'}
      aria-pressed={vote.myVote === approve}
      className={cn(
        BIG,
        vote.myVote !== null && vote.myVote !== approve && 'opacity-40',
        vote.myVote === approve && 'ring-4 ring-accent dark:ring-amber-400',
      )}
      onClick={() => void act({ type: 'vote', approve })}
    >
      {vote.myVote === approve && '✓ '}
      {approve ? 'Approve' : 'Reject'}
    </Button>
  );
  return (
    <Panel role="region" className="space-y-2" aria-label="Vote">
      <p className="text-sm">
        <b>
          {who(view, vote.leader, 'Your')}
          {vote.leader === view.me?.id ? '' : '’s'} team for quest {vote.slot + 1}:
        </b>{' '}
        {namesFor(view, vote.team)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {choice(true)}
        {choice(false)}
      </div>
      <p className="text-xs text-stone-500">
        Secret until everyone has voted. A tie is a rejection.
      </p>
    </Panel>
  );
}

export function QuestPanel({ view, act }: { view: RoundTableView; act: Act }) {
  const quest = view.game!.quest!;
  const role = view.role;
  const me = view.me?.id;
  if (!role || !me || !quest.team.includes(me)) return null;
  if (quest.myCard)
    return (
      <Panel className="text-center text-sm">
        You played <b>{quest.myCard === 'success' ? 'Success' : 'Fail'}</b>. Only you know.
      </Panel>
    );
  return (
    <Panel role="region" className="space-y-2" aria-label="Your quest card">
      <p className="text-sm font-semibold">Play your card in secret:</p>
      <div className={cn('grid gap-2', role.cards.length > 1 && 'grid-cols-2')}>
        {role.cards.map((card) => (
          <Button
            key={card}
            size="lg"
            variant={card === 'success' ? 'blue' : 'red'}
            className={BIG}
            onClick={() => void act({ type: 'play', card })}
          >
            {card === 'success' ? '✓ Success' : '✕ Fail'}
          </Button>
        ))}
      </div>
      {role.loyalty === 'good' && (
        <p className="text-xs text-stone-500">Loyal players can only play Success.</p>
      )}
    </Panel>
  );
}

/** The Lady's holder confirms the player they tapped. */
export function LadyPanel({
  view,
  act,
  target,
}: {
  view: RoundTableView;
  act: Act;
  target: string | null;
}) {
  const lady = view.game!.lady!;
  if (lady.holder !== view.me?.id) return null;
  return (
    <Panel role="region" className="space-y-2" aria-label="Lady of the Lake">
      <p className="text-sm">Tap a player above. People who have held the Lady can’t be checked.</p>
      <Button
        size="lg"
        className={BIG}
        disabled={!target}
        onClick={() => target && void act({ type: 'lady', target }, { anchor: 'lady' })}
      >
        {target ? `Check ${nameOf(view, target)}’s loyalty` : 'Pick someone to check'}
      </Button>
      <RefusalSlot anchor="lady" />
    </Panel>
  );
}

/** What the Lady just showed you (only you see this). */
export function LadyResult({ view }: { view: RoundTableView }) {
  const g = view.game!;
  const last = g.lady?.mine.at(-1);
  if (!last || last.round !== g.results.length || view.stage !== 'propose') return null;
  return (
    <p
      role="status"
      className="rounded-xl bg-team-b-soft px-3 py-2 text-center text-sm ring-1 ring-team-b-line dark:bg-sky-500/10 dark:ring-sky-500/30"
      data-testid="lady-result"
    >
      🌊 The Lady shows you: <b>{nameOf(view, last.target)}</b> is{' '}
      <b className={SIDE_TEXT[last.loyalty]}>{SIDE_LABEL[last.loyalty]}</b>. Only you see this; tell
      the table whatever you like.
    </p>
  );
}

/** The Assassin confirms their one shot. */
export function AssassinPanel({
  view,
  act,
  target,
}: {
  view: RoundTableView;
  act: Act;
  target: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  if (view.game!.assassin !== view.me?.id) return null;
  const name = target ? nameOf(view, target) : '';
  return (
    <Panel role="region" className="space-y-2" aria-label="Assassination">
      <p className="text-sm">Tap the player you think is Merlin. You get one guess.</p>
      <Button
        size="lg"
        variant="red"
        className={BIG}
        disabled={!target}
        onClick={() => setConfirming(true)}
      >
        {target ? `Name ${name} as Merlin` : 'Pick who is Merlin'}
      </Button>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Name Merlin?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button
              variant="red"
              onClick={() => {
                setConfirming(false);
                if (target) void act({ type: 'assassinate', target });
              }}
            >
              Yes, it’s {name}
            </Button>
          </div>
        }
      >
        <p>
          You’re naming <b>{name}</b> as Merlin. This can’t be undone: if you’re right, Evil wins.
        </p>
      </Modal>
    </Panel>
  );
}

/** For and Against, once a vote is in. */
export function VoteResult({ view, proposal }: { view: RoundTableView; proposal: Proposal }) {
  const ids = Object.keys(proposal.votes);
  const yes = ids.filter((id) => proposal.votes[id]);
  const no = ids.filter((id) => !proposal.votes[id]);
  const column = (title: string, list: string[], cls: string) => (
    <div>
      <p className="text-xs font-bold tracking-wide text-stone-500 uppercase">
        {title} ({list.length})
      </p>
      <ul className={cn('flex flex-wrap justify-center gap-x-2 text-sm font-semibold', cls)}>
        {list.map((id) => (
          <li key={id}>
            {who(view, id, 'You')}
            {proposal.autoVotes.includes(id) && (
              <span className="font-normal text-stone-500"> ⏱</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Panel role="region" className="space-y-2" aria-label="Vote result" data-testid="vote-result">
      <p className="text-center font-semibold">
        {who(view, proposal.leader, 'Your')}
        {proposal.leader === view.me?.id ? '' : '’s'} team was{' '}
        <span className={proposal.approved ? SIDE_TEXT.good : SIDE_TEXT.evil}>
          {proposal.approved ? 'approved' : 'rejected'}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-2 text-center">
        {column('For', yes, 'text-blue-700 dark:text-blue-300')}
        {column('Against', no, 'text-red-700 dark:text-red-300')}
      </div>
      {proposal.autoVotes.length > 0 && (
        <p className="text-center text-xs text-stone-500">
          ⏱ voted Approve for them (timer or host)
        </p>
      )}
    </Panel>
  );
}

/** A quest's result: how many Fails, never whose. */
export function QuestResultBanner({ result }: { result: QuestResult }) {
  return (
    <p
      role="status"
      data-testid="quest-result"
      className={cn(
        'rounded-xl px-3 py-2 text-center font-semibold ring-1',
        result.success
          ? 'bg-team-b-soft text-blue-900 ring-team-b-line dark:bg-blue-500/10 dark:text-blue-100 dark:ring-blue-500/30'
          : 'bg-team-a-soft text-red-900 ring-team-a-line dark:bg-red-500/10 dark:text-red-100 dark:ring-red-500/30',
      )}
    >
      Quest {result.slot + 1} {result.success ? 'succeeded' : 'was sunk'}: {result.fails} Fail{' '}
      {result.fails === 1 ? 'card' : 'cards'}
      {result.success && result.fails > 0 ? ' (it needed 2)' : ''}
    </p>
  );
}

/** What just happened, for the current stage: the last vote's result, the last quest's. */
export function LatestNews({ view }: { view: RoundTableView }) {
  const g = view.game!;
  const proposal = g.proposals.at(-1);
  const result = g.results.at(-1);
  const roundProposals = g.proposals.filter((p) => p.round === g.results.length + 1);
  if (view.stage === 'quest' && proposal) return <VoteResult view={view} proposal={proposal} />;
  if (view.stage === 'propose' && roundProposals.length > 0 && proposal && !proposal.approved)
    return <VoteResult view={view} proposal={proposal} />;
  if (
    result &&
    (view.stage === 'lady' || view.stage === 'assassinate' || view.stage === 'propose') &&
    roundProposals.length === 0
  )
    return <QuestResultBanner result={result} />;
  return null;
}

/** A dismissible first-time tip. */
export function Tip({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-special-soft px-3 py-2 text-sm text-violet-950 ring-1 ring-special-line dark:bg-violet-500/10 dark:text-violet-100 dark:ring-violet-500/30">
      <span aria-hidden>💡</span>
      <span className="flex-1">{children}</span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}
