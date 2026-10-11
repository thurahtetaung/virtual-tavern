import type { RecapTone, RoomRecap } from '@vt/protocol';
import type { Db } from '../db/index.ts';
import { FORGOTTEN } from '../stats/sqlite-store.ts';
import type { Freshness } from './select.ts';

/** How many earlier nights count for "the same award for the same player" (§1.6). */
const FRESH_NIGHTS = 3;

/**
 * A frozen night: the card in both tones. `open` is the public-only card of a public room whose
 * linked night reached the back room (what a locked viewer sees); without it, `full` is for all.
 */
export interface FrozenCard {
  v: 1;
  cards: Record<RecapTone, { full: RoomRecap; open?: RoomRecap }>;
}

export interface FrozenNight {
  roomId: string;
  nightKey: string;
  startedAt: number;
  endedAt: number;
  wrappedAt: number | null;
  games: number;
  tone: RecapTone;
  card: FrozenCard;
}

/** One award row to keep: who won what on a frozen night. */
export interface AwardRow {
  awardId: string;
  playerId: string;
  gameId: string | null;
  slot: 'moment' | 'mvp' | 'award';
  value: number | null;
}

/** A record candidate from a frozen card's numbers. */
export interface RecordRow {
  recordId: string;
  value: number;
  better: 'max' | 'min';
  gameId: string;
  emoji: string;
  text: string;
}

export interface StoredRecord {
  recordId: string;
  value: number;
  at: number;
  nightKey: string;
  gameId: string;
  emoji: string;
  text: string;
}

interface NightRow {
  room_id: string;
  night_key: string;
  started_at: number;
  ended_at: number;
  wrapped_at: number | null;
  games: number;
  tone: string;
  card: string;
}

const toNight = (r: NightRow): FrozenNight => ({
  roomId: r.room_id,
  nightKey: r.night_key,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  wrappedAt: r.wrapped_at,
  games: r.games,
  tone: r.tone === 'wholesome' ? 'wholesome' : 'cheeky',
  card: JSON.parse(r.card) as FrozenCard,
});

/**
 * The Hall of fame's tables: frozen night cards, their awards and the room's records. Kept apart
 * from the stats tables, so the admin stats reset leaves them alone; a swept room's rows go.
 */
export class RecapStore {
  private readonly sql: Db['$client'];

  constructor(db: Db) {
    this.sql = db.$client;
  }

  isFrozen(roomId: string, nightKey: string): boolean {
    return (
      this.sql
        .prepare('select 1 from recap_nights where room_id = ? and night_key = ?')
        .pluck()
        .get(roomId, nightKey) === 1
    );
  }

  night(roomId: string, nightKey: string): FrozenNight | null {
    const row = this.sql
      .prepare('select * from recap_nights where room_id = ? and night_key = ?')
      .get(roomId, nightKey) as NightRow | undefined;
    return row ? toNight(row) : null;
  }

  /** The room's frozen nights, newest first. */
  nights(roomId: string): FrozenNight[] {
    const rows = this.sql
      .prepare('select * from recap_nights where room_id = ? order by started_at desc')
      .all(roomId) as NightRow[];
    return rows.map(toNight);
  }

  /** The latest frozen nights across every room, newest first (for the admin). */
  recent(limit: number): FrozenNight[] {
    const rows = this.sql
      .prepare('select * from recap_nights order by started_at desc, night_key desc limit ?')
      .all(limit) as NightRow[];
    return rows.map(toNight);
  }

  /** The night by key, from whichever room froze it (a linked night is frozen in each room). */
  anyRoom(nightKey: string, roomId?: string): FrozenNight | null {
    const row = this.sql
      .prepare(
        `select * from recap_nights where night_key = ? and (? is null or room_id = ?)
         order by started_at limit 1`,
      )
      .get(nightKey, roomId ?? null, roomId ?? null) as NightRow | undefined;
    return row ? toNight(row) : null;
  }

  /**
   * Freezes a night: its card, its awards and any records it set. A night already frozen stays
   * exactly as it was (returns false). Records are compared with what the room had before.
   */
  freeze(night: FrozenNight, awards: readonly AwardRow[], records: readonly RecordRow[]): boolean {
    return this.sql.transaction(() => {
      const inserted = this.sql
        .prepare(
          `insert or ignore into recap_nights
           (room_id, night_key, started_at, ended_at, wrapped_at, games, tone, card)
           values (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          night.roomId,
          night.nightKey,
          night.startedAt,
          night.endedAt,
          night.wrappedAt,
          night.games,
          night.tone,
          JSON.stringify(night.card),
        ).changes;
      if (!inserted) return false;
      const award = this.sql.prepare(
        `insert or ignore into recap_awards
         (room_id, night_key, award_id, player_id, game_id, slot, value, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of awards)
        award.run(
          night.roomId,
          night.nightKey,
          a.awardId,
          a.playerId,
          a.gameId,
          a.slot,
          a.value,
          night.endedAt,
        );
      const stored = this.records(night.roomId);
      const upsert = this.sql.prepare(
        `insert into recap_records
         (room_id, record_id, player_id, value, at, night_key, game_id, emoji, text)
         values (?, ?, null, ?, ?, ?, ?, ?, ?)
         on conflict (room_id, record_id) do update set
           value = excluded.value, at = excluded.at, night_key = excluded.night_key,
           game_id = excluded.game_id, emoji = excluded.emoji, text = excluded.text`,
      );
      for (const r of records) {
        const before = stored.get(r.recordId)?.value;
        const better =
          before === undefined || (r.better === 'max' ? r.value > before : r.value < before);
        if (better)
          upsert.run(
            night.roomId,
            r.recordId,
            r.value,
            night.endedAt,
            night.nightKey,
            r.gameId,
            r.emoji,
            r.text,
          );
      }
      return true;
    })();
  }

  /** The room's records by id. */
  records(roomId: string): Map<string, StoredRecord> {
    const rows = this.sql
      .prepare(
        `select record_id, value, at, night_key, game_id, emoji, text from recap_records
         where room_id = ? order by at`,
      )
      .all(roomId) as {
      record_id: string;
      value: number;
      at: number;
      night_key: string;
      game_id: string;
      emoji: string;
      text: string;
    }[];
    return new Map(
      rows.map((r) => [
        r.record_id,
        {
          recordId: r.record_id,
          value: r.value,
          at: r.at,
          nightKey: r.night_key,
          gameId: r.game_id,
          emoji: r.emoji,
          text: r.text,
        },
      ]),
    );
  }

  /** Every award row of the room's frozen nights. */
  awards(roomId: string): (AwardRow & { nightKey: string; createdAt: number })[] {
    const rows = this.sql
      .prepare(
        `select night_key, award_id, player_id, game_id, slot, value, created_at
         from recap_awards where room_id = ? order by created_at`,
      )
      .all(roomId) as {
      night_key: string;
      award_id: string;
      player_id: string;
      game_id: string | null;
      slot: string;
      value: number | null;
      created_at: number;
    }[];
    return rows.map((r) => ({
      nightKey: r.night_key,
      awardId: r.award_id,
      playerId: r.player_id,
      gameId: r.game_id,
      slot: r.slot === 'moment' || r.slot === 'mvp' ? r.slot : 'award',
      value: r.value,
      createdAt: r.created_at,
    }));
  }

  /** What the room's nights before `nightKey` awarded, for a fresher card. */
  history(roomId: string, nightKey: string): Freshness {
    const earlier = this.sql
      .prepare(
        `select night_key from recap_nights where room_id = ? and night_key != ?
         and started_at <= coalesce(
           (select started_at from recap_nights where room_id = ? and night_key = ?), 9e15)
         order by started_at desc limit ${FRESH_NIGHTS}`,
      )
      .pluck()
      .all(roomId, nightKey, roomId, nightKey) as string[];
    if (!earlier.length) return { recent: new Set() };
    const marks = earlier.map(() => '?').join(',');
    const rows = this.sql
      .prepare(
        `select night_key, award_id, player_id, slot from recap_awards
         where room_id = ? and night_key in (${marks})`,
      )
      .all(roomId, ...earlier) as {
      night_key: string;
      award_id: string;
      player_id: string;
      slot: string;
    }[];
    const last = rows.filter((r) => r.night_key === earlier[0]);
    const headline =
      last.find((r) => r.slot === 'moment')?.award_id ??
      last.find((r) => r.slot === 'award')?.award_id;
    return {
      ...(headline && { headline }),
      recent: new Set(
        rows
          .filter((r) => r.player_id && r.slot !== 'moment')
          .map((r) => `${r.award_id}|${r.player_id}`),
      ),
    };
  }

  /** A swept room's recaps go with it. */
  forgetRoom(roomId: string): void {
    this.sql.transaction(() => {
      for (const table of ['recap_nights', 'recap_awards', 'recap_records'])
        this.sql.prepare(`delete from ${table} where room_id = ?`).run(roomId);
    })();
  }

  /**
   * "Forget me": the player's awards go, and frozen cards name them no more (their id becomes
   * the forgotten placeholder and their name "Someone"). Returns how many rows changed.
   */
  forgetPlayer(playerId: string): number {
    return this.sql.transaction(() => {
      let changed = this.sql
        .prepare('delete from recap_awards where player_id = ?')
        .run(playerId).changes;
      const rows = this.sql
        .prepare('select room_id, night_key, card from recap_nights where instr(card, ?) > 0')
        .all(playerId) as { room_id: string; night_key: string; card: string }[];
      const update = this.sql.prepare(
        'update recap_nights set card = ? where room_id = ? and night_key = ?',
      );
      for (const r of rows) {
        const card = JSON.parse(r.card.split(playerId).join(FORGOTTEN)) as FrozenCard;
        for (const tone of Object.values(card.cards))
          for (const recap of [tone.full, tone.open])
            for (const p of [...(recap?.players ?? []), ...(recap?.audience ?? [])])
              if (p.id === FORGOTTEN) p.name = 'Someone';
        changed += update.run(JSON.stringify(card), r.room_id, r.night_key).changes;
      }
      return changed;
    })();
  }
}
