import { type Page, expect } from '@playwright/test';

/**
 * Unfolds a section of the admin page (they start folded, except the back room, and the page
 * remembers each one per browser). Does nothing when it is already open.
 */
export async function openAdminSection(page: Page, name: string) {
  const details = page.getByRole('region', { name, exact: true }).locator('details');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}
