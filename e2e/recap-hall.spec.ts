import {
  type Browser,
  type BrowserContextOptions,
  type Page,
  devices,
  expect,
  test,
} from '@playwright/test';
import { expectStrips, playEscape, wrapUp } from './recap-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

/** A Masquerade room with Hana hosting, Ana and Ben in; one-round games. */
async function table(browser: Browser, ana: BrowserContextOptions = {}) {
  const host = await player(browser, 'Hana');
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = [await player(browser, 'Ana', ana), await player(browser, 'Ben')];
  for (const p of others) await p.goto(url);
  const players = [host, ...others];
  const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
  await expect(host.getByText('Players (3/12)')).toBeVisible();
  await host.getByLabel('Rounds').selectOption('1');
  return { host, others, players, names };
}

const sheetOf = (p: Page) => p.getByRole('dialog', { name: /at the tavern/ });

test('Save image downloads on a computer and goes to the share sheet on a phone', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Ana is on a phone whose share sheet takes files (stubbed: it records what it was given).
  const phone = { ...devices['Pixel 7'] };
  const { host, others, players, names } = await table(browser, phone);
  const ana = others[0]!;
  await ana.addInitScript(() => {
    const w = window as unknown as { shared: { name: string; type: string; size: number }[] };
    w.shared = [];
    Object.assign(navigator, {
      canShare: (data: { files?: File[] }) => !!data.files?.length,
      share: (data: { files?: File[] }) => {
        for (const f of data.files ?? [])
          w.shared.push({ name: f.name, type: f.type, size: f.size });
        return Promise.resolve();
      },
    });
  });
  await ana.reload();
  await host.getByRole('button', { name: 'Start game' }).click();
  await playEscape(players, names);
  await expectStrips(players);

  // On a computer: a PNG download named after the night.
  await host.getByRole('button', { name: 'Night recap (1 game)' }).click();
  const sheet = sheetOf(host);
  const download = host.waitForEvent('download');
  await sheet.getByRole('button', { name: '🖼️ Save image' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tavern-night-\d{4}-\d\d-\d\d\.png$/);
  await file.saveAs('test-results/recap-image-desktop.png');

  // On the phone: the share sheet, with the picture.
  await ana.getByRole('button', { name: 'Night recap (1 game)' }).click();
  await sheetOf(ana).getByRole('button', { name: '🖼️ Save image' }).click();
  await expect
    .poll(() => ana.evaluate(() => (window as unknown as { shared: unknown[] }).shared))
    .toEqual([
      {
        name: expect.stringMatching(/^tavern-night-.+\.png$/) as unknown as string,
        type: 'image/png',
        size: expect.any(Number) as unknown as number,
      },
    ]);
  const size = await ana.evaluate(
    () => (window as unknown as { shared: { size: number }[] }).shared[0]!.size,
  );
  expect(size).toBeGreaterThan(10_000);
});

test('the Hall of fame remembers two wrapped-up nights', async ({ browser }) => {
  test.setTimeout(150_000);
  const { host, others, players, names } = await table(browser);
  for (let night = 1; night <= 2; night++) {
    if (night === 1) await host.getByRole('button', { name: 'Start game' }).click();
    else await host.getByRole('button', { name: 'Play again' }).click();
    await playEscape(players, names);
    await expectStrips(players);
    await wrapUp(host, players);
    for (const p of players) await sheetOf(p).getByRole('button', { name: 'Close' }).click();
  }

  // Ana opens the recap: tonight's card, and the Hall of fame next to it.
  const ana = others[0]!;
  await ana.getByRole('button', { name: /^Night recap/ }).click();
  const sheet = sheetOf(ana);
  await sheet.getByRole('tab', { name: '🏆 Hall of fame' }).click();
  const hall = sheet.getByRole('region', { name: 'Hall of fame' });
  await expect(hall.getByText('Nights together: 2')).toBeVisible();
  await expect(hall.getByText('👑 Most MVPs')).toBeHidden(); // one game a night: no MVP yet
  const previous = hall.getByRole('button', { name: /🎭×1/ });
  await expect(previous).toHaveCount(2);

  // An earlier night opens read-only: as it was frozen, no tone switch, no wrap-up.
  await previous.last().click();
  await expect(sheet.getByRole('region', { name: 'Past rounds' })).toContainText('Game 1');
  await expect(sheet.getByText('Wrapped up')).toBeVisible();
  await expect(sheet.getByRole('radiogroup', { name: 'Recap tone' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /Wrap up/ })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: '📋 Copy for chat' })).toBeVisible();
  await sheet.getByRole('button', { name: '← Hall of fame' }).click();
  await expect(hall).toBeVisible();
  await sheet.getByRole('tab', { name: '🍻 Tonight' }).click();
  await expect(sheet.getByRole('region', { name: 'Awards' })).toBeVisible();
});

test('"Same crew, new game" opens a linked table and the crew follows', async ({ browser }) => {
  test.setTimeout(120_000);
  const { host, others, players, names } = await table(browser);
  await host.getByRole('button', { name: 'Start game' }).click();
  await playEscape(players, names);
  await expectStrips(players);
  // Guests don't get the button; the host picks the next game.
  await expect(others[0]!.getByRole('button', { name: '🎲 Same crew, new game' })).toHaveCount(0);
  await host.getByRole('button', { name: '🎲 Same crew, new game' }).click();
  await host
    .getByRole('dialog', { name: '🎲 Same crew, new game' })
    .getByRole('button', { name: 'Codenames' })
    .click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const next = host.url();

  // Everyone else hears where the crew went, and follows.
  for (const p of others) {
    const banner = p.getByRole('status').filter({ hasText: 'opened a new table' });
    await expect(banner).toContainText('Hana opened a new table: 🕵️ Codenames');
    await banner.getByRole('link', { name: 'Join them' }).click();
    await expect(p).toHaveURL(next);
  }
  await expect(host.getByRole('button', { name: 'Players (3 online)' })).toBeVisible();

  // The new table's recap is the same night: the Masquerade game came along.
  for (const p of players) {
    await expect(p.getByRole('button', { name: 'Night recap (1 game)' })).toBeVisible();
  }
  await others[1]!.getByRole('button', { name: 'Night recap (1 game)' }).click();
  const rounds = sheetOf(others[1]!).getByRole('region', { name: 'Past rounds' });
  await expect(rounds).toContainText('🎭 Game 1 · Masquerade');
});
