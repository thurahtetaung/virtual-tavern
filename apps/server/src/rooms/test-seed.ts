import { createHash } from 'node:crypto';

/** The header a test browser sends with the room it creates, to fix that room's seed. */
export const TEST_SEED_HEADER = 'x-vt-test-seed';

/**
 * Test builds only (`VT_TEST_SEED`): every rng draw for a room comes from the room's seed and
 * what the draw is for (`game:<version>`, `color:<version>`, `bot:<id>:<version>`), never from
 * the order rooms were opened in, so the same seed and the same moves replay the same game.
 * A room's seed is the one its creator asked for, else the base seed with the room id. Asked-for
 * seeds live in memory only: after a restart such a room falls back to the base seed.
 */
export class TestSeeds {
  private readonly rooms = new Map<string, string>();
  private readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  assign(roomId: string, seed: string): void {
    this.rooms.set(roomId, seed);
  }

  draw(roomId: string, key: string): number {
    const seed = this.rooms.get(roomId) ?? `${this.base}:${roomId}`;
    return createHash('sha256').update(`${seed}|${key}`).digest().readUInt32LE(0);
  }
}
