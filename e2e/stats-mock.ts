import { type Page, expect } from '@playwright/test';
import { fixtureFor } from '../apps/web/src/stats/fixtures.ts';
import { TEST_ADMIN_PASSWORD } from './credentials.ts';

/**
 * Serves the stats API from the typed fixtures the page was built against, so the specs don't
 * depend on what the test server has recorded. Returns how many resets it saw.
 */
export async function mockStatsApi(page: Page) {
  const calls = { reset: 0 };
  await page.route('**/api/admin/stats/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/reset')) {
      calls.reset++;
      return route.fulfill({ status: 204 });
    }
    const body = fixtureFor(url.pathname + url.search);
    return body === undefined
      ? route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } })
      : route.fulfill({ json: body });
  });
  return calls;
}

/** Signs in on /admin and follows the nav to the stats page. */
export async function openStatsAsAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByRole('navigation', { name: 'Admin' })
    .getByRole('link', { name: 'Stats' })
    .click();
  await expect(page).toHaveURL(/\/admin\/stats$/);
  await expect(page.getByRole('heading', { name: 'Live rooms' })).toBeVisible();
}
