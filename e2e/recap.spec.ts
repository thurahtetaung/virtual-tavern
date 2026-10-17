import { type Browser, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { expectStrips, playEscape, wrapUp } from './recap-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/') {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

test('two games of Masquerade, a superlatives strip on every device, and a wrapped-up night', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(['Ana', 'Ben'].map((n) => player(browser, n, url)));
  const players = [host, ...others];
  const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
  await expect(host.getByText('Players (3/12)')).toBeVisible();
  // No finished game yet: no recap chip.
  await expect(host.getByRole('button', { name: /^Night recap/ })).toHaveCount(0);
  await host.getByLabel('Rounds').selectOption('1');
  await host.getByRole('button', { name: 'Start game' }).click();

  // Game 1: the spy escapes without a single vote.
  const first = await playEscape(players, names);
  await expectStrips(players);
  // The ghost of the round: the spy with zero votes.
  await expect(
    host.getByRole('region', { name: 'Superlatives' }).getByText(names.get(first.spy)!).first(),
  ).toBeVisible();
  for (const p of players)
    await expect(p.getByRole('button', { name: 'Night recap (1 game)' })).toBeVisible();

  // Game 2.
  await host.getByRole('button', { name: 'Play again' }).click();
  // The strip belongs to the end screen only.
  await expect(host.getByRole('region', { name: 'Superlatives' })).toHaveCount(0);
  await playEscape(players, names);
  await expectStrips(players);
  for (const p of players)
    await expect(p.getByRole('button', { name: 'Night recap (2 games)' })).toBeVisible();

  // A guest opens the recap themselves: no wrap-up for them, but the whole night is there.
  await others[0]!.getByRole('button', { name: 'Night recap (2 games)' }).click();
  const guestSheet = others[0]!.getByRole('dialog', { name: 'Tonight at the tavern' });
  await expect(guestSheet.getByText('2 games', { exact: false }).first()).toBeVisible();
  await expect(guestSheet.getByRole('button', { name: /Wrap up/ })).toHaveCount(0);
  await expect(guestSheet.getByRole('radiogroup', { name: 'Recap tone' })).toHaveCount(0);
  await expect(guestSheet.getByRole('region', { name: 'Past rounds' })).toContainText('Game 2');
  await guestSheet.getByRole('button', { name: 'Close' }).click();

  // The host wraps up: the recap opens everywhere.
  await wrapUp(host, players);
  const sheet = host.getByRole('dialog', { name: /at the tavern/ });
  // Everyone who played has a line on the card.
  const lines = sheet.getByRole('region', { name: /^(Awards|Night MVP)$/ });
  const covered = (await lines.allInnerTexts()).join('\n');
  for (const name of names.values()) expect(covered).toContain(name);
  // Wholesome mode rewords the card for everyone.
  await sheet.getByRole('radio', { name: '🤗 Wholesome' }).click();
  await expect(sheet.getByRole('radio', { name: '🤗 Wholesome' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Copy for chat: the night as text, names in bold.
  await sheet.getByRole('button', { name: '📋 Copy for chat' }).click();
  await expect
    .poll(() => host.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^🍻 Tavern night · .+\n🎭 Masquerade ×2\n/);
  const text = await host.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n').length).toBeLessThanOrEqual(15);
  expect(text).toMatch(/\*\*(Hana|Ana|Ben)\*\*/);
  expect(text).not.toMatch(/\{p:|https?:/);

  // Anyone can close it.
  await others[1]!
    .getByRole('dialog', { name: /at the tavern/ })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(others[1]!.getByRole('dialog', { name: /at the tavern/ })).toBeHidden();
});
