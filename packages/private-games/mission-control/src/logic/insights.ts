import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { DUMMY, EPILOGUE, type MissionControlAction, type MissionControlState } from './types.ts';

/**
 * Stats only. Each attempt is one game for the stats recorder (`phase` goes `playing` → `over`):
 * a `signal` per signal, a `distress` when the crew sends one, a `task` when a task is done (with
 * the teammates who fed it and whether a teammate's signal came right before), a `feed` for each
 * feeder, and the attempt's `outcome`. The dummy is never credited.
 */
export function insights(
  before: MissionControlState,
  after: MissionControlState,
  _action: MissionControlAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const a = after.attempt;
  if (!a) return [];
  const b = before.attempt && before.attempt.startedAt === a.startedAt ? before.attempt : null;
  const out: InsightEvent[] = [];
  const person = (s: string | null) => (s && s !== DUMMY ? s : null);

  for (const s of a.signals.slice(b?.signals.length ?? 0)) {
    out.push({ type: 'signal', playerId: s.by, props: { trick: s.before, comms: a.comms } });
  }
  if (a.distress.used && !b?.distress.used) {
    out.push({ type: 'distress', playerId: null, props: { dir: a.distress.dir ?? 'left' } });
  }
  a.tasks.forEach((t, i) => {
    if (t.state !== 'done' || b?.tasks[i]?.state === 'done' || t.crew) return;
    const owner = person(t.owner);
    const fedBy = t.fedBy.filter((s) => s !== DUMMY);
    const signalBy = [
      ...new Set(a.signals.filter((s) => s.before === t.at && s.by !== t.owner).map((s) => s.by)),
    ];
    out.push({
      type: 'task',
      playerId: owner,
      props: { trick: t.at ?? 0, fedBy, signalBy, difficulty: t.difficulty },
    });
    for (const f of fedBy) out.push({ type: 'feed', playerId: f, props: { to: owner } });
  });
  if (a.stage === 'done' && b?.stage !== 'done' && a.result) {
    const people = a.crew.filter((s) => s !== DUMMY);
    const failed = a.result.task !== null ? a.tasks[a.result.task] : null;
    out.push({
      type: 'outcome',
      playerId: null,
      ...(a.result.success && { winners: people }),
      props: {
        success: a.result.success,
        mission: a.mission.n,
        voyage: after.settings.voyageKey,
        cardTasks: a.mission.cardTasks,
        epilogue: a.mission.n === EPILOGUE,
        level: a.mission.n === EPILOGUE ? (a.mission.difficulty ?? 0) : 0,
        practice: a.mission.practice,
        attempt: a.number,
        players: people.length,
        dummy: a.crew.includes(DUMMY),
        tricks: a.result.tricks,
        tasks: a.tasks.filter((t) => !t.crew).length,
        distress: a.distress.used,
        timedOut: a.result.timedOut,
        comms: a.comms,
        signals: a.signals.length,
        failedBy: person(failed?.owner ?? null),
      },
    });
  }
  return out;
}
