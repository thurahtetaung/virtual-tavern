import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';

const PHONE = { width: 390, height: 844 };

/** What the page measures on a phone: its scroll, and controls a fixed bar covers. */
function measure(page: Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement!;
    const fixed = (node: Element) => {
      for (let n: Element | null = node; n; n = n.parentElement)
        if (getComputedStyle(n).position === 'fixed') return n;
      return null;
    };
    // The bars at the foot of the screen: the sticky bar and the tab bar.
    const bars = [
      ...document.querySelectorAll('[data-ui="sticky-bar"], [role="tablist"], nav'),
    ].filter((b) => getComputedStyle(b).position === 'fixed' && b.getBoundingClientRect().height);
    const rects = bars.map((b) => b.getBoundingClientRect());
    const covered: string[] = [];
    for (const c of document.querySelectorAll('input, textarea, select, button')) {
      if (fixed(c) || c.closest('[role="dialog"]')) continue;
      // What shows of it: clipped by any ancestor that scrolls inside (a dense panel on a phone).
      const box = c.getBoundingClientRect();
      const r = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      for (let n = c.parentElement; n; n = n.parentElement) {
        if (!/auto|scroll|hidden/.test(getComputedStyle(n).overflowY)) continue;
        const clip = n.getBoundingClientRect();
        r.top = Math.max(r.top, clip.top);
        r.bottom = Math.min(r.bottom, clip.bottom);
      }
      if (box.width <= 0 || r.bottom - r.top <= 0) continue;
      if (
        rects.some(
          (b) => r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom,
        )
      )
        covered.push(
          c.getAttribute('aria-label') ?? c.textContent?.trim().slice(0, 30) ?? c.tagName,
        );
    }
    return { scroll: el.scrollHeight, client: el.clientHeight, width: el.scrollWidth, covered };
  });
}

/**
 * The phone fit of a play screen: at 390 × 844 the page doesn't scroll either way and no control
 * sits under the sticky bar or the tab bar. Records the numbers as a `fit` annotation, then puts
 * the page back to its own size.
 */
export async function expectPhoneFit(
  page: Page,
  label: string,
  /** A screen that lasts only seconds (a four-second window) waits less for the page to settle. */
  { timeout }: { timeout?: number } = {},
) {
  const size = page.viewportSize();
  if (size?.width !== PHONE.width || size.height !== PHONE.height)
    await page.setViewportSize(PHONE);
  await expect
    .poll(
      async () => {
        const m = await measure(page);
        return m.scroll - m.client;
      },
      { message: `${label}: the page fits the phone's height`, ...(timeout && { timeout }) },
    )
    .toBeLessThanOrEqual(1);
  const m = await measure(page);
  test.info().annotations.push({
    type: 'fit',
    description: `${label}: page ${m.scroll}/${m.client}, width ${m.width}`,
  });
  expect(m.width, `${label}: no sideways scroll`).toBeLessThanOrEqual(PHONE.width);
  expect(m.covered, `${label}: controls under a bar`).toEqual([]);
  // FIT_SHOTS=<folder> keeps a dark-mode picture of the screen as measured.
  const shots = process.env.FIT_SHOTS;
  if (shots) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: `${shots}/${label.replace(/\W+/g, '-')}-phone-dark.png` });
    await page.emulateMedia({ colorScheme: null });
  }
  if (size && (size.width !== PHONE.width || size.height !== PHONE.height))
    await page.setViewportSize(size);
}
