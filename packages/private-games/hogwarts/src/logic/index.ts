import { defineHydra } from '@vt/private-hydra/logic';
import { guide } from './guide.ts';

export { guide } from './guide.ts';

/**
 * A themed edition of Hydra: the same rules and engine under its own id, so it has its own lobby
 * entry, stats and recap. Every name, line of copy, piece of art and font comes from its private
 * manifest (`hogwarts/manifest.json`); the repository holds none of it.
 */
export const hogwarts = defineHydra({
  id: 'hogwarts',
  name: 'Hydra: Wands',
  description: 'Hydra in a themed edition, with its names, wording and art from private storage.',
  guide,
});
