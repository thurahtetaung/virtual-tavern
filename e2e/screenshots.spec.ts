import { type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD } from './credentials.ts';

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
    await host.getByRole('button', { name: 'Create a Codenames room' }).click();
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

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`enigma screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(90_000);
    // Phones get viewport-sized shots: that is what a player actually sees without scrolling.
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/enigma-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
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
    await host.getByRole('button', { name: 'Create an Enigma room' }).click();
    await expect(host.getByText('Pick a team below')).toBeVisible();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(host.url())));
    await host.getByRole('button', { name: 'Join Red' }).click();
    await others[0]!.getByRole('button', { name: 'Join Red' }).click();
    await others[1]!.getByRole('button', { name: 'Join Blue' }).click();
    await others[2]!.getByRole('button', { name: 'Join Blue' }).click();
    await expect(host.getByText('Everyone is in')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();

    const tx = (p: Page, team: string) => p.locator(`[aria-label="${team}'s transmission"]`);
    const teams = { Red: [host, others[0]!], Blue: [others[1]!, others[2]!] };
    await expect(host.getByText(/Encryptor|Waiting for/).first()).toBeVisible();
    const roles: Record<string, { enc: Page; dec: Page; code: number[] }> = {};
    for (const [team, pages] of Object.entries(teams)) {
      let enc: Page | undefined;
      // Wait for the round to render rather than checking once.
      await expect
        .poll(async () => {
          for (const p of pages)
            if (await tx(p, team).getByText('Your secret code').isVisible()) enc = p;
          return enc !== undefined;
        })
        .toBe(true);
      const code = (await tx(enc!, team).locator('.font-mono').first().innerText())
        .split('-')
        .map(Number);
      roles[team] = { enc: enc!, dec: pages.find((p) => p !== enc)!, code };
    }
    await shot(roles.Red!.enc, 'clue');
    for (const [team, r] of Object.entries(roles)) {
      const inputs = tx(r.enc, team).getByPlaceholder('A hint only your team will get');
      for (let i = 0; i < 3; i++) await inputs.nth(i).fill(['salty', 'orbit', 'crust'][i]!);
      await tx(r.enc, team).getByRole('button', { name: 'Send clues' }).click();
    }
    const red = roles.Red!;
    await tx(red.dec, 'Red')
      .getByRole('button', { name: `Clue 1 is keyword ${red.code[0]}` })
      .click();
    await shot(red.dec, 'guess');
    if (label === 'phone') {
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Chat/ })
        .click();
      await red.dec.getByLabel('Message your team').fill('first one is obviously the sea one');
      await red.dec.getByRole('button', { name: 'Send', exact: true }).click();
      await shot(red.dec, 'chat');
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Clues/ })
        .click();
      await shot(red.dec, 'clues');
      await red.dec
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name: /Play/ })
        .click();
    }
    for (const [team, r] of Object.entries(roles)) {
      for (let i = 0; i < 3; i++) {
        const b = tx(r.dec, team).getByRole('button', {
          name: `Clue ${i + 1} is keyword ${r.code[i]}`,
        });
        if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click();
        await expect(b).toHaveAttribute('aria-pressed', 'true');
      }
      await tx(r.dec, team)
        .getByRole('button', { name: /^Lock in/ })
        .click();
    }
    await expect(host.getByText('The code was').first()).toBeVisible();
    await shot(host, 'reveal');
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`reverie screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(90_000);
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/reverie-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const login = await request.post('/api/admin/login', {
      data: { password: TEST_ADMIN_PASSWORD },
    });
    const admin = login
      .headersArray()
      .find((h) => h.name.toLowerCase() === 'set-cookie')!
      .value.split(';')[0]!;
    await request.put('/api/admin/backroom/password', {
      headers: { cookie: admin },
      data: { password: TEST_BACKROOM_WORD },
    });
    let ip = 1;
    const make = async (name: string) => {
      const ctx = await browser.newContext({
        viewport,
        colorScheme: label === 'phone' ? 'dark' : 'light',
        extraHTTPHeaders: { 'cf-connecting-ip': `10.3.${label === 'phone' ? 1 : 0}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const host = await make('Hana');
    await host.getByRole('button', { name: 'Create a Reverie room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    await expect(host.getByText('Players (4/8)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    await expect(host.getByText('You are the storyteller')).toBeVisible();
    await shot(host, 'storyteller');
    const hand = (p: Page) =>
      p.getByRole('region', { name: 'Your hand' }).getByRole('button', { name: /^Card / });
    await hand(host).first().click();
    await shot(host, 'card-viewer');
    await host.getByRole('button', { name: 'Tell a story with this card' }).click();
    await host.getByPlaceholder('A word, a line, a feeling…').fill('a quiet storm');
    await host.getByRole('button', { name: 'Tell', exact: true }).click();
    const ana = others[0]!;
    await expect(ana.getByText('Give a card from your hand')).toBeVisible();
    await shot(ana, 'give');
    for (const p of others) {
      await hand(p).first().click();
      await p.getByRole('button', { name: 'Give this card' }).click();
      await p.getByRole('button', { name: 'Give this card' }).click();
    }
    await expect(ana.getByText(/Tap a card to vote/)).toBeVisible();
    await shot(ana, 'vote');
    for (const p of others) {
      const cards = p
        .getByRole('region', { name: 'Table' })
        .getByRole('button', { name: /^Card / });
      for (let i = 0; i < (await cards.count()); i++) {
        await cards.nth(i).click();
        const btn = p.getByRole('button', { name: `Vote for #${i + 1}` });
        if (await btn.isVisible()) {
          await btn.click();
          break;
        }
        await p.keyboard.press('Escape');
      }
    }
    await expect(host.getByText('Cards revealed!')).toBeVisible();
    await shot(host, 'reveal');
  });
}
