/**
 * Words a back-room manifest may rename (`names` in `going-once/manifest.json`), written as
 * tokens in the guide and on screen: `{bank}` mid-sentence, `{Bank}` at the start of one.
 */
export interface Names {
  bank: string;
  /** The three art buyers who send the tips (`buyer1`…`buyer3`), by their portraits. */
  buyers: [string, string, string];
}

export const PLACEHOLDER_NAMES: Names = {
  bank: 'the bank',
  buyers: ['The collector', 'The old lady', 'The socialite'],
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fills `{bank}` and `{Bank}`. */
export function fillNames(text: string, names: Names): string {
  return text.replaceAll('{bank}', names.bank).replaceAll('{Bank}', cap(names.bank));
}
