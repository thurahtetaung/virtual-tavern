import { type Browser, type Page, expect, test } from '@playwright/test';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/', phone = false) {
  const page = await (
    await browser.newContext(phone ? { viewport: { width: 390, height: 844 } } : {})
  ).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const drawerOf = (page: Page) => page.getByRole('dialog', { name: 'Players' });
async function openPlayers(page: Page) {
  await page.getByRole('button', { name: /^Players/ }).click();
  await expect(drawerOf(page)).toBeVisible();
}
/** The colour the Players drawer shows for `name`. */
const colorOf = (page: Page, name: string) =>
  drawerOf(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(name, { exact: true }) })
    .locator('[data-color]')
    .getAttribute('data-color');

test('joiners get distinct colours, can change theirs, and a new room starts afresh', async ({
  browser,
}) => {
  const hana = await player(browser, 'Hana', '/', true);
  await hana.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  const ana = await player(browser, 'Ana', hana.url());
  await expect(hana.getByRole('status').filter({ hasText: 'Ana joined' })).toBeVisible();

  await openPlayers(hana);
  await expect(drawerOf(hana).locator('[data-color]')).toHaveCount(2);
  const hanaColor = await colorOf(hana, 'Hana');
  const anaColor = await colorOf(hana, 'Ana');
  expect(hanaColor).toBeTruthy();
  expect(anaColor).toBeTruthy();
  expect(hanaColor).not.toBe(anaColor);
  // Every player list shows the same dot: the lobby's team lists too.
  await expect(ana.locator(`[data-color="${anaColor}"]`).first()).toBeVisible();

  // Ana opens the form: her colour is ticked, Hana's is marked as hers.
  await openPlayers(ana);
  const drawer = drawerOf(ana);
  await drawer.getByRole('button', { name: 'Change name or colour' }).click();
  const swatches = drawer.getByRole('radiogroup', { name: 'Your colour' });
  await expect(swatches.getByRole('radio', { checked: true })).toHaveCount(1);
  const hanaSwatch = swatches.getByRole('radio', { name: /taken by Hana$/ });
  await expect(hanaSwatch).toHaveCount(1);
  if (process.env.SCREENSHOTS)
    await ana.screenshot({ path: 'test-results/shots/players-colour-picker.png' });

  // A taken colour is refused under the swatches; a free one goes through for everyone.
  await hanaSwatch.click();
  await expect(drawer.getByRole('alert')).toHaveText(
    /^Hana is already .+\. Pick another colour\.$/,
  );
  await swatches.getByRole('radio', { name: 'grey', exact: true }).click();
  await expect(swatches.getByRole('radio', { name: 'grey', exact: true })).toBeChecked();
  await expect(drawer.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => colorOf(hana, 'Ana')).toBe('grey');

  // Colours aren't remembered: in Ben's room, where Ben is grey already, Ana gets another one.
  const ben = await player(browser, 'Ben', '/');
  await ben.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(ben).toHaveURL(/\/r\//);
  await openPlayers(ben);
  await drawerOf(ben).getByRole('button', { name: 'Change name or colour' }).click();
  await drawerOf(ben).getByRole('radio', { name: 'grey', exact: true }).click();
  await expect(drawerOf(ben).getByRole('radio', { name: 'grey', exact: true })).toBeChecked();
  await ana.goto(ben.url());
  await expect(drawerOf(ben).locator('[data-color]')).toHaveCount(2);
  expect(await colorOf(ben, 'Ana')).not.toBe('grey');
});

test('on a small phone the refusal shows in view, and the drawer says "offline" like the lobby', async ({
  browser,
}) => {
  const hana = await player(browser, 'Hana');
  await hana.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  const anaContext = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const ana = await anaContext.newPage();
  ana.on('pageerror', (e) => pageErrors.push(e.message));
  await ana.addInitScript(() => localStorage.setItem('vt.playerName', 'Ana'));
  await ana.goto(hana.url());
  await expect(hana.getByRole('status').filter({ hasText: 'Ana joined' })).toBeVisible();

  // The swatches sit at the foot of the drawer; the refusal under them is scrolled into view.
  await openPlayers(ana);
  const drawer = drawerOf(ana);
  await drawer.getByRole('button', { name: 'Change name or colour' }).click();
  // The name field keeps its full touch height in the column layout.
  const field = drawer.getByRole('textbox', { name: 'Your name' });
  await expect.poll(async () => (await field.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await drawer.getByRole('radio', { name: /taken by Hana$/ }).click();
  await expect(drawer.getByRole('alert')).toBeInViewport({ ratio: 1 });
  // Done stays reachable under the refusal, and doesn't cover it.
  const done = drawer.getByRole('button', { name: 'Done', exact: true });
  await expect(done).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const [alert, button] = await Promise.all([
        drawer.getByRole('alert').boundingBox(),
        done.boundingBox(),
      ]);
      return alert && button ? alert.y + alert.height <= button.y : false;
    })
    .toBe(true);
  if (process.env.SCREENSHOTS)
    await ana.screenshot({ path: 'test-results/shots/players-colour-refused-360.png' });

  // Ana's browser closes: the lobby and the Players drawer use the same word for her.
  await anaContext.close();
  await expect(hana.getByText('Ana', { exact: true }).first()).toBeVisible();
  const lobbyAna = hana.locator('main').getByText('offline', { exact: true });
  await expect(lobbyAna.first()).toBeVisible();
  await openPlayers(hana);
  const row = drawerOf(hana)
    .getByRole('listitem')
    .filter({ has: hana.getByText('Ana', { exact: true }) });
  await expect(row).toContainText('offline');
  await expect(row).not.toContainText('away');
});
