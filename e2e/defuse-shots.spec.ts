import { type Browser, type Page, expect } from '@playwright/test';
import { defuseAll, lightsOn, localArt, open, settings, table } from './defuse-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/defuse-shots.spec.ts
// With DEFUSE_ART=<folder holding manifest.json (or manifest-draft.json) and the art> the pages get
// the renders from disk; without it, modules are plain panels and words. Shots go to SHOTS_DIR.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/defuse-shots';
const KINDS = [
  'wires',
  'button',
  'keypad',
  'simon',
  'whos-on-first',
  'memory',
  'morse',
  'complicated-wires',
  'wire-sequence',
  'maze',
  'password',
  'venting-gas',
  'capacitor',
  'knob',
];

async function tv(browser: Browser, host: Page, look: Look, size = { width: 1280, height: 720 }) {
  await host.getByRole('button', { name: /^Players/ }).click();
  const panel = host
    .getByRole('dialog', { name: 'Players' })
    .getByRole('region', { name: /Table screen/ });
  await panel.getByRole('button', { name: 'Show a pairing code' }).click();
  const code = (await panel.getByTestId('stage-code').textContent())!;
  await host.keyboard.press('Escape');
  const page = await (
    await browser.newContext({ viewport: size, colorScheme: look.colorScheme })
  ).newPage();
  await look.setup?.(page);
  await page.goto('/stage');
  await page.getByLabel('Pairing code').fill(code);
  await page.getByRole('button', { name: 'Pair this screen' }).click();
  await page.getByRole('button', { name: '▶ Start the show' }).click();
  await page.evaluate(() => document.exitFullscreen().catch(() => {}));
  return page;
}

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  const phone = viewport.width < 1024;
  test(`defuse screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(500);
      await p.screenshot({ path: `${DIR}/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await shot(ana, '00-lobby');
    const screen = phone ? null : await tv(browser, ana, look);
    await ana.getByTestId('start').click();
    await lightsOn(ana);
    await shot(ana, '01-front');
    if (phone) {
      for (const v of ['rear', 'top', 'right', 'bottom', 'left']) {
        await ana.getByTestId(`view-${v}`).click();
        await shot(ana, `02-${v}`);
      }
    }
    for (const k of ['wires', 'keypad', 'password']) {
      await open(ana, k);
      await shot(ana, `03-zoom-${k}`);
    }
    // Expert side.
    await shot(ben, '10-expert-index');
    await ben.getByTestId('manual-search').fill('great');
    await shot(ben, '11-expert-search');
    await ben.getByTestId('index-password').click();
    await ben.getByRole('button', { name: 'Claim' }).click();
    await shot(ben, '12-expert-page');
    await ben.getByTestId('notes').fill('Serial ends in 2. Two batteries.');
    await ben.getByRole('button', { name: '◂ Index' }).click();
    await ben.getByTestId('manual-search').fill('');
    await ben.getByText('Who has claimed what').click();
    await shot(ben, '13-expert-claims');
    if (screen) await shot(screen, '20-table-manual');
    // A strike: the wrong wire.
    const zoom = await open(ana, 'wires');
    await zoom.getByTestId('wire-1').click();
    await expect(ana.getByTestId('strikes')).toHaveAttribute('data-strikes', '1');
    await shot(ana, '04-strike');
    await defuseAll(ana);
    await expect(ana.getByTestId('outcome')).toHaveText('Defused');
    await shot(ana, '05-defused');
    if (screen) await shot(screen, '21-table-result');
    // The table screen shows the bomb; Hardcore and a wrong cut set it off.
    await settings(ana);
    await ana.getByTestId('set-hardcore').click();
    if (screen) await ana.getByTestId('table-bomb').click();
    await ana.getByTestId('pick-Ana').click();
    await ana.getByTestId('next-bomb').click();
    await lightsOn(ana);
    if (screen) await shot(screen, '22-table-bomb');
    const z2 = await open(ana, 'wires');
    await z2.getByTestId('wire-1').click();
    await expect(ana.getByTestId('outcome')).toHaveText('Exploded');
    await shot(ana, '06-exploded');
    await shot(ben, '14-expert-result');
  });
}

// With the test seed, 11 modules draw a capacitor, 9 (three kinds left out) a gas vent, 7 a knob.
for (const [label, viewport, colorScheme, out, count] of [
  ['phone-light', { width: 390, height: 844 }, 'light', [], 11],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark', [], 11],
  ['phone-light', { width: 390, height: 844 }, 'light', ['Wires', 'Keypad', 'Password'], 9],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark', ['Wires', 'Keypad', 'Password'], 9],
  ['phone-light', { width: 390, height: 844 }, 'light', [], 7],
] as const) {
  test(`defuse every module (${label}, ${count}${out.length ? ', more' : ''})`, async ({
    browser,
  }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
    const look: Look = { viewport, colorScheme, setup: localArt };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await settings(ana);
    await ana.getByTestId('set-modules').selectOption(String(count));
    await ana.getByTestId('set-needy').click();
    if (out.length) {
      await ana.getByText(/^Leave out up to 3 kinds/).click();
      for (const name of out) await ana.getByRole('button', { name, exact: true }).click();
    }
    await ana.getByTestId('start').click();
    await lightsOn(ana);
    await ana.waitForTimeout(500);
    await ana.screenshot({
      path: `${DIR}/${label}-30-front-11-${count}${out.length ? '-more' : ''}.png`,
    });
    for (const k of KINDS) {
      const slot = ana.locator(`[data-testid^="slot-"]:has([data-kind="${k}"])`);
      if (!(await slot.count())) continue;
      await open(ana, k);
      await ana.waitForTimeout(400);
      await ana.screenshot({
        path: `${DIR}/${label}-31-${k}-${count}${out.length ? '-more' : ''}.png`,
      });
    }
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`defuse table screen and manual font (${colorScheme})`, async ({ browser }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
    const desk: Look = { viewport: { width: 1440, height: 900 }, colorScheme, setup: localArt };
    const phone: Look = { viewport: { width: 390, height: 844 }, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(800);
      await p.screenshot({ path: `${DIR}/tv-${colorScheme}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana, ben] = (await table(browser, ['Ana', 'Ben'], [desk, phone])) as [Page, Page];
    const screen = await tv(browser, ana, desk, { width: 1920, height: 1080 });
    await ana.getByTestId('start').click();
    await lightsOn(ana);
    await ben.getByTestId('index-password').click();
    await ben.getByRole('button', { name: 'Claim' }).click();
    await expect(ben.getByTestId('manual-text')).toHaveCSS('font-family', /DefuseManual/);
    await shot(ben, 'expert-page');
    await ben.getByRole('button', { name: '◂ Index' }).click();
    await ben.getByTestId('index-wires').click();
    await ben.getByRole('button', { name: 'Claim' }).click();
    await shot(screen, 'manual');
    await defuseAll(ana);
    await expect(ana.getByTestId('outcome')).toHaveText('Defused');
    await settings(ana);
    await ana.getByTestId('table-bomb').click();
    await ana.getByTestId('pick-Ana').click();
    await ana.getByTestId('next-bomb').click();
    await lightsOn(ana);
    await expect(screen.getByTestId('stage-bomb')).toBeVisible();
    await shot(screen, 'bomb');
  });
}
