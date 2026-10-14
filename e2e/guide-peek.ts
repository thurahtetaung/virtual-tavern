import { type Page, expect } from '@playwright/test';

/** The rules drawer keeps a secret role out of the page until the viewer holds or shows it. */
export async function checkGuidePeek(page: Page, roleName: string) {
  const youAre = page.getByRole('region', { name: 'You are', exact: true });
  // Closed: the drawer holds nothing of the room.
  await expect(youAre).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your role, hidden' })).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Rules', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const drawer = page.getByRole('dialog', { name: /^How to play/ });
  const hidden = drawer.getByRole('region', { name: 'Your role, hidden' });
  await expect(hidden).toBeVisible();
  await expect(drawer.getByText('In your room:')).toBeVisible();
  await expect(youAre).toHaveCount(0);
  // Hold to peek, let go to hide.
  const box = (await drawer
    .getByTestId('guide-peek')
    .locator('[role=presentation]')
    .boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(youAre).toContainText(roleName);
  await page.mouse.up();
  await expect(youAre).toHaveCount(0);
  // Or switch it on, and off again.
  await drawer.getByRole('button', { name: '👁️ Show my role' }).click();
  await expect(youAre).toContainText(roleName);
  await drawer.getByRole('button', { name: '🙈 Hide my role' }).click();
  await expect(youAre).toHaveCount(0);
  // Closing with it shown leaves nothing behind either.
  await drawer.getByRole('button', { name: '👁️ Show my role' }).click();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
  await expect(youAre).toHaveCount(0);
}
