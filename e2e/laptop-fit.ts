import { type Locator, type Page, expect } from '@playwright/test';

const LAPTOP = { width: 1280, height: 720 };

/** How far a box reaches past the window's top or foot, in whole pixels. */
function outside(target: Locator) {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return Math.max(0, Math.ceil(box.bottom - window.innerHeight), Math.ceil(-box.top));
  });
}

/** Whether a fixed bar at the foot (not one the box sits in, or holds) lies over the box. */
function underBar(target: Locator) {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...document.querySelectorAll('[data-ui="sticky-bar"]')]
      .filter(
        (b) =>
          !b.contains(el) &&
          !el.contains(b) &&
          getComputedStyle(b).position === 'fixed' &&
          b.getBoundingClientRect().height > 0,
      )
      .some((b) => {
        const q = b.getBoundingClientRect();
        // A pixel of rounding where the box meets the bar's edge isn't cover.
        return r.left < q.right && q.left < r.right && r.top < q.bottom - 1 && q.top < r.bottom - 1;
      });
  });
}

/**
 * A play screen on a 1280 × 720 laptop: what just happened, what to do and the control to do it
 * (`targets`) are all wholly in the window without scrolling, and no fixed bar lies over any of
 * them. Puts the page back to its own size afterwards.
 */
export async function expectLaptopFit(page: Page, label: string, targets: Locator[]) {
  const size = page.viewportSize();
  await page.setViewportSize(LAPTOP);
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const [i, target] of targets.entries()) {
    await expect
      .poll(() => outside(target), { message: `${label}: target ${i + 1} in the window` })
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() => underBar(target), { message: `${label}: no bar over target ${i + 1}` })
      .toBe(false);
  }
  if (size) await page.setViewportSize(size);
}
