import { type Page, expect } from '@playwright/test';
import { localArt, results, settings, table } from './defuse-play.ts';
import { call, ready, solve, tapAt } from './defuse-3d-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The room around the 3D bomb: the next defuser's briefcase starts the bomb, the room is dark
// until the modules wake, the lights go out (the e2e server puts lights out 40 s after each
// clock starts: DEFUSE_TEST_LIGHTS), the alarm clock rings and snoozes, and the binder's results
// page ends each bomb on every screen. Without the private room pack (as in CI) the briefcase is
// a plain box and there is no clock to pick up; with DEFUSE_ART it is the original's room.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const config = (p: Page) => call(p, 'config');

test('a bomb started from the briefcase and defused in the room, then one that goes off', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  // The host makes herself the defuser: she goes to the desk, where the briefcase shows the bomb.
  await ana.getByTestId('pick-Ana').click();
  await expect(ana.getByTestId('case-hint')).toHaveText('Click the briefcase to pick it up');
  await expect(ana.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
    timeout: 30_000,
  });
  await expect(ben.getByTestId('lobby')).toBeVisible();
  // Back to the lobby and to the desk again.
  await ana.getByTestId('desk-lobby').click();
  await ana.getByTestId('to-desk').click();
  await expect(ana.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/);
  await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  await expect.poll(() => call(ana, 'thing', 'case')).not.toBeNull();
  await tapAt(ana, await call(ana, 'thing', 'case'));
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  await expect(ana.getByTestId('case-hint')).toHaveText('Press START to begin');
  // The host turns the briefcase's keys and switches: the room's settings change for everyone.
  await call(ana, 'dial', 'time-up');
  await call(ana, 'dial', 'time-up');
  await call(ana, 'dial', 'time-down');
  await call(ana, 'dial', 'needy');
  await expect(ben.getByTestId('set-time')).toHaveValue('330');
  await expect(ben.getByTestId('set-needy')).toHaveAttribute('aria-checked', 'true');
  await call(ana, 'dial', 'needy');
  await expect(ben.getByTestId('set-needy')).toHaveAttribute('aria-checked', 'false');
  await call(ana, 'dial', 'time-down');
  await expect(ben.getByTestId('set-time')).toHaveValue('300');
  await ana.waitForTimeout(400);
  await tapAt(ana, await call(ana, 'thing', 'start'));

  // The start: black, then the dark room until the modules wake, then the lamp.
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 1');
  await expect(ana.getByTestId('start-fade')).toBeAttached();
  await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  await ready(ana);
  const started = (await call(ana, 'bomb')) as unknown as { startedAt: number; activeAt: number };
  expect(await call(ana, 'configAt', started.startedAt + 3000)).toBe('LightsOff');
  expect(await call(ana, 'configAt', started.activeAt + 100)).toBe('Normal');
  await expect.poll(() => config(ana)).toBe('Normal');

  // Lights out, 40 s after the clock started: the buzz, the dark, the buzz, the lights.
  await expect
    .poll(() => config(ana), { timeout: 60_000, intervals: [100] })
    .toMatch(/LightsOnBuzz|LightsOff/);
  await expect.poll(() => config(ana), { timeout: 5000, intervals: [100] }).toBe('LightsOff');
  await expect.poll(() => config(ana), { timeout: 15_000 }).toBe('Normal');

  if (await call(ana, 'room')) {
    // The alarm clock: picked up from the desk, its snooze sets it ringing and stops it.
    await tapAt(ana, await call(ana, 'thing', 'clock'));
    await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('clock');
    await ana.waitForTimeout(1500);
    await tapAt(ana, await call(ana, 'thing', 'snooze'));
    await expect
      .poll(async () => {
        const b = (await call(ana, 'bomb')) as unknown as { alarm: { at: number; until: number } };
        return b.alarm ? b.alarm.until - b.alarm.at : 0;
      })
      .toBe(20_000);
    await tapAt(ana, await call(ana, 'thing', 'snooze'));
    await expect
      .poll(async () => {
        const b = (await call(ana, 'bomb')) as unknown as { alarm: { at: number; until: number } };
        return b.alarm.until - b.alarm.at;
      })
      .toBeLessThan(20_000);
    await call(ana, 'back');
    await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('desk');
  }

  await solve(ana);
  // The defused room fades out, then the binder's page: DEFUSED and the time left.
  await expect(ana.getByTestId('end-fade')).toBeAttached();
  await expect(ben.getByTestId('binder-stamp')).toBeVisible({ timeout: 15_000 });
  await expect(ben.getByTestId('binder-page')).toContainText('Time Remaining:', {
    timeout: 10_000,
  });
  await expect(ben.getByTestId('binder-retry')).toHaveCount(0);
  await results(ben, 'Defused');
  await results(ana, 'Defused');

  // Hardcore: one wrong cut and it goes off in Ben's hands; every screen goes black, then the
  // page names what set it off. The host's Retry starts the next bomb.
  await settings(ana);
  await ana.getByTestId('set-hardcore').click();
  await ana.getByTestId('next-bomb').click();
  await ready(ben);
  const wires = (await call(ben, 'bomb')).modules.find((m) => m.kind === 'wires')!.id;
  await call(ben, 'focus', wires);
  await ben.waitForTimeout(400);
  await call(ben, 'press', await call(ben, 'partFor', wires, { op: 'cut', wire: 1 }));
  for (const p of [ana, ben]) await expect(p.getByTestId('binder')).toBeVisible();
  await expect(ana.getByTestId('binder-page')).toContainText('Cause of Explosion:', {
    timeout: 20_000,
  });
  await expect(ana.getByTestId('binder-outcome')).toHaveText('Exploded');
  await expect(ana.getByTestId('binder-page')).toContainText('Hardcore: ON');
  await expect(ben.getByTestId('binder')).toHaveAttribute('data-done', 'yes', { timeout: 20_000 });
  await expect(ben.getByTestId('binder-retry')).toHaveCount(0);
  await ana.getByTestId('binder-retry').click();
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 3');
});

test('anyone but the host who turns the briefcase’s keys is told so, and nothing changes', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  await ana.getByTestId('pick-Ben').click();
  await expect(ben.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
    timeout: 30_000,
  });
  await ben.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  await expect.poll(() => call(ben, 'thing', 'case')).not.toBeNull();
  await tapAt(ben, await call(ben, 'thing', 'case'));
  await expect.poll(async () => (await call(ben, 'pose')).pose).toBe('held');
  await call(ben, 'dial', 'modules-up');
  await expect(ben.getByTestId('case-hint')).toHaveText('Only the host can change the settings');
  await expect(ana.getByTestId('set-modules')).toHaveValue('3');
  // The note goes after a few seconds.
  await expect(ben.getByTestId('case-hint')).toHaveText('Press START to begin', { timeout: 6000 });
});

test('under a mission the desk holds the bomb binder at its page, and its START starts it', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  await settings(ana);
  await ana.getByTestId('set-mission').selectOption('s1-1');
  await ana.getByTestId('pick-Ana').click();
  await expect(ana.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
    timeout: 30_000,
  });
  await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  // No Free Play briefcase: the binder, as the original starts a mission.
  expect(await call(ana, 'desk')).toBe('binder');
  await expect(ana.getByTestId('case-hint')).toHaveText('Click the binder to pick it up');
  await expect.poll(() => call(ana, 'thing', 'case')).not.toBeNull();
  await tapAt(ana, await call(ana, 'thing', 'case'));
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  await expect(ana.getByTestId('case-hint')).toHaveText('Press START to begin');
  // The briefcase's dials aren't there to turn.
  await call(ana, 'dial', 'modules-up');
  await ana.waitForTimeout(600);
  await expect(ana.getByTestId('case-hint')).toHaveText('Press START to begin');
  await expect(ben.getByTestId('lobby')).toContainText('Mission 1.1');
  await tapAt(ana, await call(ana, 'thing', 'start'));
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 1');
  await ana.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  await expect.poll(async () => (await call(ana, 'bomb'))?.mission).toBe('s1-1');
});

test('the host can switch the room’s surprises off', async ({ browser }) => {
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  await settings(ana);
  await expect(ana.getByTestId('set-surprises')).toHaveAttribute('aria-checked', 'true');
  await ana.getByTestId('set-surprises').click();
  await expect(ana.getByTestId('set-surprises')).toHaveAttribute('aria-checked', 'false');
});
