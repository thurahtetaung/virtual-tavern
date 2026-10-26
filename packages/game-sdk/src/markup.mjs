// Plain JavaScript, so Node scripts (scripts/import-content-pack.mjs) import the very same helper
// the games do; its types are in markup.d.mts.

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** Tags removed until none is left (a nested `<scr<b>ipt>` loses its inner tag, then the outer). */
function stripTags(text) {
  let out = text;
  for (let before = ''; before !== out;) {
    before = out;
    out = out.replace(/<[^<>]*>/g, '');
  }
  // Text never needs angle brackets: any left over is a broken tag.
  return out.replace(/[<>]/g, '');
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Text with any markup taken out, keeping the words: tags stripped ("The movie <i>Speed</i>" is
 * "The movie Speed"), entities decoded, then stripped again so an encoded tag (`&lt;b&gt;`) can't
 * come back as one, and spaces collapsed. The one place the repo cleans markup out of text.
 */
export function plainText(text) {
  return stripTags(decodeEntities(stripTags(String(text))))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `plainText` for longer text such as a story: line and paragraph breaks stay, spaces are
 * collapsed within each line, and three or more breaks become one blank line.
 */
export function plainLines(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => plainText(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
