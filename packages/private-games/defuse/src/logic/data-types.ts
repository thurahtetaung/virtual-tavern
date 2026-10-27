export type WireColour = 'black' | 'blue' | 'red' | 'white' | 'yellow';

/** One condition of a Wires rule; a rule's conditions must all hold. */
export type WireCond =
  | { count: WireColour; is: number }
  | { count: WireColour; over: number }
  | { last: WireColour }
  | { serialOdd: true }
  | { serialLetter: true };

/**
 * Cut the wire at a position (0-based) or the last wire; with `of`, the first, last or only
 * (`only`: "cut the red wire") wire of that colour.
 */
export interface WireRule {
  when: WireCond[];
  cut: number | 'last' | 'first' | 'only';
  of?: WireColour;
}

export type ButtonCond =
  { colour: string } | { label: string } | { batteriesOver: number } | { lit: string };

export interface ButtonRule {
  when: ButtonCond[];
  hold: boolean;
}
