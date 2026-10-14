import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_CARDS, PLACEHOLDER_NAMES, fillNames } from './names.ts';

describe('fillNames', () => {
  const names = {
    ...PLACEHOLDER_NAMES,
    cards: { ...PLACEHOLDER_NAMES.cards, defuse: 'Off Switch', nope: 'Nah' },
  };

  it('fills card tokens and fixes the article before a vowel', () => {
    expect(fillNames('You have no {c:defuse}.', names)).toBe('You have no Off Switch.');
    expect(fillNames('Play a {c:defuse}, or A {c:nope}.', names)).toBe(
      'Play an Off Switch, or A Nah.',
    );
    expect(fillNames('the {c:defuse}', names)).toBe('the Off Switch');
    expect(fillNames('a {c:nope}', names)).toBe('a Nah');
    expect(fillNames('Data {c:defuse}', names)).toBe('Data Off Switch');
  });
});

/** String literals in the engine (refusals and the log's `did` texts) that spell a card's name. */
function spelled(file: string): string[] {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join('\n');
  const literals = [...src.matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? '');
  const words = Object.values(PLACEHOLDER_CARDS)
    .flatMap((n) => [n, n.replace(/ \(.*\)$/, '')])
    .filter((n) => /^[A-Z]/.test(n));
  return literals.filter(
    (s) =>
      s.includes(' ') &&
      words.some((w) =>
        new RegExp(`(^|[^\\w{:])${w.replace(/[!()]/g, '\\$&')}s?(?![\\w])`).test(s),
      ),
  );
}

describe('server text names cards only through tokens', () => {
  it('no refusal or log text in the engine spells a placeholder card name', () => {
    expect(spelled('./game.ts')).toEqual([]);
  });

  it('nor do the hints and lines the browser builds', () => {
    for (const file of ['../ui/ShortFuseGame.tsx', '../ui/text.ts', '../ui/Log.tsx'])
      expect(spelled(file), file).toEqual([]);
  });
});
