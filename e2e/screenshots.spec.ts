import { expect, test } from '@playwright/test';

// Opt-in visual check: SCREENSHOTS=1 pnpm e2e screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`screenshots (${label})`, async ({ browser }) => {
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.screenshot({ path: `test-results/shots/${label}-home.png`, fullPage: true });
    await host.getByRole('button', { name: 'Create a room' }).click();
    await expect(host.getByText('Pick a team below')).toBeVisible();
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    await host
      .getByRole('region', { name: 'Red team' })
      .getByRole('button', { name: 'Be the Spymaster' })
      .click();
    await others[0]!.getByRole('button', { name: 'Join Red as Operative' }).click();
    await others[1]!
      .getByRole('region', { name: 'Blue team' })
      .getByRole('button', { name: 'Be the Spymaster' })
      .click();
    await others[2]!.getByRole('button', { name: 'Join Blue as Operative' }).click();
    await expect(host.getByText('Everyone is seated')).toBeVisible();
    await host.screenshot({ path: `test-results/shots/${label}-lobby.png`, fullPage: true });
    await host.getByRole('button', { name: 'Change word lists' }).click();
    await expect(host.getByRole('dialog')).toBeVisible();
    await host.screenshot({ path: `test-results/shots/${label}-word-lists.png` });
    await host.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await host.getByRole('button', { name: 'Start game' }).click();
    await expect(host.getByRole('gridcell')).toHaveCount(25);
    await host.screenshot({ path: `test-results/shots/${label}-spymaster.png`, fullPage: true });
    const redStarts = await host.getByText('Your turn! Give your team').isVisible();
    const [spy, op] = redStarts ? [host, others[0]!] : [others[1]!, others[2]!];
    await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
    await spy.getByRole('button', { name: 'Give clue' }).click();
    await expect(op.getByText('Your turn to guess')).toBeVisible();
    await op.getByRole('gridcell').first().click();
    await op.screenshot({ path: `test-results/shots/${label}-operative.png`, fullPage: true });
    await op.getByRole('button', { name: /^Guess / }).click();
    await expect(op.getByText(/guessed/).first()).toBeVisible();
    await op.screenshot({ path: `test-results/shots/${label}-result.png`, fullPage: true });
    await op.getByRole('button', { name: 'Rules' }).click();
    await op.screenshot({ path: `test-results/shots/${label}-rules.png` });
  });
}
