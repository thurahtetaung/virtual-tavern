import { LOCATION_IDS, locationById } from '../content/locations.ts';
import { defineMasquerade } from './game.ts';
import { guide } from './guide.ts';

export {
  type MasqueradeConfig,
  defineMasquerade,
  locationsFor,
  namedBy,
  scoreRound,
  seated,
  spyCountFor,
  tally,
} from './game.ts';
export { guide, makeGuide } from './guide.ts';
export { insightsFor } from './insights.ts';
export { masqueradeAwards } from './awards.ts';
export * from './types.ts';

/** The public game, with our own pack of places. */
export const masquerade = defineMasquerade({
  id: 'masquerade',
  name: 'Masquerade',
  description: 'Everyone knows the location except the spy. Talk it out, then vote.',
  pack: { editions: [{ id: 'standard', label: 'Everyday places', locations: [...LOCATION_IDS] }] },
  guide,
  locationName: (id) => locationById(id)?.name ?? id,
});
