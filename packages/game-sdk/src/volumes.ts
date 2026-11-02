import { z } from 'zod';

// The table screen's volumes, kept in a game's settings: the table has no input, so the host's
// sliders set them (any time, mid-game too). Each is 0 to 1; one left out plays at full volume.

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

// The host's volumes for everyone: when the host moves one of their own sliders, the room keeps
// the new level with a version, and every device takes it into its own volumes once (a player
// may change theirs again after; the host's next change of that slider wins again). A room saved
// without it has nothing to apply.

export const VOLUME_NAMES = ['master', 'music', 'effects', 'voice'] as const;
export type VolumeName = (typeof VOLUME_NAMES)[number];

/** One slider the host set: its level and a version that grows with every change. */
export interface HostVolume {
  level: number;
  v: number;
}

export type HostVolumes = Partial<Record<VolumeName, HostVolume>>;

/** The `host-volume` action every game with sound accepts from the host, any time. */
export const hostVolumeAction = z.object({
  type: z.literal('host-volume'),
  which: z.enum(VOLUME_NAMES),
  level,
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
