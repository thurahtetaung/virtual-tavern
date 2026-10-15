import type { Page } from '@playwright/test';

/** A guest's lobby settings start as one summary line each (⚙️): opens them all to read them. */
export async function openSettings(page: Page) {
  const closed = page.locator('details:not([open]) > summary', { hasText: '⚙️' });
  for (let n = await closed.count(); n > 0; n--) await closed.first().click();
}
