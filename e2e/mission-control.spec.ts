import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { PHONE, brief, claim, dive, importPacks, play, table } from './mission-control-play.ts';
import { pageErrors } from './tavern-brawl-play.ts';

// Mission Control on phones, on the test deal (`mission-control-play.ts`): Hana holds every pink
// card and the trumps, so she is captain and wins any pink lead. Only lasting state is checked.

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

test('a crew of three completes a mission: briefing, free selection, a signal and the logbook stamp', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  cleanup.push(await importPacks(browser));
  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], PHONE)) as [
    Page,
    Page,
    Page,
  ];
  const all = [hana, ben, cleo];
  await expect(hana.getByTestId('logbook')).toContainText('Shakedown');
  await brief(all);

  // Free selection: Hana takes both tasks.
  await expect(hana.getByText('Talk about the tasks, never about your cards.')).toBeVisible();
  await claim(hana, 'Take the pink 3');
  await claim(hana, 'Take trick one');
  await dive(all);

  // Ben signals his highest blue before the first trick; everyone sees it.
  await ben.getByTestId('mc-signal').click();
  await ben.getByTestId('mc-signal-b9-top').click();
  for (const p of all) await expect(p.getByText('▲ highest').first()).toBeVisible();
  await expect(ben.getByTestId('mc-signal')).toBeDisabled();

  // Hana leads the pink 3; nobody else has pink, so it wins and both tasks are met at once.
  await play(hana, 'p3');
  await play(ben, 'b2');
  await play(cleo, 'g6');
  for (const p of all) {
    await expect(p.getByTestId('mc-debrief')).toHaveAttribute('data-result', 'success');
    await expect(p.getByTestId('mc-stamp')).toContainText('done in 1 attempt');
  }

  // The logbook marks the mission done.
  await hana.getByRole('button', { name: '📘 Logbook and settings' }).click();
  await expect(hana.getByTestId('logbook-1')).toContainText('✅');
  await expect(hana.getByTestId('depth-strip')).toContainText('1/2 missions done');
});

test('a failed attempt says why, shows the replay, and retries with the same tasks', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  cleanup.push(await importPacks(browser));
  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], PHONE)) as [
    Page,
    Page,
    Page,
  ];
  const all = [hana, ben, cleo];
  await brief(all);
  await claim(hana, 'Take trick one');
  await claim(ben, 'Take the pink 3');
  await dive(all);

  // Following suit: Ben has no pink, Cleo neither, so their whole hands are open to them.
  await play(hana, 'p3');
  await play(ben, 'b2');
  await play(cleo, 'g6');
  for (const p of all) {
    await expect(p.getByTestId('mc-debrief')).toHaveAttribute('data-result', 'failure');
    await expect(p.getByTestId('mc-why')).toContainText('Hana won');
  }

  // The post-mortem shows every hand and the trick where it was lost.
  await cleo.getByTestId('mc-replay-open').click();
  await expect(cleo.getByTestId('mc-replay')).toContainText('the attempt was lost here');

  // Retry with the same tasks: back to sharing them out, attempt 2.
  await ben.getByTestId('mc-retry-same').click();
  for (const p of all) {
    await expect(p.getByTestId('mc-draft')).toBeVisible();
    await expect(p.getByText('Try 2')).toBeVisible();
    await expect(p.getByTestId('mc-task').filter({ hasText: 'Take the pink 3' })).toContainText(
      'Not taken',
    );
  }
});
