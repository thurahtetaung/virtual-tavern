import { z } from 'zod';

// The table screen's volumes, kept in a game's settings: the table has no input, so the host's
// sliders set them (any time, mid-game too). Each is 0 to 1; one left out plays at the default (50 %).

const level = z.number().min(0).max(1);

export const tableVolumesSchema = z
  .object({ master: level, music: level, effects: level, voice: level })
  .partial();

export type TableVolumes = z.infer<typeof tableVolumesSchema>;

/** The `table-volume` action every game with a table screen's sound accepts from the host. */
export const tableVolumeAction = z.object({
  type: z.literal('table-volume'),
  volumes: tableVolumesSchema,
});

// The host's volumes for everyone: the host chooses whether their sliders set only their own
// volume ("Just me", the default and what a room saved without it reads as) or everyone's. With
// "Everyone", when the host moves one of their own sliders the room keeps the new level with a
// version, and every device takes it into its own volumes once (a player may change theirs again
// after; the host's next change of that slider wins again).

export const VOLUME_NAMES = ['master', 'music', 'effects', 'voice'] as const;
export type VolumeName = (typeof VOLUME_NAMES)[number];

/** Whose volume the host's sliders set: only the host's own, or everyone's. */
export const HOST_VOLUME_MODES = ['me', 'all'] as const;
export type HostVolumeMode = (typeof HOST_VOLUME_MODES)[number];

/** One slider the host set: its level and a version that grows with every change. */
export interface HostVolume {
  level: number;
  v: number;
}

export type HostVolumes = Partial<Record<VolumeName, HostVolume>> & {
  /** Whose volume the host's sliders set; missing reads as "Just me". */
  mode?: HostVolumeMode;
};

/** Whose volume the host's sliders set in a room (a room saved without it: "Just me"). */
export const hostVolumeMode = (stored: HostVolumes | null | undefined): HostVolumeMode =>
  stored?.mode === 'all' ? 'all' : 'me';

/**
 * The `host-volume` action every game with sound accepts from the host, any time: a slider's new
 * level (`which` and `level`, kept only with "Everyone"), or the choice of whose volume the host's
 * sliders set (`mode`).
 */
export const hostVolumeAction = z.object({
  type: z.literal('host-volume'),
  which: z.enum(VOLUME_NAMES).optional(),
  level: level.optional(),
  mode: z.enum(HOST_VOLUME_MODES).optional(),
});

export type HostVolumeAction = z.infer<typeof hostVolumeAction>;

/**
 * The room's host volumes after the host set `which` to `level` at `now` (the server clock): the
 * version is `now`, or one past the last when the clock hasn't moved, so it never repeats.
 */
export function withHostVolume(
  stored: HostVolumes | undefined,
  which: VolumeName,
  level: number,
  now: number,
): HostVolumes {
  const last = stored?.[which]?.v ?? 0;
  const v = Math.max(last + 1, Math.floor(now));
  return { ...stored, [which]: { level: Math.max(0, Math.min(1, level)), v } };
}

/** The table screen's volumes after the host set `which`: the table follows the host too. */
export function tableWithHostVolume(
  table: TableVolumes | undefined,
  which: VolumeName,
  level: number,
): TableVolumes {
  return { ...table, [which]: Math.max(0, Math.min(1, level)) };
}

/**
 * What the room keeps after the host's `host-volume` action (the game checks it is the host's):
 * a new `mode` keeps only the mode, so switching never pushes a level by itself (only the host's
 * next slider move does); a slider's level is kept, and sets the table screen's too, only with
 * "Everyone" (with "Just me" it is the host's own and the room keeps nothing). Null when the
 * action carries neither.
 */
export function hostVolumeChange(
  stored: { hostVolumes?: HostVolumes; tableVolumes?: TableVolumes },
  action: HostVolumeAction,
  now: number,
): { hostVolumes: HostVolumes; tableVolumes: TableVolumes } | null {
  const table = stored.tableVolumes ?? {};
  if (action.mode) return { hostVolumes: { mode: action.mode }, tableVolumes: table };
  if (!action.which || action.level === undefined) return null;
  if (hostVolumeMode(stored.hostVolumes) !== 'all')
    return { hostVolumes: stored.hostVolumes ?? {}, tableVolumes: table };
  return {
    hostVolumes: withHostVolume(stored.hostVolumes, action.which, action.level, now),
    tableVolumes: tableWithHostVolume(stored.tableVolumes, action.which, action.level),
  };
}
