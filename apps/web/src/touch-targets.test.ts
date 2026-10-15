import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, uiFiles } from './ui-sources.ts';

/*
 * Guard for the end screen's Play again and Change setup buttons: they are the host's next step on a
 * phone, so they are at least 44 px tall. `Button` is 40 px at its default size, so they take
 * `size="lg"` (48 px) or a `min-h-11` class.
 */

const END_LABEL = /^\s*(Play again|Change setup)\b/;
const TALL = /size="lg"|(?<![\w-])(min-h|h|size)-(11|12|14)(?![\w/-])/;

/** Every end-screen `<Button>` in `source` shorter than 44 px, as `line: label`. */
export function shortEndButtons(source: string): string[] {
  return [...source.matchAll(/<Button\b((?:=>|[^>])*)>([^<]*)<\/Button>/g)].flatMap((m) => {
    const label = END_LABEL.exec(m[2]!)?.[1];
    if (!label || TALL.test(m[1]!)) return [];
    return [`${source.slice(0, m.index).split('\n').length}: ${label}`];
  });
}

describe('end-screen buttons', () => {
  it('flags Play again and Change setup buttons below 44 px', () => {
    expect(
      shortEndButtons(
        [
          `<Button onClick={() => void act({ type: 'play-again' })}>Play again</Button>`,
          `<Button size="lg" onClick={() => void act({ type: 'start' })}>`,
          `  Play again`,
          `</Button>`,
          `<Button variant="secondary" onClick={() => void act({ type: 'back-to-lobby' })}>`,
          `  Change setup`,
          `</Button>`,
          `<Button className="min-h-11">Change setup</Button>`,
          `<Button size="sm">Undo</Button>`,
        ].join('\n'),
      ),
    ).toEqual(['1: Play again', '5: Change setup']);
  });

  it('finds none in UI code', () => {
    const found = uiFiles().flatMap(({ file }) =>
      shortEndButtons(readFileSync(file, 'utf8')).map((hit) => `${relative(root, file)}:${hit}`),
    );
    expect(found, 'give end-screen buttons size="lg"').toEqual([]);
  });
});
