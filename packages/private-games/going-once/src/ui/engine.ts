import { soundEngineFor } from '@vt/ui/sound';
import { GAME_ID } from './assets.ts';

// The sound engine is shared (`@vt/ui/sound`); Going Once's clips live in its own cache.
export { type Saying, SoundEngine } from '@vt/ui/sound';
/** The page's one sound engine for Going Once (shared by every room the tab visits). */
export const soundEngine = () => soundEngineFor(GAME_ID);
