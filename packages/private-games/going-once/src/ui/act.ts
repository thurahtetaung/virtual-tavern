import type { ActOptions } from '@vt/game-sdk';
import type { GoingOnceAction } from '../logic/types.ts';

export type Act = (action: GoingOnceAction, options?: ActOptions) => Promise<boolean>;
