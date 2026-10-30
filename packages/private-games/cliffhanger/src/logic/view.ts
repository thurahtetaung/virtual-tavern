import type { PlayerId } from '@vt/game-sdk';
import { goalFor, styleFor } from './genres.ts';
import { goalNow, peekPair, teamOf } from './game.ts';
import type {
  CliffhangerState,
  CliffhangerView,
  Round,
  RoundView,
  Slot,
  SlotView,
  TeamId,
} from './types.ts';

/**
 * Who may see the card on one of `owner`'s squares. A card that was got is public, and so is
 * everything once the round's turns are over. Otherwise its describer; its own team once its turn
 * is over; and the other describer once stealing opens. Never the other team while it is being
 * described, a team while it may still be guessing it, a watcher or the table screen.
 */
function canSee(
  state: CliffhangerState,
  round: Round,
  owner: TeamId,
  slot: Slot,
  viewer: PlayerId | null,
): boolean {
  if (state.phase === 'over' || slot.got) return true;
  if (round.stage === 'steal') return true;
  if (viewer === null) return false;
  const team = teamOf(state, viewer);
  if (!team) return false;
  if (round.pair[owner] === viewer) return true;
  // A team whose turn is over sees what it left (the other side may still steal it).
  if (team === owner && round.order.indexOf(owner) < round.turnNo) return true;
  const turn = round.turn;
  if (round.stage !== 'turn' || !turn) return false;
  // A team's own cards, mid-turn, are its describer's alone (above).
  if (turn.team === owner) return false;
  // Its describer sees the other side's cards once its own three are got.
  return turn.describer === viewer && turn.stealOpen;
}

function roundView(state: CliffhangerState, round: Round, viewer: PlayerId | null): RoundView {
  const hand = viewer === null ? undefined : round.hands[viewer];
  const board: RoundView['board'] = {};
  for (const owner of ['a', 'b'] as const) {
    const slots = round.board[owner];
    if (!slots) continue;
    const describer = round.pair[owner];
    const onCall = state.seats[describer]?.onCall ?? false;
    board[owner] = slots.map((slot): SlotView => ({
      style: slot.style,
      plays: styleFor(slot.style, onCall, state.settings.actAlt),
      card: canSee(state, round, owner, slot, viewer) ? slot.card : null,
      got: slot.got,
    }));
  }
  const over = state.phase === 'over';
  const pick = round.pick && {
    by: round.pick.by,
    options: viewer === round.pick.by || over ? round.pick.options : null,
    deadline: round.pick.deadline,
  };
  return {
    number: round.number,
    stage: round.stage,
    pair: round.pair,
    styles: round.styles,
    stageEnds: round.stageEnds,
    after: round.after,
    suddenDeath: round.suddenDeath,
    pick,
    category: round.category,
    faceoff: round.faceoff,
    faceoffResult: round.faceoffResult,
    myHand: hand
      ? {
          offered: hand.offered,
          slots: hand.slots,
          deadline: hand.deadline,
          choose: hand.offered.length > 3,
        }
      : null,
    placing: Object.keys(round.hands),
    board,
    order: round.order,
    turnNo: round.turnNo,
    turn: round.turn,
    // A turn's misses can still be stolen: only their own team sees them before the round's end.
    results: round.results.map((r) =>
      over || round.stage === 'steal' || teamOf(state, viewer) === r.team
        ? r
        : { ...r, missed: [] },
    ),
    steal: round.steal && { team: round.steal.queue[0]!, deadline: round.steal.deadline },
    steals: round.steals,
  };
}

export function view(state: CliffhangerState, viewer: PlayerId | null): CliffhangerView {
  const seat = viewer === null ? undefined : state.seats[viewer];
  const playing = state.phase === 'playing';
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: seat && viewer !== null ? { id: viewer, ...seat } : null,
    myTeam: seat?.team ?? null,
    packs: state.packs,
    goal: state.goal,
    target: state.phase === 'lobby' ? goalFor(state.settings) : goalNow(state),
    genreCounts: state.phase === 'lobby' ? (state.genreCounts ?? null) : null,
    rotation: { a: state.rotation.a.order, b: state.rotation.b.order },
    nextPair: playing ? peekPair(state) : null,
    collections: state.collections,
    deckCount: state.deck.length + state.discard.length,
    round: state.phase !== 'lobby' && state.round ? roundView(state, state.round, viewer) : null,
    log: state.log,
    winner: state.winner,
    endReason: state.endReason,
  };
}
