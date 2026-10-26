import { Button, Panel, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { tokenLabel } from '../logic/onecard.ts';
import { type AttemptView, DUMMY, type MissionControlAction } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { Rich } from './Card.tsx';
import { TaskChip } from './Tasks.tsx';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;
const ANCHOR = 'mc-steps';

/** Answers given so far, in turn order. */
function Answers({ a, name }: { a: AttemptView; name: (id: string) => string }) {
  const p = a.extras.pick;
  if (!Object.keys(p.answers).length) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="mc-answers">
      {p.order
        .filter((s) => s in p.answers)
        .map((s) => (
          <li key={s}>
            <strong>{name(s)}</strong>: {p.answers[s]}
          </li>
        ))}
    </ul>
  );
}

/** The question round: whoever is asked answers with one of the replies. */
function ReplyButtons({ a, replies, act }: { a: AttemptView; replies: string[]; act: Act }) {
  const p = a.extras.pick;
  const asked = p.order[p.at];
  if (!asked || !a.controls.includes(asked)) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {replies.map((r) => (
        <Button
          key={r}
          onClick={() => void act({ type: 'reply', reply: r }, { anchor: ANCHOR })}
          data-testid="mc-reply"
        >
          {r}
        </Button>
      ))}
    </div>
  );
}

/** The captain's pick: the question round, then the captain chooses a crew member. */
export function PickPanel({
  a,
  me,
  act,
  name,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
}) {
  const art = useArt();
  const r = a.mission.rules.pick!;
  const p = a.extras.pick;
  const answered = p.at >= p.order.length;
  const options = a.crew
    .map((c) => c.id)
    .filter((s) => (r.self || s !== a.captain) && !(r.role === 'mute' && s === DUMMY));
  return (
    <Panel className="space-y-3" data-testid="mc-pick">
      {r.question && <p className="text-center font-semibold">{r.question}</p>}
      <Answers a={a} name={name} />
      <ReplyButtons a={a} replies={r.replies ?? ['Yes', 'No']} act={act} />
      {answered && me === a.captain && (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((s) => (
            <Button
              key={s}
              variant="secondary"
              onClick={() => void act({ type: 'choose-member', seat: s }, { anchor: ANCHOR })}
              data-testid="mc-choose"
            >
              {s === me ? 'Me' : name(s)}
            </Button>
          ))}
        </div>
      )}
      {answered && me !== a.captain && (
        <p className="text-center text-sm">{art.say(`Waiting for the {captain} to choose…`)}</p>
      )}
      <RefusalSlot anchor={ANCHOR} />
    </Panel>
  );
}

/** Before the draft: swap two tokens (or move one onto an unmarked task), if everyone agrees. */
export function TokensPanel({
  a,
  me,
  act,
  name,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
}) {
  const [first, setFirst] = useState<number | null>(null);
  const e = a.extras.tokenEdit;
  const swap = a.mission.rules.tokenEdit === 'swap';
  const tasks = a.tasks.filter((t) => !t.crew);
  const pick = (i: number) => {
    if (first === null) {
      if (a.tasks[i]!.token) setFirst(i);
      return;
    }
    if (i !== first) void act({ type: 'token-edit', a: first, b: i }, { anchor: ANCHOR });
    setFirst(null);
  };
  return (
    <Panel className="space-y-3" data-testid="mc-tokens">
      <p className="text-sm">
        {swap
          ? 'You may swap the tokens of two tasks. Tap a task with a token, then the other.'
          : 'You may move one token onto a task without one. Tap the token’s task, then the empty one.'}
      </p>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.index}>
            <button
              type="button"
              disabled={!!e.proposal}
              onClick={() => pick(t.index)}
              className={cn(
                'w-full rounded-xl text-left',
                first === t.index && 'ring-2 ring-accent dark:ring-amber-400',
              )}
            >
              <TaskChip task={t} name={name} you={me} />
            </button>
          </li>
        ))}
      </ul>
      {e.proposal ? (
        <div className="space-y-2 text-center">
          <p className="font-semibold">
            {name(e.proposal.by)} proposes: {swap ? 'swap' : 'move'}{' '}
            {tokenLabel(a.tasks[e.proposal.a]!.token ?? '1')}
            {swap ? ` and ${tokenLabel(a.tasks[e.proposal.b]!.token ?? '1')}` : ''}. Agreed:{' '}
            {e.accepted.map(name).join(', ')}
          </p>
          {!e.accepted.includes(me) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => void act({ type: 'token-answer', yes: true }, { anchor: ANCHOR })}
                data-testid="mc-token-yes"
              >
                Agree
              </Button>
              <Button
                variant="secondary"
                onClick={() => void act({ type: 'token-answer', yes: false }, { anchor: ANCHOR })}
              >
                No
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={e.ready.includes(me)}
          onClick={() => void act({ type: 'ready' }, { anchor: ANCHOR })}
          data-testid="mc-tokens-keep"
        >
          {e.ready.includes(me) ? 'Waiting…' : 'Keep the tokens as they are'}
        </Button>
      )}
      <RefusalSlot anchor={ANCHOR} />
    </Panel>
  );
}

/** Five players: one task may change hands once, if everyone agrees. */
export function HandOverPanel({
  a,
  me,
  act,
  name,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
}) {
  const [task, setTask] = useState<number | null>(null);
  const h = a.extras.handOver;
  const held = a.tasks.filter((t) => !t.crew && t.owner);
  return (
    <Panel className="space-y-3" data-testid="mc-handover">
      <p className="text-sm">
        Talk about tasks, never cards. Tap a task, then whom it should go to.
      </p>
      <ul className="space-y-1.5">
        {held.map((t) => (
          <li key={t.index}>
            <button
              type="button"
              disabled={!!h.proposal}
              onClick={() => setTask(task === t.index ? null : t.index)}
              className={cn(
                'w-full rounded-xl text-left',
                task === t.index && 'ring-2 ring-accent dark:ring-amber-400',
              )}
            >
              <TaskChip task={t} name={name} showOwner you={me} />
            </button>
          </li>
        ))}
      </ul>
      {task !== null && !h.proposal && (
        <div className="flex flex-wrap gap-2">
          {a.crew
            .map((c) => c.id)
            .filter((s) => s !== a.tasks[task]!.owner)
            .map((s) => (
              <Button
                key={s}
                size="sm"
                variant="secondary"
                onClick={() => {
                  void act({ type: 'hand-over', task, to: s }, { anchor: ANCHOR });
                  setTask(null);
                }}
              >
                To {s === DUMMY ? name(DUMMY) : <PlayerTag name={name(s)} />}
              </Button>
            ))}
        </div>
      )}
      {h.proposal ? (
        <div className="space-y-2 text-center">
          <p className="font-semibold">
            {name(h.proposal.by)} proposes giving{' '}
            <Rich text={a.tasks[h.proposal.task]!.text} name={name} /> to {name(h.proposal.to)}.
          </p>
          {!h.accepted.includes(me) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() =>
                  void act({ type: 'hand-over-answer', yes: true }, { anchor: ANCHOR })
                }
              >
                Agree
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  void act({ type: 'hand-over-answer', yes: false }, { anchor: ANCHOR })
                }
              >
                No
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={h.ready.includes(me)}
          onClick={() => void act({ type: 'ready' }, { anchor: ANCHOR })}
          data-testid="mc-handover-skip"
        >
          {h.ready.includes(me) ? 'Waiting…' : 'No hand-over: carry on'}
        </Button>
      )}
      <RefusalSlot anchor={ANCHOR} />
    </Panel>
  );
}

/** Roles: preferences in turn, then each crew member claims a role. */
export function RolesDraft({
  a,
  me,
  act,
  name,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
}) {
  const names = a.mission.rules.roleNames ?? [
    'First four tricks',
    'Tricks in between',
    'Last trick',
  ];
  const p = a.extras.pick;
  const asking = p.at < p.order.length;
  const d = a.draft;
  const seats = a.controls;
  return (
    <Panel className="space-y-3" data-testid="mc-roles">
      <Answers a={a} name={name} />
      {asking ? (
        <ReplyButtons a={a} replies={names} act={act} />
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-3">
            {names.map((label, r) => (
              <li
                key={r}
                className="space-y-1 rounded-xl bg-card p-2 ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700"
              >
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs">
                  {a.crew
                    .map((c) => c.id)
                    .filter((s) => d.roles[s] === r)
                    .map(name)
                    .join(', ') || '–'}
                </p>
                <div className="flex flex-wrap gap-1">
                  {seats.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={d.roles[s] === r ? 'primary' : 'secondary'}
                      onClick={() =>
                        void act(
                          { type: 'role', role: r, ...(s === DUMMY && { for: DUMMY }) },
                          { anchor: ANCHOR },
                        )
                      }
                      data-testid={s === DUMMY ? `mc-role-dummy-${r}` : `mc-role-${r}`}
                    >
                      {s === DUMMY ? name(DUMMY) : 'Me'}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Button
            size="lg"
            className="w-full"
            disabled={d.ready.includes(me)}
            onClick={() => void act({ type: 'ready' }, { anchor: ANCHOR })}
            data-testid="mc-roles-ready"
          >
            {d.ready.includes(me) ? 'Ready ✓' : 'Ready'}
          </Button>
        </>
      )}
      <RefusalSlot anchor={ANCHOR} />
    </Panel>
  );
}
