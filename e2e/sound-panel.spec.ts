import { randomBytes } from 'node:crypto';
import { type Browser, type Page, expect } from '@playwright/test';
import { TEST_BACKROOM_WORD } from './credentials.ts';
import { test } from './fixtures.ts';
import { openBackroom } from './tavern-brawl-play.ts';

// Every game with sound has the same Sound section in its lobby: each player's own volume sliders
// for the sound that plays on their phone under the host's choice, a ▶ preview per type, and the
// line saying where the room's sound plays. The back room's games need its password, so this runs
// in the `back-room` project.

const PHONE = { width: 390, height: 844 };
const pageErrors: string[] = [];
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  pageErrors.length = 0;
});

test.beforeAll(async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await openBackroom(admin);
  await admin.context().close();
});

let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const token = randomBytes(16).toString('hex');
  const context = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.61.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.addInitScript(
    ([n, t]) => {
      localStorage.setItem('vt.playerName', n!);
      localStorage.setItem('vt.playerToken', t!);
    },
    [name, token],
  );
  await page.goto('/backroom');
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
  await expect(page.getByLabel('The word')).toHaveCount(0);
  return { page, token };
}

async function room(browser: Browser, gameId: string) {
  const { page: host, token } = await visitor(browser, 'Hana');
  const res = await host.context().request.post('/api/rooms', { data: { gameId, token } });
  expect(res.status()).toBe(200);
  const { roomId } = (await res.json()) as { roomId: string };
  await host.goto(`/r/${roomId}`);
  const { page: guest } = await visitor(browser, 'Gil');
  await guest.goto(`/r/${roomId}`);
  await expect(host.getByRole('button', { name: /^Players \(2 online\)/ })).toBeVisible();
  return { host, guest };
}

const openSound = async (page: Page) => {
  const section = page.getByTestId('lobby-sound');
  await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
  return section;
};

const sliders = (page: Page) =>
  page
    .getByTestId('lobby-sound')
    .locator('input[type=range]')
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')!.replace('sound-slider-', '')),
    );

/** Each game, with the sliders its host and a guest get in a new room (the host's defaults). */
const GAMES: { id: string; host: string[]; guest: string[]; where: RegExp; preview?: string }[] = [
  // Every device by default; the voice is the host's switch (off), so no Voice slider yet.
  {
    id: 'going-once',
    host: ['master', 'music', 'effects'],
    guest: ['master', 'music', 'effects'],
    where: /every phone/,
  },
  // The host's device by default: a guest keeps only their own little sounds.
  {
    id: 'sketchy',
    host: ['master', 'music', 'effects', 'voice'],
    guest: ['effects'],
    where: /Hana’s phone/,
  },
  // Narration on the host's device; no music without the manifest's tracks.
  { id: 'nightfall', host: ['voice'], guest: [], where: /Hana’s phone/ },
  // Anyone may defuse next.
  {
    id: 'defuse',
    host: ['master', 'music', 'effects'],
    guest: ['master', 'music', 'effects'],
    where: /defuser’s phone/,
  },
  // Effects made on the phone: the preview plays without any files.
  {
    id: 'hydra',
    host: ['effects'],
    guest: ['effects'],
    where: /your own phone/,
    preview: 'effects',
  },
  {
    id: 'hogwarts',
    host: ['effects'],
    guest: ['effects'],
    where: /your own phone/,
    preview: 'effects',
  },
  {
    id: 'short-fuse',
    host: ['effects'],
    guest: ['effects'],
    where: /your own phone/,
    preview: 'effects',
  },
];

for (const g of GAMES)
  test(`${g.id}: everyone's own sound sliders in the lobby`, async ({ browser }) => {
    const { host, guest } = await room(browser, g.id);
    // Folded, the lobby still fits the phone.
    await expect(host.getByTestId('lobby-sound')).toBeVisible();
    await expect
      .poll(() => host.evaluate(() => document.scrollingElement!.scrollWidth))
      .toBeLessThanOrEqual(PHONE.width);

    const hostPanel = await openSound(host);
    const guestPanel = await openSound(guest);
    await expect(guestPanel.getByTestId('sound-where')).toHaveText(g.where);
    await expect.poll(() => sliders(host)).toEqual(g.host);
    await expect.poll(() => sliders(guest)).toEqual(g.guest);

    // Sliders and previews are at least 44 px tall.
    const first = hostPanel.locator('input[type=range]').first();
    expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const play = hostPanel.locator('[data-testid^=sound-preview-]').first();
    expect((await play.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // A volume is the player's own and stays on this device.
    const last = g.host.at(-1)!;
    await host.getByTestId(`sound-slider-${last}`).fill('40');
    await expect(host.getByTestId(`sound-row-${last}`)).toContainText('40 %');
    if (process.env.SCREENSHOTS)
      await host.screenshot({ path: test.info().outputPath('panel.png') });
    await host.reload();
    await openSound(host);
    await expect(host.getByTestId(`sound-slider-${last}`)).toHaveValue('40');

    // The ▶ plays the game's own clip only on a tap, and a second tap stops it.
    if (g.preview) {
      const button = host.getByTestId(`sound-preview-${g.preview}`);
      await expect(button).toBeEnabled();
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    } else {
      // Without the private sound files there is no clip to play.
      await expect(host.getByTestId(`sound-preview-${last}`)).toBeDisabled();
    }
    await host.context().close();
    await guest.context().close();
  });

test('sketchy: sliders follow the host’s choice of where sound plays, live', async ({
  browser,
}) => {
  const { host, guest } = await room(browser, 'sketchy');
  await openSound(guest);
  await expect.poll(() => sliders(guest)).toEqual(['effects']);
  const settings = host.getByTestId('host-settings');
  if ((await settings.getAttribute('open')) === null)
    await settings.locator('summary').first().click();
  const choice = host.getByTestId('sketchy-sound-settings');
  await choice.getByRole('button', { name: 'Every device' }).click();
  await expect.poll(() => sliders(guest)).toEqual(['master', 'music', 'effects', 'voice']);
  await expect(guest.getByTestId('sound-where')).toHaveText(/every phone/);
  await choice.getByRole('button', { name: 'Off' }).click();
  await expect.poll(() => sliders(guest)).toEqual([]);
  await expect(guest.getByTestId('sound-where')).toHaveText(/Sound is off/);
  await host.context().close();
  await guest.context().close();
});
