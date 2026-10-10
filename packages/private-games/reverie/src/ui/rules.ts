// Tiny re-exports so the UI package never imports the whole engine just for constants.
export { MIN_PLAYERS } from '../logic/types.ts';
export { cardsNeeded as cardsNeededFor } from '../logic/game.ts';
