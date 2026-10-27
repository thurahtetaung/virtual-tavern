export type WireColour = 'black' | 'blue' | 'red' | 'white' | 'yellow';

/** One condition of a Wires rule; a rule's conditions must all hold. */
export type WireCond =
  | { count: WireColour; is: number }
  | { count: WireColour; over: number }
  | { last: WireColour }
  | { serialOdd: true };

/** Cut the wire at a position (0-based), the last wire, or the last wire of a colour. */
export interface WireRule {
  when: WireCond[];
  cut: number | 'last';
  of?: WireColour;
}

export type ButtonCond =
  | { colour: string }
  | { label: string }
  | { batteriesOver: number }
  | { lit: string };

export interface ButtonRule {
  when: ButtonCond[];
  hold: boolean;
}
