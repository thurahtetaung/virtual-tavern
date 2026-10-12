import { type RecapEvent, type Tone, gameEvents } from '@vt/game-sdk';
import type { RecapLine } from '@vt/protocol';
import { runEngine } from '../recap/engine.ts';
import { participants, stageKey } from '../stats/recorder.ts';
import type { GameRegistry } from '../games/registry.ts';
import type { RoomLogger, RoomObservation } from './manager.ts';

interface Running {
  startedAt: number;
  gameNo: number;
  players: string[];
  events: RecapEvent[];
  /** When play last moved on, for how long each move took (as the stats recorder measures it). */
  anchor: number;
}

const phaseOf = (state: unknown) => {
  const p = (state as { phase?: unknown } | null)?.phase;
  return typeof p === 'string' ? p : null;
};

/**
 * The awards a playtest's finished game would have earned, worked out in memory from its own
 * insight events and never saved: nothing reaches `stats_events`, the recap tables or the hall of
 * fame. Fed only the observations of playtest rooms; a new game or the room's end drops it.
 */
export class PlaytestPreview {
  private readonly running = new Map<string, Running>();
  private readonly finished = new Map<string, RecapLine[]>();
  private readonly deps: {
    games: GameRegistry;
    tone: (roomId: string) => Tone;
    /** Hands the finished game's strip to the room's seats. */
    send: (roomId: string, lines: RecapLine[]) => void;
    logger: RoomLogger;
  };

  constructor(deps: PlaytestPreview['deps']) {
    this.deps = deps;
  }

  /** The strip of the room's latest finished game, while it is on its end screen. */
  latest(roomId: string): RecapLine[] | null {
    return this.finished.get(roomId) ?? null;
  }

  observe(o: RoomObservation): void {
    try {
      this.handle(o);
    } catch (err) {
      this.deps.logger.error({ roomId: o.roomId, err }, 'playtest award preview failed');
    }
  }

  private handle(o: RoomObservation) {
    const { roomId } = o;
    if (o.kind === 'room.swept') {
      this.running.delete(roomId);
      this.finished.delete(roomId);
      return;
    }
    const { before, after } = o;
    if (!before || !after || before.state === after.state) return;
    const was = phaseOf(before.state);
    const is = phaseOf(after.state);
    if (is === 'playing' && was !== 'playing') {
      const gamesPlayed = (after.state as { gamesPlayed?: unknown }).gamesPlayed;
      this.finished.delete(roomId);
      this.running.set(roomId, {
        startedAt: o.now,
        gameNo: typeof gamesPlayed === 'number' ? gamesPlayed : 1,
        players: participants(after),
        events: [],
        anchor: o.now,
      });
    }
    const game = this.running.get(roomId);
    if (!game) return;
    if ((o.kind === 'action' || o.kind === 'deadline') && o.game?.insights) {
      const insights = o.game.insights(
        before.state,
        after.state,
        o.kind === 'action' ? o.action : null,
        o.kind === 'action' ? o.by : null,
      );
      for (const ev of Array.isArray(insights) ? insights : []) {
        const props: Record<string, unknown> = { ...ev.props };
        if (ev.words?.length) props.words = ev.words;
        if (ev.winners?.length) props.winners = ev.winners;
        if (o.kind === 'action' && ev.playerId && ev.playerId === o.by)
          props.actMs = o.now - game.anchor;
        game.events.push({ type: ev.type, ts: o.now, playerId: ev.playerId ?? null, props });
      }
      if (insights.length) game.anchor = o.now;
    }
    if (stageKey(before.state) !== stageKey(after.state)) game.anchor = o.now;
    if (was === 'playing' && is !== 'playing') {
      this.running.delete(roomId);
      if (is === 'over') this.finish(roomId, o, game);
    }
  }

  private finish(roomId: string, o: RoomObservation, game: Running) {
    const winners = new Set<string>();
    for (const e of game.events) {
      const w = e.props.winners;
      if (Array.isArray(w)) for (const id of w) if (typeof id === 'string') winners.add(id);
    }
    const events = gameEvents({
      gameId: o.gameId,
      gameNo: game.gameNo,
      startedAt: game.startedAt,
      endedAt: o.now,
      players: game.players,
      winners: [...winners],
      finished: true,
      events: game.events,
    });
    const out = runEngine({
      roomId,
      nightKey: 'playtest',
      lastEventId: String(o.now),
      games: [events],
      modules: (id) => this.deps.games.get(id)?.awards,
      tone: this.deps.tone(roomId),
      records: new Map(),
      tzOffsetMin: null,
      exclude: new Set(),
    });
    const lines = out.games[0]?.lines ?? [];
    this.finished.set(roomId, lines);
    this.deps.send(roomId, lines);
  }
}
