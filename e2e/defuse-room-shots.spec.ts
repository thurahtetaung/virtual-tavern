import { type Page, expect } from '@playwright/test';
import { localArt, settings, table } from './defuse-play.ts';
import { call, ready, solve, tapAt } from './defuse-3d-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check and measurements of the room around the 3D bomb:
//   SCREENSHOTS=1 DEFUSE_ART=<folder with manifest-draft.json, the 3D pack and the room pack>
//   pnpm exec playwright test e2e/defuse-room-shots.spec.ts
// Shots go to SHOTS_DIR; the frame rate and memory lines go to the log (one JSON line each).
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/defuse-room-shots';

async function measure(p: Page, label: string) {
  await p.waitForTimeout(3000);
  const info = await p.evaluate(() => {
    const h = (window as unknown as { __defuse3d?: { info: () => Record<string, unknown> } })
      .__defuse3d;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return { ...(h?.info() ?? {}), heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null };
  });
  console.log(JSON.stringify({ measure: label, ...info }));
}

for (const [label, viewport] of [
  ['phone-sideways', { width: 844, height: 390 }],
  ['phone-upright', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
] as const) {
  test(`defuse room screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 600_000));
    const touch = viewport.width < 1024;
    const look: Look = { viewport, colorScheme: 'dark', setup: localArt, touch };
    const shot = async (p: Page, name: string, wait = 700) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `${DIR}/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
    await ana.getByTestId('pick-Ana').click();
    await expect(ana.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
      timeout: 60_000,
    });
    await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
    await shot(ana, '01-desk-briefcase', 1500);
    await tapAt(ana, await call(ana, 'thing', 'case'));
    await shot(ana, '02-briefcase-held');
    await tapAt(ana, await call(ana, 'thing', 'start'));
    await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
    await shot(ana, '03-start-black', 300);
    await ana.waitForTimeout(2200);
    await shot(ana, '04-start-dark-timer', 0);
    await ready(ana);
    await shot(ana, '05-lights-on', 1500);
    await measure(ana, `${label} desk`);
    await expect
      .poll(() => call(ana, 'config'), { timeout: 60_000, intervals: [100] })
      .toMatch(/LightsOnBuzz|LightsOff/);
    await shot(ana, '09-lights-buzz', 300);
    await expect
      .poll(() => call(ana, 'config'), { timeout: 5000, intervals: [100] })
      .toBe('LightsOff');
    await shot(ana, '10-lights-out-desk', 1500);
    await call(ana, 'pickUp');
    await shot(ana, '11-lights-out-held', 800);
    await call(ana, 'back');
    await expect.poll(() => call(ana, 'config'), { timeout: 15_000 }).toBe('Normal');
    if (await call(ana, 'room')) {
      await tapAt(ana, await call(ana, 'thing', 'clock'));
      await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('clock');
      await ana.waitForTimeout(1500);
      await tapAt(ana, await call(ana, 'thing', 'snooze'));
      await shot(ana, '06-clock-ringing-held', 900);
      await call(ana, 'back');
      await shot(ana, '07-clock-ringing-desk', 900);
    }
    await call(ana, 'pickUp');
    await shot(ana, '08-held');
    await measure(ana, `${label} held`);
    await solve(ana);
    await shot(ana, '12-defused-room', 1000);
    await expect(ana.getByTestId('binder')).toHaveAttribute('data-done', 'yes', {
      timeout: 40_000,
    });
    await shot(ana, '13-binder-defused', 300);
    await shot(ben, '14-expert-binder-defused', 300);
    await ana.getByTestId('binder-back').click();
    // Hardcore: a wrong cut in Ben's hands.
    await settings(ana);
    await ana.getByTestId('set-hardcore').click();
    await ana.getByTestId('next-bomb').click();
    await ready(ben);
    const wires = (await call(ben, 'bomb')).modules.find((m) => m.kind === 'wires')!.id;
    await call(ben, 'focus', wires);
    await ben.waitForTimeout(400);
    await call(ben, 'press', await call(ben, 'partFor', wires, { op: 'cut', wire: 1 }));
    await expect(ana.getByTestId('binder-stamp')).toBeVisible({ timeout: 20_000 });
    await shot(ana, '15-binder-exploded-stamp', 200);
    await expect(ana.getByTestId('binder')).toHaveAttribute('data-done', 'yes', {
      timeout: 30_000,
    });
    await shot(ana, '16-binder-exploded', 300);
  });
}

test('defuse briefcase shots (the host’s dials, the non-host’s note while looking around)', async ({
  browser,
}) => {
  test.setTimeout(Number(process.env.SHOT_TIMEOUT ?? 300_000));
  const look: Look = {
    viewport: { width: 844, height: 390 },
    colorScheme: 'dark',
    setup: localArt,
    touch: true,
  };
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], look)) as [Page, Page];
  const holdCase = async (p: Page) => {
    await expect(p.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
      timeout: 60_000,
    });
    await p.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
    await expect.poll(() => call(p, 'thing', 'case')).not.toBeNull();
    await tapAt(p, await call(p, 'thing', 'case'));
    await expect.poll(async () => (await call(p, 'pose')).pose).toBe('held');
    await p.waitForTimeout(1200);
  };
  // The host at the desk turns the time up and the needy switch on.
  await ana.getByTestId('pick-Ana').click();
  await holdCase(ana);
  await call(ana, 'dial', 'time-up');
  await call(ana, 'dial', 'needy');
  await expect(ben.getByTestId('set-time')).toHaveValue('330');
  await ana.waitForTimeout(800);
  await ana.screenshot({ path: `${DIR}/briefcase-host-dial.png` });
  // Ben at the desk: his turn is refused with a note, while he drags off the case to look around.
  await call(ana, 'back');
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('desk');
  await ana.getByTestId('desk-lobby').click();
  await ana.getByTestId('pick-Ben').click();
  await holdCase(ben);
  const cdp = await ben.context().newCDPSession(ben);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await touch('touchStart', 100, 80);
  for (let i = 1; i <= 8; i++) await touch('touchMove', 100 + i * 45, 80 + i * 12);
  await expect.poll(async () => (await call(ben, 'glance'))[0]).toBeGreaterThan(0.4);
  await call(ben, 'dial', 'modules-up');
  await expect(ben.getByTestId('case-hint')).toHaveText('Only the host can change the settings');
  await ben.screenshot({ path: `${DIR}/briefcase-guest-note-glance.png` });
  await touch('touchEnd');
});
