import type { PlayerId } from '@vt/game-sdk';
import { sortCards } from './cards.ts';
import { captainCannot, predictionOf } from './checks.ts';
import {
  canPass,
  controller,
  controls,
  legalFor,
  nextMission,
  signalBlock,
  signalable,
  voyageOf,
} from './game.ts';
import {
  type Attempt,
  type AttemptView,
  DUMMY,
  type DraftView,
  HOLD_SECONDS,
  type MissionControlState,
  type MissionControlView,
  type Role,
  type TaskView,
} from './types.ts';

function draftView(a: Attempt): DraftView {
  const d = a.draft;
  const m = a.mission.selection;
  let turn: string | null = null;
  if (a.stage === 'draft') {
    if (m === 'normal' || m === 'captain-skips' || m === 'hardest-first')
      turn = d.order[d.at % d.order.length] ?? null;
    else if (m === 'crew-wanted' && d.chosen.length < a.mission.wanted)
      turn = d.order[d.at] ?? null;
    else if (m === 'captain-offers') turn = d.at < d.order.length ? d.order[d.at]! : a.captain;
  }
  return {
    turn,
    canPass: canPass(a),
    order: d.order,
    answers: d.answers,
    chosen: d.chosen,
    ready: d.ready,
    given: d.given,
  };
}

function attemptView(a: Attempt, viewer: PlayerId | null, playedCards: boolean): AttemptView {
  const over = a.stage === 'done';
  const mine = viewer ? controls(a, viewer) : [];
  const briefing = a.stage === 'briefing';
  const tasks: TaskView[] = a.tasks.map((t, index) => {
    const p = predictionOf(t.check);
    const secret = !!p?.secret;
    const owns = t.owner !== null && viewer !== null && controller(a, t.owner) === viewer;
    return {
      index,
      key: t.key,
      check: t.check,
      text: t.text,
      difficulty: t.difficulty,
      owner: t.owner,
      crew: t.crew,
      prediction: secret && !owns && !over ? null : t.prediction,
      predictionSecret: secret,
      captainCannot: captainCannot(t.check),
      state: t.state,
      // A secret prediction's progress names its number.
      progress: secret && !owns && !over ? null : t.progress,
      why: t.why,
      at: t.at,
      fedBy: t.fedBy,
    };
  });
  const wins = (s: string) => a.tricks.filter((t) => t.winner === s).length;
  const turnSeat = a.stage === 'play' && mine.includes(a.turn) ? a.turn : null;
  const seat = viewer && a.crew.includes(viewer) ? viewer : null;
  const passes = a.distress.passes;
  const myPass = Object.fromEntries(Object.entries(passes).filter(([s]) => mine.includes(s)));
  const received = Object.fromEntries(
    Object.entries(a.distress.received).filter(([s]) => mine.includes(s) || over),
  );
  return {
    mission: a.mission,
    number: a.number,
    stage: a.stage,
    crew: a.crew.map((s) => ({
      id: s,
      dummy: s === DUMMY,
      captain: s === a.captain,
      cards: a.hands[s]?.length ?? 0,
      tricks: wins(s),
      token:
        s === DUMMY || a.comms === 'rapture' || a.comms === 'none'
          ? null
          : a.tokens.includes(s)
            ? 'unused'
            : 'used',
    })),
    captain: a.captain,
    controls: mine,
    hand: seat && !briefing ? sortCards(a.hands[seat] ?? []) : null,
    dummy:
      a.dummy && !briefing
        ? { up: a.dummy.up, down: a.dummy.down.filter((c) => c !== null).length }
        : null,
    legal: turnSeat ? legalFor(a, turnSeat) : [],
    tasks: briefing ? [] : tasks,
    draft: draftView(a),
    terrain: a.terrain,
    comms: a.comms,
    commsFrom: a.mission.commsFrom,
    signalBlock: seat ? signalBlock(a, seat) : null,
    signalable: seat ? signalable(a, seat) : {},
    pool: a.pool,
    signals: a.signals,
    holds: a.holds,
    holdUntil: a.holdSince === null ? null : a.holdSince + HOLD_SECONDS * 1000,
    distress: {
      proposal: a.distress.proposal,
      accepted: a.distress.accepted,
      dive: a.distress.dive,
      used: a.distress.used,
      dir: a.distress.dir,
      passed: Object.keys(passes),
      myPass,
      received,
    },
    tricks: (playedCards || over ? a.tricks : a.tricks.slice(-1)).map((t) => ({
      ...t,
      no: a.tricks.indexOf(t) + 1,
    })),
    trickCount: a.tricks.length,
    total: a.total,
    current: a.current,
    turn: a.turn,
    ready: a.ready,
    deadline: a.deadline,
    result: a.result,
    redeals: a.redeals,
    redraws: a.redraws,
    replay: over ? { hands: a.dealt, tricks: a.tricks } : null,
  };
}

export function view(state: MissionControlState, viewer: PlayerId | null): MissionControlView {
  const seats = Object.entries(state.seats).map(([id, s]) => ({ id, ...s }));
  const me = viewer && state.seats[viewer] ? { id: viewer, ...state.seats[viewer] } : null;
  const a = state.attempt;
  let role: Role = 'spectator';
  if (me?.playing)
    role = a && state.phase !== 'lobby' && !a.crew.includes(me.id) ? 'waiting' : 'player';
  const voyage = voyageOf(state);
  const campaign = voyage ? state.campaigns[voyage.key] : undefined;
  return {
    phase: state.phase,
    settings: state.settings,
    seats,
    me,
    role,
    voyages: state.voyages,
    voyage,
    campaign: campaign && voyage ? { ...campaign, next: nextMission(campaign, voyage) } : null,
    chosen: state.chosen,
    attempt: a ? attemptView(a, viewer, state.settings.playedCards) : null,
    emotes: state.emotes,
    notice: state.notice,
  };
}
