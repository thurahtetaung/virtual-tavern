import { statSync } from 'node:fs';
import { type ELDHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import { readOffsiteStatus } from '../backup-status.ts';
import type { LiveRoomInfo } from '../rooms/manager.ts';
import type { StatsEvent } from '../stats/types.ts';
import { Registry, type Sample } from './registry.ts';

/** What the metrics read when scraped; supplied by the app once its parts exist. */
export interface MetricsSources {
  version: string;
  gameIds: readonly string[];
  /** Rooms someone is connected to, never test rooms. */
  liveRooms: () => LiveRoomInfo[];
  /** Open sockets, never those in test rooms. */
  sockets: () => number;
  playtests: () => number;
  databasePath: string;
  offsiteStatusPath: string | null;
  now: () => number;
}

const GAME_SECONDS = [60, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200];
const BROADCAST_SECONDS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1];
const STATE_BYTES = [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144];
const FLUSH_SECONDS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1];

/** Refusal codes are short kebab-case words from the games; anything else is lumped together. */
const codeLabel = (code: string) => (/^[a-z0-9][a-z0-9-]{0,39}$/.test(code) ? code : 'other');

/**
 * The server's Prometheus metrics. Counting is in memory and cheap; the numbers only leave
 * through the separate metrics port (`serveMetrics`), when one is configured.
 */
export class TavernMetrics {
  readonly registry: Registry;
  private sources: MetricsSources | null = null;
  private readonly started;
  private readonly finished;
  private readonly actions;
  private readonly gameLength;
  private readonly refusals;
  private readonly broadcastTime;
  private readonly stateBytes;
  private readonly flushTime;
  private readonly flushFailures;
  private readonly responses;
  private readonly loopDelay: ELDHistogram;

  constructor(onError: (name: string, err: unknown) => void = () => {}) {
    const r = (this.registry = new Registry(onError));
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();

    r.gauge('vt_build_info', 'The running version (always 1).', () =>
      this.sources ? [[{ version: this.sources.version }, 1]] : [],
    );
    r.gauge('vt_live_rooms', 'Rooms with someone connected, by game (no test rooms).', () =>
      this.byGame((rooms) => rooms.length),
    );
    r.gauge('vt_live_rooms_playing', 'Live rooms with a game in play, by game.', () =>
      this.byGame((rooms) => rooms.filter((x) => x.phase === 'playing').length),
    );
    r.gauge('vt_live_players', 'Players connected to a live room, by game.', () =>
      this.byGame((rooms) =>
        rooms.reduce((n, x) => n + x.players.filter((p) => p.connected).length, 0),
      ),
    );
    r.gauge('vt_live_sockets', 'Open socket connections (no test rooms).', () =>
      this.sources ? [[{}, this.sources.sockets()]] : [],
    );
    r.gauge('vt_playtests_running', 'Admin playtests with someone in them.', () =>
      this.sources ? [[{}, this.sources.playtests()]] : [],
    );

    this.started = r.counter('vt_games_started_total', 'Games started, by game.');
    this.finished = r.counter(
      'vt_games_ended_total',
      'Games ended, by game and outcome (finished, or abandoned mid-game).',
    );
    this.actions = r.counter('vt_game_actions_total', 'Accepted player moves, by game.');
    this.gameLength = r.histogram(
      'vt_game_active_seconds',
      'Active play time of ended games, by game.',
      GAME_SECONDS,
    );
    this.refusals = r.counter('vt_game_refusals_total', 'Refused player moves, by game and code.');
    this.broadcastTime = r.histogram(
      'vt_room_state_broadcast_seconds',
      'Time to build and send one change to everyone in a room.',
      BROADCAST_SECONDS,
    );
    this.stateBytes = r.histogram(
      'vt_room_state_bytes',
      'Size of each room snapshot sent to a player.',
      STATE_BYTES,
    );
    this.flushTime = r.histogram(
      'vt_stats_flush_seconds',
      'Time to write one batch of stats events.',
      FLUSH_SECONDS,
    );
    this.flushFailures = r.counter('vt_stats_flush_failures_total', 'Stats batches that failed.');
    this.responses = r.counter('vt_http_responses_total', 'HTTP responses, by status class.');
    this.broadcastTime.touch();
    this.stateBytes.touch();
    this.flushTime.touch();
    this.flushFailures.inc({}, 0);
    for (const status of ['2xx', '3xx', '4xx', '5xx']) this.responses.inc({ status }, 0);

    r.gauge('vt_sqlite_file_bytes', 'Size of the database files.', () => {
      const path = this.sources?.databasePath;
      if (!path || path === ':memory:') return [];
      const out: Sample[] = [[{ file: 'main' }, statSync(path).size]];
      const wal = statSync(`${path}-wal`, { throwIfNoEntry: false });
      if (wal) out.push([{ file: 'wal' }, wal.size]);
      return out;
    });
    r.gauge(
      'vt_offsite_backup_recorded',
      'Whether the off-site backup job has left a result.',
      () => this.offsite((s) => [[{}, s.recorded ? 1 : 0]]),
    );
    r.gauge('vt_offsite_backup_ok', 'Whether the last off-site backup run succeeded.', () =>
      this.offsite((s) => (s.recorded ? [[{}, s.ok ? 1 : 0]] : [])),
    );
    r.gauge(
      'vt_offsite_backup_last_run_timestamp_seconds',
      'When the off-site backup job last ran (Unix seconds).',
      () => this.offsite((s) => (s.recorded ? [[{}, Date.parse(s.at) / 1000]] : [])),
    );
    r.gauge('vt_offsite_backup_bytes', 'Size of the last off-site backup.', () =>
      this.offsite((s) => (s.recorded && s.bytes !== undefined ? [[{}, s.bytes]] : [])),
    );
    r.gauge('vt_offsite_backup_total_bytes', 'Size of every off-site backup kept.', () =>
      this.offsite((s) => (s.recorded && s.totalBytes !== undefined ? [[{}, s.totalBytes]] : [])),
    );

    const start = Date.now() / 1000 - process.uptime();
    r.gauge('process_start_time_seconds', 'When the process started (Unix seconds).', () => [
      [{}, Math.round(start)],
    ]);
    r.collectedCounter('process_cpu_seconds_total', 'CPU time used (user and system).', () => {
      const { user, system } = process.cpuUsage();
      return [[{}, (user + system) / 1e6]];
    });
    r.gauge('process_resident_memory_bytes', 'Resident memory.', () => [
      [{}, process.memoryUsage.rss()],
    ]);
    r.gauge('nodejs_heap_bytes', 'V8 heap, used and total.', () => {
      const m = process.memoryUsage();
      return [
        [{ kind: 'used' }, m.heapUsed],
        [{ kind: 'total' }, m.heapTotal],
        [{ kind: 'external' }, m.external],
      ];
    });
    r.gauge(
      'nodejs_eventloop_delay_seconds',
      'Event-loop delay since the last scrape (p50, p99, max).',
      () => {
        const h = this.loopDelay;
        const out: Sample[] = h.count
          ? [
              [{ stat: 'p50' }, h.percentile(50) / 1e9],
              [{ stat: 'p99' }, h.percentile(99) / 1e9],
              [{ stat: 'max' }, h.max / 1e9],
            ]
          : [];
        h.reset();
        return out;
      },
    );
  }

  /** Called once the app's parts exist; until then the live gauges stay empty. */
  attach(sources: MetricsSources): void {
    this.sources = sources;
    for (const game of sources.gameIds) {
      this.started.inc({ game }, 0);
      this.actions.inc({ game }, 0);
      for (const outcome of ['finished', 'abandoned']) this.finished.inc({ game, outcome }, 0);
    }
  }

  /** A stats event (test rooms never reach here: the recorder drops them first). */
  event(e: StatsEvent): void {
    const game = e.gameId;
    if (!game) return;
    if (e.type === 'action') this.actions.inc({ game });
    else if (e.type === 'game.started') this.started.inc({ game });
    else if (e.type === 'game.ended') {
      const outcome = e.props.finished === true ? 'finished' : 'abandoned';
      this.finished.inc({ game, outcome });
      const ms = e.props.durationMs;
      if (typeof ms === 'number' && Number.isFinite(ms))
        this.gameLength.observe({ game }, ms / 1000);
    }
  }

  refusal(gameId: string, code: string): void {
    this.refusals.inc({ game: gameId, code: codeLabel(code) });
  }

  /** One room change sent out: how long it took and the size of each snapshot sent. */
  broadcast(seconds: number, sizes: readonly number[]): void {
    this.broadcastTime.observe({}, seconds);
    for (const bytes of sizes) this.stateBytes.observe({}, bytes);
  }

  flush(seconds: number, ok: boolean): void {
    this.flushTime.observe({}, seconds);
    if (!ok) this.flushFailures.inc();
  }

  response(statusCode: number): void {
    const cls = Math.floor(statusCode / 100);
    if (cls >= 1 && cls <= 5) this.responses.inc({ status: `${cls}xx` });
  }

  render(): string {
    return this.registry.render();
  }

  close(): void {
    this.loopDelay.disable();
  }

  private byGame(count: (rooms: LiveRoomInfo[]) => number): Sample[] {
    if (!this.sources) return [];
    const rooms = this.sources.liveRooms();
    return this.sources.gameIds.map((game) => [
      { game },
      count(rooms.filter((x) => x.gameId === game)),
    ]);
  }

  private offsite(pick: (s: ReturnType<typeof readOffsiteStatus>) => Sample[]): readonly Sample[] {
    if (!this.sources?.offsiteStatusPath) return [];
    return pick(readOffsiteStatus(this.sources.offsiteStatusPath, this.sources.now()));
  }
}
