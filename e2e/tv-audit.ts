import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from '@playwright/test';

// The table screen's checks, measured in the page: the smallest text on screen (in screen pixels,
// after the poster's scaling and any zoom), how many things could take focus, whether anything
// overflows, and whether a headline or instruction line leaves one word alone on its last line.
// Opt-in with screenshot runs; each call appends one line of JSON to TV_AUDIT (default
// test-results/tv-audit.jsonl) and takes the screenshot.

export interface TvAudit {
  label: string;
  /** Smallest text on screen, outside art (text printed on a card or tape), in px. */
  minFont: number;
  /** Up to five of the smallest texts, for a report. */
  smallest: { px: number; text: string }[];
  /** Smallest text printed on art (`role="img"`), reported apart. */
  minArtFont: number | null;
  focusable: string[];
  /** The page scrolls (it never should on a TV). */
  pageOverflow: boolean;
  /** Boxes on the poster whose content is cut off. */
  clipped: string[];
  /** Headlines and instruction lines whose last line holds one word. */
  orphans: string[];
}

export async function auditTv(page: Page, label: string, path?: string): Promise<TvAudit> {
  const audit = await page.evaluate((name): TvAudit => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      for (let e: Element | null = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0)
          return false;
      }
      return true;
    };
    /** The element's rendered size over its layout size: the poster's scale times any zoom. */
    const scaleOf = (el: HTMLElement) => {
      const w = el.offsetWidth;
      return w > 0 ? el.getBoundingClientRect().width / w : 1;
    };
    const texts: { px: number; text: string; art: boolean }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').trim();
      const el = n.parentElement;
      if (!text || !el || el.closest('script,style,svg,[aria-hidden="true"] [role="img"]'))
        continue;
      if (el.closest('.sr-only') || !visible(el)) continue;
      // A text node's own size: the parent's font size, times how much it is scaled on screen.
      let host: HTMLElement = el;
      while (host.offsetWidth === 0 && host.parentElement) host = host.parentElement;
      const px = parseFloat(getComputedStyle(el).fontSize) * scaleOf(host);
      texts.push({
        px: Math.round(px * 10) / 10,
        text: text.slice(0, 40),
        art: !!el.closest('[role="img"]'),
      });
    }
    const plain = texts.filter((t) => !t.art).sort((a, b) => a.px - b.px);
    const art = texts.filter((t) => t.art).sort((a, b) => a.px - b.px);

    const focusable = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]',
      ),
    ]
      .filter((e) => !(e as HTMLButtonElement).disabled && e.tabIndex >= 0 && visible(e))
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}:${(e.textContent ?? e.getAttribute('aria-label') ?? '').trim().slice(0, 30)}`,
      );

    const root = document.documentElement;
    const pageOverflow =
      root.scrollWidth > root.clientWidth + 1 || root.scrollHeight > root.clientHeight + 1;

    const clipped: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-poster] *')) {
      const s = getComputedStyle(el);
      if (!/hidden|clip|auto|scroll/.test(s.overflow + s.overflowY + s.overflowX)) continue;
      if (!visible(el)) continue;
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)
        clipped.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} ${el.scrollWidth}x${el.scrollHeight}>${el.clientWidth}x${el.clientHeight}`,
        );
    }

    // One word alone on the last line of a headline or an instruction line.
    const orphans: string[] = [];
    const lines = document.querySelectorAll<HTMLElement>(
      '[data-poster] h1, [data-poster] h2, [data-testid="poster-headline"], [data-testid="poster-line"], [data-poster] footer span',
    );
    for (const el of lines) {
      if (!visible(el)) continue;
      const tops: number[] = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const s = n.textContent ?? '';
        for (const m of s.matchAll(/\S+/g)) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const box = r.getClientRects()[0];
          if (box) tops.push(Math.round(box.top));
        }
      }
      const rows = [...new Set(tops)];
      if (rows.length < 2) continue;
      const last = Math.max(...rows);
      if (tops.filter((t) => Math.abs(t - last) < 4).length === 1)
        orphans.push((el.textContent ?? '').trim().slice(0, 60));
    }

    return {
      label: name,
      minFont: plain[0]?.px ?? 0,
      smallest: plain.slice(0, 5).map(({ px, text }) => ({ px, text })),
      minArtFont: art[0]?.px ?? null,
      focusable,
      pageOverflow,
      clipped,
      orphans,
    };
  }, label);
  if (path) await page.screenshot({ path });
  const log = process.env.TV_AUDIT ?? 'test-results/tv-audit.jsonl';
  await mkdir(dirname(log), { recursive: true });
  await appendFile(log, `${JSON.stringify(audit)}\n`);
  return audit;
}
