import type { GameGuide } from '@vt/game-sdk';
import { guide as hydraGuide } from '@vt/private-hydra/guide';

export {
  creditOf,
  footerOf,
  guideArtOf,
  nameGuide,
  namesOf,
  powerNamesOf,
} from '@vt/private-hydra/guide';

/**
 * The edition's rules are Hydra's: unlocked players see them named from its manifest
 * (`namedGuide`). The plain guide only stands in until then, so its tagline (on the back room's
 * game card) says what the edition is without naming Hydra or its teams.
 */
export const guide: GameGuide = {
  ...hydraGuide,
  tagline: 'A hidden-role election game in a themed edition.',
};
