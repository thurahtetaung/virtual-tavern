import type { ActOptions } from '@vt/game-sdk';
import type { SketchyAction } from '../logic/types.ts';

export type Act = (action: SketchyAction, options?: ActOptions) => Promise<boolean>;
