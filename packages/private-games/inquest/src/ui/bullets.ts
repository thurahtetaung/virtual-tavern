import type { Bullet } from '../logic/types.ts';

export interface BulletNo {
  /** The order number players see: placed bullets count 1, 2, 3…; a moved one keeps its own. */
  no: number;
  /** Erroneous Information moved this bullet here. */
  moved: boolean;
  /** This bullet was later moved to another item. */
  movedLater: boolean;
}

/**
 * Display numbers for the bullets, by `seq`. The rules log a move as a new entry, but on the table
 * it is the same bullet, so it keeps the number it had and the next placed bullet carries on from
 * the last placed one.
 */
export function bulletNumbers(bullets: readonly Bullet[]): Map<number, BulletNo> {
  const out = new Map<number, BulletNo>();
  let placed = 0;
  bullets.forEach((b, i) => {
    if (b.movedFrom === undefined) {
      out.set(b.seq, { no: ++placed, moved: false, movedLater: false });
      return;
    }
    const from = bullets
      .slice(0, i)
      .findLast((x) => x.slot === b.slot && x.tile === b.tile && x.item === b.movedFrom);
    const prev = from ? out.get(from.seq) : undefined;
    if (prev) prev.movedLater = true;
    out.set(b.seq, { no: prev?.no ?? ++placed, moved: true, movedLater: false });
  });
  return out;
}
