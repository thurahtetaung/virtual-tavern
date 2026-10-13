import type { Superlative } from '@vt/game-sdk';
import type { AckWith, HallOfFame, RoomRecap, RoomSnapshot } from '@vt/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientGame } from '../games/registry.ts';
import type { useRoom } from '../lib/useRoom.ts';
import { type Labeler, resolveText } from './resolve.ts';

type Call = ReturnType<typeof useRoom>['call'];

/**
 * The room's night recap: fetched when the room joins, whenever a game ends (or the tone changes)
 * and when the host wraps up; never while recaps are switched off. Also resolves the finished
 * game's strip for the end screen.
 */
export function useRecap({
  call,
  snapshot,
  game,
  wraps,
}: {
  call: Call;
  snapshot: RoomSnapshot | null;
  game: ClientGame;
  wraps: number;
}) {
  /** The recap, and the game state it was fetched for (`phase:gameNo`). */
  const [fetched, setFetched] = useState<{ recap: RoomRecap | null; for: string }>({
    recap: null,
    for: '',
  });
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
    if (res.ok) setFetched((f) => ({ recap: res.data, for: forState ?? f.for }));
    else if (res.error.code === 'recap-off') setFetched({ recap: null, for: '' });
  }, []);
  const fetchRecap = useCallback(
    async (opened = false) => apply(await request(opened)),
    [request, apply],
  );

  // Refetch when a game ends or starts, the tone changes or the host wraps up.
  const joined = snapshot !== null;
  const phase = meta?.phase;
  const gameNo = meta?.gameNo;
  const tone = meta?.tone;
  useEffect(() => {
    if (!joined || !enabled) return;
    let live = true;
    const forState = `${phase}:${gameNo}`;
    void request(false).then((res) => {
      if (live) apply(res, forState);
    });
    return () => {
      live = false;
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
