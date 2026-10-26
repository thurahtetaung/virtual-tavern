import { createContext, useContext } from 'react';
import { PLAIN_WORDS, type Words, reword } from '../logic/names.ts';

/** The action's words from the manifest, for every player-facing line. */
export const WordsContext = createContext<Words>(PLAIN_WORDS);

/** Rewords a line with the manifest's word for the action. */
export function useSay(): (text: string) => string {
  const words = useContext(WordsContext);
  return (text) => reword(text, words);
}
