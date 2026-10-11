import { expect, test } from '@playwright/test';

test('visitors can open the FAQ from the header and read an answer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('link', { name: 'FAQ', exact: true }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole('heading', { name: 'Questions & answers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accounts and privacy' })).toBeVisible();
  const question = page.getByText('Do I need an account?');
  await question.click();
  await expect(page.getByText('You just pick a name.')).toBeVisible();
  expect(errors).toEqual([]);
});
