import { expect } from '@playwright/test';
import { test } from './fixtures.ts';

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

test('a player can ask the server to forget them, but only on purpose', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('vt.playerName', 'Ana'));
  await page.goto('/faq');
  // Make sure this browser has an identity to forget.
  await page.evaluate(() =>
    localStorage.setItem('vt.playerToken', 'forget-me-test-token-0123456789abcdef'),
  );
  await page.getByText('🧹 Forget me: delete my data from the server').click();
  const button = page.getByRole('button', { name: 'Delete my data' });
  await expect(button).toBeDisabled();
  await page.getByLabel(/Type .?forget me.? to confirm/).fill('forget');
  await expect(button).toBeDisabled();
  await page.getByLabel(/Type .?forget me.? to confirm/).fill('Forget me');
  await button.click();
  await expect(
    page.getByRole('status').filter({ hasText: 'The tavern has forgotten you' }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => [
      localStorage.getItem('vt.playerToken'),
      localStorage.getItem('vt.playerName'),
    ]),
  ).toEqual([null, null]);
  expect(errors).toEqual([]);
});
