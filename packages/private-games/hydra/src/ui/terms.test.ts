import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Hydra's offices and cards are named by the edition: no text a player can read may spell them
 * out. This scans every string and JSX text in the game's source (tests aside) for the words, so a
 * new line can't slip past the name tokens (`{president}`, `{policy}`, `{veto}`…).
 */
const TERMS = /\b(President|Presidential|Chancellor|Pres|Chanc|[Pp]olic(y|ies)|[Pp]arty|[Vv]eto)\b/;

const ALLOWED = new Set([
  // Hydra's own one-line description in the server's game list (another edition has its own).
  'A hidden-role election game: elect governments, pass policies, and unmask the Leader before it’s too late.',
  // A key in a round's record of turns played for someone, worded by the log (`AUTO_TEXT`).
  'veto answer',
]);

const SRC = join(import.meta.dirname, '..');

function sources(): string[] {
  return ['logic', 'ui'].flatMap((dir) =>
    readdirSync(join(SRC, dir))
      // `names.ts` is where the placeholder words themselves are written down.
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => !['test-utils.ts', 'names.ts'].includes(f))
      .map((f) => join(SRC, dir, f)),
  );
}

function texts(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) out.push(node.text);
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      // Ids and keys ('legislate-president', 'veto') have no spaces; prose does.
      if (/\s/.test(node.text)) out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe('no hard-coded offices or cards', () => {
  it.each(sources().map((f) => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const found = texts(file)
      .filter((t) => !ALLOWED.has(t.trim()))
      // Name tokens are how the words get in: `{president}`, `{Policy}`.
      .filter((t) => TERMS.test(t.replace(/\{[A-Za-z]+\}/g, '')));
    expect(found).toEqual([]);
  });
});
