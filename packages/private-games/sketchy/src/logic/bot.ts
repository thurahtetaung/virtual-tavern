import { type BotCtx, type Rng, cannedText, encodeDrawing, pickOne, wordKey } from '@vt/game-sdk';
import { PLAYER_SLOT, promptsFrom } from './content.ts';
import { MAX_LIE_LENGTH, type OptionView, type SketchyAction, type SketchyView } from './types.ts';

/**
 * A bot's drawing: a few wobbly lines built from its own random numbers (never an image), so a
 * playtest has something to look at.
 */
export function scribble(rng: Rng) {
  const strokes = Array.from({ length: 3 + rng.int(4) }, () => {
    let x = 150 + rng.int(500);
    let y = 150 + rng.int(700);
    let angle = rng.next() * Math.PI * 2;
    const points: number[] = [x, y];
    for (let i = 0; i < 8 + rng.int(14); i++) {
      angle += (rng.next() - 0.5) * 1.4;
      x = Math.max(20, Math.min(780, x + Math.cos(angle) * 40));
      y = Math.max(20, Math.min(980, y + Math.sin(angle) * 40));
      points.push(x, y);
    }
    return { c: rng.int(4), w: rng.int(3), points };
  });
  return encodeDrawing(strokes);
}

/** Casual-looking titles (lowercase letters and spaces only) weigh double when the bot picks. */
const casual = (o: OptionView) => (/^[a-z ]+$/.test(o.text) ? 2 : 1);

function weightedPick(rng: Rng, options: readonly OptionView[]): OptionView | undefined {
  const total = options.reduce((n, o) => n + casual(o), 0);
  let at = rng.next() * total;
  for (const o of options) {
    at -= casual(o);
    if (at < 0) return o;
  }
  return options.at(-1);
}

/**
 * A bot's fake title: a prompt from the room's chosen packs that this game hasn't shown it (its own
 * prompt and the real titles so far), else a canned line. The real title stays hidden from it, so
 * a pick can match it; the engine refuses that and the bot tries again (`botInfo.retry`).
 */
export function botLie(view: SketchyView, ctx: BotCtx): string {
  const g = view.game;
  const seen = new Set(
    [g?.myPrompt, ...(g?.history ?? []).map((h) => h.prompt)].flatMap((p) =>
      p ? [wordKey(p)] : [],
    ),
  );
  const pool = ctx.contentPacks
    ? promptsFrom(ctx, view.settings.packIds, view.settings.adult).filter(
        (p) =>
          p.text.length <= MAX_LIE_LENGTH &&
          !p.text.includes(PLAYER_SLOT) &&
          !seen.has(wordKey(p.text)),
      )
    : [];
  return pickOne(ctx.rng, pool)?.text ?? cannedText(ctx.rng, 'lie').slice(0, MAX_LIE_LENGTH);
}

/**
 * A playtest bot, from its own seat's view only: takes a seat, sends a scribble, writes a fake
 * title from an unused prompt (`botLie`), picks a title (never its own), and likes one other title
 * once it has picked. It never sees the real title.
 */
export function sketchyBot(view: SketchyView, ctx: BotCtx): SketchyAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  if (g.stage === 'draw') {
    return g.myPrompt !== null && !g.drawn.includes(me)
      ? { type: 'draw', drawing: scribble(rng) }
      : null;
  }
  const t = g.turn;
  if (!t || t.mine || !t.writing) return null;
  if (g.stage === 'write') {
    return t.myLie === null ? { type: 'lie', text: botLie(view, ctx) } : null;
  }
  if (g.stage === 'vote' && t.myVote === null) {
    const option = weightedPick(
      rng,
      t.options.filter((o) => !o.mine),
    );
    return option ? { type: 'vote', option: option.index } : null;
  }
  if (g.stage === 'vote' && t.canLike && t.myLikes.length === 0) {
    const option = pickOne(
      rng,
      t.options.filter((o) => !o.mine && o.index !== t.myVote),
    );
    return option ? { type: 'like', option: option.index, on: true } : null;
  }
  return null;
}
