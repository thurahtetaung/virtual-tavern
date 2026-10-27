import { type Page, expect } from '@playwright/test';

/**
 * Lobby settings start as one summary line each (⚙️) for guests, and for the host on a phone:
 * opens them all to read or change them.
 */
export async function openSettings(page: Page) {
  const closed = page.locator('details:not([open]) > summary', { hasText: '⚙️' });
  for (let n = await closed.count(); n > 0; n--) await closed.first().click();
}

/**
 * At a phone's width, every guest summary (⚙️) shows whole: its parts that fit, then "+N more",
 * never a line cut with an ellipsis. Returns the summaries' text.
 */
export async function expectSummariesWhole(page: Page, width: number): Promise<string[]> {
  const size = page.viewportSize();
  await page.setViewportSize({ width, height: 800 });
  const summaries = page.getByTestId('settings-summary');
  await expect(summaries.first()).toBeVisible();
  await expect
    .poll(() =>
      summaries.evaluateAll(
        (els) => els.filter((el) => el.scrollHeight > el.clientHeight + 1).length,
      ),
    )
    .toBe(0);
  const texts = await summaries.allTextContents();
  if (size) await page.setViewportSize(size);
  return texts;
}
