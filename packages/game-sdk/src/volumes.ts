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
