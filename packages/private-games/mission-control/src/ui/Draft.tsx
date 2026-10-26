import { Button, Panel, RefusalSlot, cn } from '@vt/ui';
import { type AttemptView, DUMMY, type MissionControlAction } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { CardBack } from './Card.tsx';
import { RolesDraft } from './Steps.tsx';
import { TaskChip } from './Tasks.tsx';

type Act = (a: MissionControlAction, o?: { anchor?: string }) => Promise<boolean>;
const ANCHOR = 'mc-draft';

/** Sharing out the tasks, in whichever way the mission says. */
export function Draft({
  a,
  me,
  act,
  name,
  openTable,
}: {
  a: AttemptView;
  me: string;
  act: Act;
  name: (id: string) => string;
  openTable: boolean;
}) {
  const art = useArt();
  const d = a.draft;
  const sel = a.mission.selection;
  const send = (action: MissionControlAction) => void act(action, { anchor: ANCHOR });
  const iControlDummy = a.controls.includes(DUMMY);
  const split = sel === 'crew-wanted' && d.chosen.length > 1;
  const free = sel === 'free' || split;
  const tasks = a.tasks.filter((t) => !t.crew);
  const allTaken = tasks.every((t) => t.owner !== null);
  const myTurn = d.turn !== null && a.controls.includes(d.turn);
  const roundRobin = sel === 'normal' || sel === 'captain-skips' || sel === 'hardest-first';
  const offering = sel === 'captain-offers' || sel === 'decision' || sel === 'distribution';
  const asking = (sel === 'crew-wanted' && !split) || (offering && d.turn !== a.captain);
  const captainGives = offering && d.turn === a.captain && a.controls.includes(a.captain);
  const canHold = (seat: string, captainCannot: boolean) => !(captainCannot && seat === a.captain);
  const claimers = (free ? [me, ...(iControlDummy ? [DUMMY] : [])] : []).filter(
    (s) => !split || d.chosen.includes(s),
  );

  if (sel === 'roles') return <RolesDraft a={a} me={me} act={act} name={name} />;
  return (
    <Panel className="space-y-3" data-testid="mc-draft">
      <p className="rounded-lg bg-special-soft px-3 py-2 text-center text-sm text-special-ink ring-1 ring-special-line dark:bg-violet-500/10 dark:text-violet-100 dark:ring-violet-500/30">
        {openTable
          ? '🗣️ Open table: talk freely.'
          : '🗣️ Talk about the tasks, never about your cards.'}
      </p>
      {d.hidden && (
        <div className="space-y-2 text-center" data-testid="mc-facedown">
          <p className="text-sm">
            {art.say('The tasks stay face down until the {captain} gives them away.')}
          </p>
          <div className="flex justify-center gap-1">
            {Array.from({ length: a.mission.rules.cards ?? 0 }, (_, i) => (
              <CardBack key={i} size="sm" />
            ))}
          </div>
        </div>
      )}
      <ul className="space-y-1.5">
        {tasks.map((t) => {
          let action = null;
          if (roundRobin && myTurn && t.owner === null) {
            const ok = canHold(d.turn!, t.captainCannot);
            action = (
              <Button
                size="sm"
                disabled={!ok}
                onClick={() => send({ type: 'take', task: t.index })}
                data-testid="mc-take"
              >
                Take{d.turn === DUMMY ? art.say(' for {dummy}') : ''}
              </Button>
            );
          } else if (free) {
            if (t.owner === null) {
              action = (
                <span className="flex shrink-0 flex-col gap-1">
                  {claimers.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      disabled={!canHold(s, t.captainCannot)}
                      onClick={() =>
                        send({
                          type: 'claim',
                          task: t.index,
                          on: true,
                          ...(s === DUMMY && { for: DUMMY }),
                        })
                      }
                      data-testid={s === DUMMY ? 'mc-claim-dummy' : 'mc-claim'}
                    >
                      Take{s === DUMMY ? art.say(' for {dummy}') : ''}
                    </Button>
                  ))}
                </span>
              );
            } else if (t.owner === me || (t.owner === DUMMY && iControlDummy)) {
              action = (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    send({
                      type: 'claim',
                      task: t.index,
                      on: false,
                      ...(t.owner === DUMMY && { for: DUMMY }),
                    })
                  }
                >
                  Put back
                </Button>
              );
            }
          }
          return (
            <li
              key={t.index}
              className={cn(
                sel === 'distribution' &&
                  d.offer === t.index &&
                  'rounded-xl ring-2 ring-accent dark:ring-amber-400',
              )}
            >
              <TaskChip task={t} name={name} showOwner you={me} action={action} />
            </li>
          );
        })}
      </ul>
      {a.tasks.some((t) => t.crew) && (
        <ul className="space-y-1.5">
          {a.tasks
            .filter((t) => t.crew)
            .map((t) => (
              <li key={t.index}>
                <TaskChip task={t} name={name} showOwner you={me} />
              </li>
            ))}
        </ul>
      )}

      {roundRobin && myTurn && d.canPass && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => send({ type: 'pass' })}
          data-testid="mc-pass"
        >
          Pass{d.turn === DUMMY ? art.say(' for {dummy}') : ''}
        </Button>
      )}

      {sel === 'all-to-one' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => send({ type: 'take-all' })} data-testid="mc-take-all">
            I’ll take them all
          </Button>
          {iControlDummy && (
            <Button variant="secondary" onClick={() => send({ type: 'take-all', for: DUMMY })}>
              {art.say('{Dummy} takes them all')}
            </Button>
          )}
        </div>
      )}

      {(sel === 'crew-wanted' || offering) && Object.keys(d.answers).length > 0 && (
        <p className="text-sm">
          {Object.entries(d.answers).map(([s, yes]) => (
            <span key={s} className="mr-3 inline-block">
              {name(s)}: {yes ? '🙋 yes' : '🙅 no'}
            </span>
          ))}
        </p>
      )}
      {asking && myTurn && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => send({ type: 'answer', yes: true })} data-testid="mc-yes">
            🙋 Yes{d.turn === DUMMY ? art.say(' ({dummy})') : ''}
          </Button>
          <Button
            variant="secondary"
            onClick={() => send({ type: 'answer', yes: false })}
            data-testid="mc-no"
          >
            🙅 No
          </Button>
        </div>
      )}
      {captainGives && sel !== 'captain-offers' && (
        <div className="grid gap-2 sm:grid-cols-2" data-testid="mc-give">
          {a.crew
            .map((c) => c.id)
            .filter((s) => sel === 'distribution' || s !== a.captain)
            .map((s) => (
              <Button key={s} variant="secondary" onClick={() => send({ type: 'give', to: s })}>
                {sel === 'decision' ? 'Give them all to ' : 'Give it to '}
                {s === me ? 'me' : name(s)}
              </Button>
            ))}
        </div>
      )}
      {captainGives && sel === 'captain-offers' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={() => send({ type: 'give', to: a.captain })}>Keep every task</Button>
          {Object.entries(d.answers)
            .filter(([, yes]) => yes)
            .map(([s]) => (
              <Button key={s} variant="secondary" onClick={() => send({ type: 'give', to: s })}>
                Give them to {name(s)}
              </Button>
            ))}
        </div>
      )}

      {(free || sel === 'all-to-one') && (
        <Button
          size="lg"
          className="w-full"
          disabled={
            !allTaken ||
            d.ready.includes(me) ||
            (split && d.chosen.some((s) => !tasks.some((t) => t.owner === s)))
          }
          onClick={() => send({ type: 'ready' })}
          data-testid="mc-draft-ready"
        >
          {d.ready.includes(me) ? 'Ready ✓' : allTaken ? 'Ready' : 'Every task needs a holder'}
        </Button>
      )}
      <RefusalSlot anchor={ANCHOR} resetKey={tasks.map((t) => t.owner).join()} />
    </Panel>
  );
}
