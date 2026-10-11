import type { Pack } from '@vt/game-masquerade/logic';

const ids = (edition: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${edition}-${String(i + 1).padStart(2, '0')}`);

/**
 * The back-room pack: ids only. Location names, art, coaching and question ideas come from the
 * private manifest in asset storage, never from the repository.
 */
export const ORIGINALS_PACK: Pack = {
  editions: [
    { id: 'e1', label: 'Edition 1', locations: ids('e1', 30) },
    { id: 'e2', label: 'Edition 2', locations: ids('e2', 20) },
  ],
};

/** The location's number across both editions (e1-01 is 1, e2-01 is 31): its placeholder name. */
export function locationNumber(id: string): number | null {
  const m = /^e([12])-(\d{2})$/.exec(id);
  if (!m) return null;
  return (m[1] === '1' ? 0 : 30) + Number(m[2]);
}

export const placeholderName = (id: string) => {
  const n = locationNumber(id);
  return n === null ? id : `Location ${n}`;
};
