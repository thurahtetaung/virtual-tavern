import { defineMasquerade } from '@vt/game-masquerade/logic';
import { guide } from './guide.ts';
import { ORIGINALS_PACK } from './pack.ts';

export { guide } from './guide.ts';
export { ORIGINALS_PACK, locationNumber, placeholderName } from './pack.ts';

/** The back-room edition: the same game, with the original locations from private storage. */
export const masqueradeOriginals = defineMasquerade({
  id: 'masquerade-originals',
  name: 'Masquerade Originals',
  description: 'Masquerade with the original locations and their art.',
  access: 'private',
  pack: ORIGINALS_PACK,
  guide,
});
