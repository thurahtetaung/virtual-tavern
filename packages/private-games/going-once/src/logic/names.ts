/**
 * Words a back-room manifest may rename (`names` in `going-once/manifest.json`), written as
 * tokens in the guide and on screen: `{bank}` mid-sentence, `{Bank}` at the start of one.
 */
export interface Names {
  bank: string;
}

export const PLACEHOLDER_NAMES: Names = { bank: 'the bank' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fills `{bank}` and `{Bank}`. */
export function fillNames(text: string, names: Names): string {
  return text.replaceAll('{bank}', names.bank).replaceAll('{Bank}', cap(names.bank));
}
