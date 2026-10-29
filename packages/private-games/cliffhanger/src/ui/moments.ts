import { progress } from '../logic/genres.ts';
import { COUNTDOWN_MS, type CliffhangerView, type TeamId, TEAMS } from '../logic/types.ts';

// The big moments every screen shows at the same time, worked out from the view on the server
// clock: the 3-2-1, GO!, TIME'S UP (a face-off or a turn running out), a clean sweep, match point.
// Pure, so the table screen and the phones agree and it can be tested.

/** How long GO! and TIME'S UP stay up. */
export const GO_MS = 900;
export const TIMES_UP_MS = 1800;

export type Moment =
  | { kind: 'count'; n: number; until: number; what: 'faceoff' | 'turn' }
  | { kind: 'go'; until: number }
  | { kind: 'times-up'; until: number; of: 'faceoff' | 'turn' }
  | { kind: 'sweep'; until: number; team: TeamId };

/** The turn's own length: a turn that ended sooner was ended by its cards running out. */
const turnMs = (view: CliffhangerView) => view.settings.turnSeconds * 1000;

/** The moment on screen at server time `now`, if any. */
export function momentAt(view: CliffhangerView, now: number): Moment | null {
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  if (r.stage === 'countdown' && r.stageEnds !== null) {
    const left = r.stageEnds - now;
    if (left > 0 && left <= COUNTDOWN_MS) {
      const n = Math.ceil(left / 1000);
      return { kind: 'count', n, until: r.stageEnds - (n - 1) * 1000, what: r.after ?? 'turn' };
    }
  }
  const t = r.turn;
  if (t && now >= t.endsAt && now < t.endsAt + TIMES_UP_MS && r.stage !== 'turn') {
    return t.endsAt - t.startedAt >= turnMs(view) - 50
      ? { kind: 'times-up', until: t.endsAt + TIMES_UP_MS, of: 'turn' }
      : { kind: 'sweep', until: t.endsAt + TIMES_UP_MS, team: t.team };
  }
  const started =
    r.stage === 'turn' && t
      ? t.startedAt
      : r.stage === 'faceoff'
        ? r.faceoff?.flippedAt
        : undefined;
  if (started !== undefined && now >= started && now < started + GO_MS) {
    return { kind: 'go', until: started + GO_MS };
  }
  const fr = r.faceoffResult;
  const fo = r.faceoff;
  if (
    fr?.how === 'time' &&
    fo?.firstAt !== null &&
    fo?.firstAt !== undefined &&
    r.stage === 'keep'
  ) {
    const end = fo.firstAt + fr.ms;
    if (now >= end && now < end + TIMES_UP_MS)
      return { kind: 'times-up', until: end + TIMES_UP_MS, of: 'faceoff' };
  }
  return null;
}

/** When the moment after `now` starts (to wake up for it), or null. */
export function nextMomentAt(view: CliffhangerView, now: number): number | null {
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  const times = [
    r.stage === 'countdown' && r.stageEnds !== null ? r.stageEnds - COUNTDOWN_MS : null,
    r.stage === 'countdown' && r.stageEnds !== null ? r.stageEnds : null,
    r.turn?.endsAt ?? null,
  ].filter((t): t is number => t !== null && t > now);
  return times.length ? Math.min(...times) : null;
}

/** Teams one genre (card) from the goal. */
export function atMatchPoint(view: CliffhangerView): TeamId[] {
  const goal = view.target;
  return TEAMS.filter((t) => {
    const p = progress(
      view.collections[t].map((c) => c.genre),
      goal,
    );
    return p.need - p.have === 1;
  });
}
