import { type BotCtx } from './bots.ts';
import { type Rng, createRng } from './rng.ts';
import {
  type ContentProvider,
  type GameDefinition,
  type PlayerId,
  type PlayerInfo,
  isGameError,
} from './types.ts';

/** No word lists or questions: what a test table gets unless it brings its own. */
const NO_CONTENT: ContentProvider = { wordLists: () => [], words: () => [] };

export interface BotHarnessOptions<View, Action> {
  seed?: number;
  /** Moves (and deadlines) after which the harness gives up. Default 2,000. */
  maxSteps?: number;
  content?: ContentProvider;
  /** Common answers per open question, for `BotCtx.hints`. */
  hints?: (questionId: string) => string[];
  /** The clock at the start (epoch ms). */
  start?: number;
  /** How far the clock moves with each move. Default 1 s. */
  stepMs?: number;
  /**
   * The human host's own buttons (start, next round, play again…), from the host's view; the
   * host is the first seat. Called only when the host's bot has nothing to do.
   */
  host?: (view: View, me: PlayerId) => Action | null;
  /** Seats a test plays itself (a role bots can't play), instead of their bots. */
  humans?: {
    ids: readonly PlayerId[];
    play: (view: View, me: PlayerId, rng: Rng) => Action | null;
  };
}

export interface BotHarnessResult<State> {
  state: State;
  /** Moves made, deadlines included. */
  steps: number;
  /** Accepted moves. */
  moves: number;
  /** Deadlines that fired because nobody had anything to do. */
  deadlines: number;
  /** Moves the game refused (a bot that acts out of turn shows up here). */
  refused: { by: PlayerId; action: unknown; code: string }[];
  /** Whether the game reached `phase: 'over'`. */
  over: boolean;
}

const phaseOf = (state: unknown) => (state as { phase?: unknown } | null)?.phase;

/**
 * Test utility: plays a game with a bot in every seat. Each step, one seat (in turn) gets its own
 * `view()` only, and the move its bot returns goes through the action schema and `reduce` like
 * any player's. When nobody has anything to do, the next deadline fires (`onDeadline`), as it
 * would for idle humans. Seeded and on a fake clock, so a run is the same every time.
 */
export function playWithBots<State, Action, View>(
  def: GameDefinition<State, Action, View>,
  seats: readonly PlayerInfo[],
  opts: BotHarnessOptions<View, Action> = {},
): BotHarnessResult<State> {
  if (!def.bot) throw new Error(`${def.id} has no bot`);
  const bot = def.bot.bind(def);
  const rng = createRng(opts.seed ?? 1);
  const content = opts.content ?? NO_CONTENT;
  const stepMs = opts.stepMs ?? 1000;
  const maxSteps = opts.maxSteps ?? 2000;
  const humans = new Set(opts.humans?.ids ?? []);
  const host = seats[0]!.id;
  let now = opts.start ?? 1_700_000_000_000;
  let state = def.create({ now, rng, content }, seats);
  for (const p of seats) state = def.playerJoined(state, p);
  const result: BotHarnessResult<State> = {
    state,
    steps: 0,
    moves: 0,
    deadlines: 0,
    refused: [],
    over: false,
  };

  const ctxFor = (me: PlayerId): BotCtx => ({
    me,
    now,
    rng: createRng(rng.int(2 ** 32)),
    words: (ids) => content.words(ids),
    hints: (id) => opts.hints?.(id) ?? [],
    contentPacks: (kind) => content.contentPacks?.(kind) ?? [],
  });
  const moveOf = (me: PlayerId): Action | null => {
    const view = def.view(state, me);
    if (humans.has(me)) return opts.humans!.play(view, me, rng);
    const move = bot(view, ctxFor(me));
    if (move !== null || me !== host) return move;
    return opts.host?.(view, me) ?? null;
  };

  for (let step = 0; step < maxSteps; step++) {
    if (phaseOf(state) === 'over') break;
    result.steps += 1;
    let acted = false;
    for (let i = 0; i < seats.length && !acted; i++) {
      const me = seats[(step + i) % seats.length]!.id;
      const move = moveOf(me);
      if (move === null) continue;
      const parsed = def.actionSchema.safeParse(move);
      if (!parsed.success) {
        result.refused.push({ by: me, action: move, code: 'bad-action' });
        continue;
      }
      const next = def.reduce(state, parsed.data, {
        now,
        rng,
        content,
        by: me,
        isHost: me === host,
      });
      if (isGameError(next)) {
        result.refused.push({ by: me, action: move, code: next.code });
        continue;
      }
      state = next;
      result.moves += 1;
      acted = true;
      now += stepMs;
    }
    if (acted) continue;
    const due = def.nextDeadline?.(state) ?? null;
    if (due === null || !def.onDeadline) break;
    now = Math.max(now + stepMs, due);
    state = def.onDeadline(state, now);
    result.deadlines += 1;
  }
  result.state = state;
  result.over = phaseOf(state) === 'over';
  return result;
}
