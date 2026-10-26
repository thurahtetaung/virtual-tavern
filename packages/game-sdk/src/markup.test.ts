import { describe, expect, it } from 'vitest';
import { plainLines, plainText } from './markup.mjs';

describe('plainText', () => {
  it('takes tags out and keeps the words', () => {
    expect(plainText('The movie <i>Speed</i>')).toBe('The movie Speed');
    expect(plainText('<b>Fish</b> and <em class="x">chips</em><br/>')).toBe('Fish and chips');
  });

  it('leaves nothing of nested or broken tags', () => {
    expect(plainText('<scr<script>ipt>alert(1)</scr</script>ipt>')).toBe('alert(1)');
    expect(plainText('a <<b>i>b</<b>i> c')).toBe('a b c');
    expect(plainText('unclosed <script')).toBe('unclosed script');
    expect(plainText('3 < 4 > 2')).toBe('3 2');
  });

  it('decodes entities, and an encoded tag never comes back as one', () => {
    expect(plainText('Fish &amp; chips&#8230; &#x2019;s&nbsp;end')).toBe('Fish & chips… ’s end');
    expect(plainText('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('alert(1)');
    expect(plainText('&lt;scr&lt;script&gt;ipt&gt;x')).toBe('x');
    // Decoded once only: a double-encoded entity stays text.
    expect(plainText('&amp;lt;b&amp;gt;')).toBe('&lt;b&gt;');
    expect(plainText('Odd &unknown; thing')).toBe('Odd &unknown; thing');
  });

  it('collapses spaces', () => {
    expect(plainText('  a \n\t b  ')).toBe('a b');
  });

  it('plainLines keeps line and paragraph breaks, collapsing spaces within a line', () => {
    expect(plainLines('  First  <i>line</i>.\r\nSecond\t line.\n\n\n\nNew   paragraph.  ')).toBe(
      'First line.\nSecond line.\n\nNew paragraph.',
    );
    expect(plainLines('a &lt;b&gt;x&lt;/b&gt;\n \nb')).toBe('a x\n\nb');
  });
});
