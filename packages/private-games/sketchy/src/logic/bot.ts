import { type BotCtx, type Rng, cannedText, encodeDrawing, pickOne } from '@vt/game-sdk';
import type { OptionView, SketchyAction, SketchyView } from './types.ts';

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
 * A playtest bot, from its own seat's view only: takes a seat, sends a scribble, writes "Lie for
 * me" when the game offers it (or a canned title), picks a title (never its own), and likes one
 * other title once it has picked. It never sees the real title.
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
    if (t.myLie !== null) return null;
    if (t.myFakes?.length) {
      const choice = rng.int(t.myFakes.length);
      return { type: 'lie-for-me', choice, fake: t.myFakes[choice] };
    }
    if (t.myFakes) return { type: 'lie', text: cannedText(rng, 'lie').slice(0, 45) };
    return t.canLieForMe
      ? { type: 'lie-for-me' }
      : { type: 'lie', text: cannedText(rng, 'lie').slice(0, 45) };
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
