import { type Manifest, namesOf, powerNamesOf } from './manifest.ts';
import { type Names, POWER_NAMES, capitalise, fillNames } from './names.ts';
import type { Power } from './types.ts';

const POWERS: Power[] = ['investigate', 'special', 'peek', 'execute'];

/**
 * The words behind the `{role:…}` placeholders Hydra's recap lines and stats figures carry, from
 * an edition's manifest (Hydra's own words where it is silent): any name (`{role:blue}`,
 * `{role:chancellor}`, `{role:bluePolicy}`), the boards' cards (`{role:red-policies}`) and the
 * powers (`{role:power-peek}`). A capitalised id (`{role:Veto}`) capitalises the word. Unknown
 * ids give undefined.
 */
export function placeholderWord(man: Manifest | null): (id: string) => string | undefined {
  const names = namesOf(man);
  const powers = powerNamesOf(man);
  const words: Record<string, string> = {
    ...(Object.fromEntries(
      (Object.keys(names) as (keyof Names)[])
        .filter((k) => k !== 'title')
        .map((k) => [k, names[k]]),
    ) as Record<string, string>),
    'blue-policies': `${names.bluePolicy} ${names.policies}`,
    'red-policies': `${names.redPolicy} ${names.policies}`,
    ...Object.fromEntries(
      POWERS.map((p) => [`power-${p}`, powers[p] ?? fillNames(POWER_NAMES[p], names)]),
    ),
  };
  return (id) => {
    const lower = id ? id[0]!.toLowerCase() + id.slice(1) : id;
    const word = Object.hasOwn(words, lower) ? words[lower] : undefined;
    if (word === undefined) return undefined;
    return id === lower ? word : capitalise(word);
  };
}
