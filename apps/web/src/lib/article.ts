// Words that start with a vowel letter but a consonant sound ("a one-night game", "a unicorn"),
// and the reverse ("an hour").
const CONSONANT_SOUND = /^(one|once|uni|use|usu|eu|ewe)/i;
const VOWEL_SOUND = /^(hour|honest|honou?r|heir)/i;

/** "a" or "an" for the word that follows, by how it sounds rather than its first letter. */
export function article(word: string): 'a' | 'an' {
  if (VOWEL_SOUND.test(word)) return 'an';
  if (CONSONANT_SOUND.test(word)) return 'a';
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}
