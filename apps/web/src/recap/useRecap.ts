import type { Superlative } from '@vt/game-sdk';
import type { AckWith, HallOfFame, RoomRecap, RoomSnapshot } from '@vt/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientGame } from '../games/registry.ts';
import type { RecapPush } from '../lib/room-connection.ts';
import type { useRoom } from '../lib/useRoom.ts';
import { type Labeler, resolveText } from './resolve.ts';

type Call = ReturnType<typeof useRoom>['call'];

/** How long the page waits for the server's first pushed recap before asking (an older server). */
const PUSH_WAIT_MS = 1_500;

/**
 * The room's night recap: pushed by the server with the state it belongs to (when the room joins,
 * whenever a game starts or ends, the tone changes and when the host wraps up), and asked for
 * only if no push came; never while recaps are switched off. Also resolves the finished game's
 * strip for the end screen.
 */
export function useRecap({
  call,
  snapshot,
  game,
  wraps,
  pushed,
}: {
  call: Call;
  snapshot: RoomSnapshot | null;
  game: ClientGame;
  wraps: number;
  /** The server's last push (stamped with `performance.now()` when it came). */
  pushed: (RecapPush & { at: number }) | null;
}) {
  /** The recap, the game state it was fetched for (`phase:gameNo`) and when it came. */
  const [asked, setFetched] = useState<{ recap: RoomRecap | null; for: string; at: number }>({
    recap: null,
    for: '',
    at: 0,
  });
  // Whichever came last: the server's push, or an answer to asking.
  const fetched = pushed && pushed.at > asked.at ? pushed : asked;
  const recap = fetched.recap;
  const [labels, setLabels] = useState<Labeler | null>(null);
  const meta = snapshot?.meta;
  const enabled = meta?.recap ?? false;

  // Private names come from the game's manifest, loaded once per room.
  useEffect(() => {
    let live = true;
    if (game.labels) {
      void game
        .labels()
        .then((l) => {
          if (live) setLabels(() => l);
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [game]);

  const current = `${snapshot?.meta?.phase}:${snapshot?.meta?.gameNo}`;
  const request = useCallback(
    async (opened: boolean) =>
      (await call('room:recap', {
        scope: 'night',
        opened,
      })) as unknown as AckWith<RoomRecap | null>,
    [call],
  );
  const apply = useCallback((res: AckWith<RoomRecap | null>, forState?: string) => {
    const at = performance.now();
    if (res.ok) setFetched((f) => ({ recap: res.data, for: forState ?? f.for, at }));
    else if (res.error.code === 'recap-off') setFetched({ recap: null, for: '', at });
  }, []);
  const fetchRecap = useCallback(
    async (opened = false) => apply(await request(opened)),
    [request, apply],
  );

  const hasPush = useRef(false);
  useEffect(() => {
    hasPush.current = pushed !== null;
  }, [pushed]);
  // When a game ends or starts, the tone changes or the host wraps up, a push is due. A server
  // that pushes once pushes every time (from the join on), so only a page that has had none asks.
  const joined = snapshot !== null;
  const phase = meta?.phase;
  const gameNo = meta?.gameNo;
  const tone = meta?.tone;
  useEffect(() => {
    if (!joined || !enabled) return;
    let live = true;
    const forState = `${phase}:${gameNo}`;
    const timer = setTimeout(() => {
      if (hasPush.current) return;
      void request(false).then((res) => {
        if (live) apply(res, forState);
      });
    }, PUSH_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [joined, enabled, phase, gameNo, tone, wraps, request, apply]);
  // Switched off (or not in yet): nothing shows, whatever was fetched before.
  const shown = joined && enabled ? recap : null;

  // Names as the room knows them now (a rename shows at once), else as the recap remembers them.
  const players = snapshot?.players;
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of shown?.players ?? []) out.set(p.id, p.name);
    for (const p of shown?.audience ?? []) out.set(p.id, p.name);
    for (const p of players ?? []) out.set(p.id, p.name);
    return out;
  }, [shown, players]);

  // The end screen's strip: only once the room's latest game is over, never mid-game.
  const superlatives = useMemo((): Superlative[] | undefined => {
    // Fetched for this very end screen, so a strip never shows the game before.
    if (phase !== 'over' || !shown || shown.running || fetched.for !== current) return undefined;
    const last = shown.games.findLast((g) => !g.elsewhere);
    if (!last?.lines.length) return undefined;
    return last.lines.map((l) => ({
      emoji: l.emoji,
      title: resolveText(l.title, names, labels),
      text: resolveText(l.text, names, labels),
    }));
  }, [phase, shown, names, labels, fetched.for, current]);

  // Count one view per opening of the sheet.
  const viewed = useRef(false);
  const opened = useCallback(() => {
    if (viewed.current) return;
    viewed.current = true;
    void fetchRecap(true);
  }, [fetchRecap]);
  const closed = useCallback(() => {
    viewed.current = false;
  }, []);

  // The Hall of fame and earlier frozen nights, fetched when asked for.
  const hall = useCallback(async () => {
    const res = (await call('room:recap', { scope: 'hall' })) as unknown as AckWith<HallOfFame>;
    return res.ok ? res.data : null;
  }, [call]);
  const pastNight = useCallback(
    async (nightKey: string) => {
      const res = (await call('room:recap', {
        scope: 'night',
        nightKey,
      })) as unknown as AckWith<RoomRecap>;
      return res.ok ? res.data : null;
    },
    [call],
  );

  return {
    enabled,
    recap: shown,
    hall,
    pastNight,
    names,
    labels,
    superlatives,
    opened,
    closed,
    refresh: fetchRecap,
  };
}
