import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  PHONE,
  drawAndSend,
  importPacks,
  like,
  pairTableScreen,
  pick,
  results,
  scoreOf,
  table,
  writeLie,
} from './sketchy-play.ts';
import { pageErrors } from './tavern-brawl-play.ts';

// A whole Sketchy game on phones, on the rigged deal (`sketchy-play.ts`): prompts in seat order, a
// reroll, the truth refused as a lie, likes, the scoring with a streak, and the end.
// Only what stays on screen is checked (the one-by-one reveal is gone a few seconds later).

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

test('three players play Sketchy on phones: drawings, fake titles, likes, scores and the end', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  cleanup.push(await importPacks(browser));
  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], PHONE)) as [
    Page,
    Page,
    Page,
  ];
  const all = [hana, ben, cleo];

  // Reminder timers (the default), so a slow machine never has a clock decide for anyone.
  await hana.getByText('Timers', { exact: true }).click();
  await expect(hana.getByRole('switch', { name: /Strict timers/ })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await hana.getByRole('button', { name: 'Start game' }).click();

  // Round 1: secret prompts in seat order, lowercased. Ben swaps his once.
  await expect(hana.getByTestId('sketchy-prompt')).toHaveText('purple elephant');
  await expect(cleo.getByTestId('sketchy-prompt')).toHaveText('sad robot');
  await expect(ben.getByTestId('sketchy-prompt')).toHaveText('flying toaster');
  await ben.getByRole('button', { name: '🎲 New prompt' }).click();
  await ben.getByRole('button', { name: 'New prompt', exact: true }).click();
  await expect(ben.getByTestId('sketchy-prompt')).toHaveText('happy cloud');
  await expect(ben.getByRole('button', { name: '🎲 New prompt' })).toHaveCount(0);
  for (const p of all) await drawAndSend(p);

  // Drawing 1 is Hana's. The real title (or a spelling of it) is refused, privately.
  for (const p of all) await expect(p.getByText('Drawing 1/3')).toBeVisible();
  await expect(hana.getByText('You drew “purple elephant”. Shh!')).toBeVisible();
  await ben.getByTestId('sketchy-lie').fill('Purple Elephants');
  await ben.getByRole('button', { name: 'Send title' }).click();
  await expect(ben.getByText('Too close to the real title! Write a different one.')).toBeVisible();
  await writeLie(ben, 'grape monster');
  await writeLie(cleo, 'violet hippo');
  // Ben finds it and likes Cleo's; the artist likes Ben's; Cleo falls for Ben's.
  await pick(ben, 'purple elephant');
  await like(ben, 'violet hippo');
  await like(hana, 'grape monster');
  await pick(cleo, 'grape monster');
  await results(all, 'purple elephant');
  await expect(
    ben.getByTestId('reveal-board').getByRole('listitem').filter({ hasText: 'violet hippo' }),
  ).toContainText('👍 1');
  // Ben 1,000 + 500, Hana 1,000 as the artist (a phone shows the scores on their own tab).
  await cleo.getByTestId('tab-scores').click();
  await expect(scoreOf(cleo, 'Ben')).toContainText('1,500');
  await expect(scoreOf(cleo, 'Hana')).toContainText('1,000');
  await cleo.getByTestId('tab-play').click();
  await hana.getByTestId('sketchy-next').click();

  // Drawing 2 is Ben's: Hana and Cleo write their own titles (there is nothing ready-made to
  // fall back on); both find it.
  for (const p of all) await expect(p.getByText('Drawing 2/3')).toBeVisible();
  await expect(hana.getByRole('button', { name: /Lie for me/ })).toHaveCount(0);
  await writeLie(hana, 'fluffy puff');
  await writeLie(cleo, 'smiling sky');
  await pick(hana, 'happy cloud');
  await pick(cleo, 'happy cloud');
  await results(all, 'happy cloud');
  // Ben 1,500 + 2,000 as the artist.
  await hana.getByTestId('tab-scores').click();
  await expect(scoreOf(hana, 'Ben')).toContainText('3,500');
  await hana.getByTestId('tab-play').click();
  await hana.getByTestId('sketchy-next').click();

  // Drawing 3 is Cleo's: Hana and Ben both find it, on a streak of two (+100 each).
  for (const p of all) await expect(p.getByText('Drawing 3/3')).toBeVisible();
  await writeLie(hana, 'gloomy toaster');
  await writeLie(ben, 'crying tin can');
  await pick(hana, 'sad robot');
  await pick(ben, 'sad robot');
  await results(all, 'sad robot');
  // The points are folded away on a phone.
  await hana.getByText('Points for this drawing').click();
  await expect(hana.getByText(/found it \(1,000 \+ 100 streak\)/).first()).toBeVisible();
  await cleo.getByTestId('tab-scores').click();
  await expect(scoreOf(cleo, 'Hana')).toContainText('3,100');
  await expect(scoreOf(cleo, 'Ben')).toContainText('4,600');
  await expect(scoreOf(cleo, 'Cleo')).toContainText('3,000');
  await cleo.getByTestId('tab-play').click();
  await hana.getByTestId('sketchy-next').click();

  // Round 2: the next prompts in order. Every writer falls for the other writer's title.
  await expect(hana.getByTestId('sketchy-prompt')).toHaveText('tiny castle');
  await expect(ben.getByTestId('sketchy-prompt')).toHaveText('loud fish');
  await expect(cleo.getByTestId('sketchy-prompt')).toHaveText('jazz cat');
  for (const p of all) await drawAndSend(p);
  const rounds: [Page, string, [Page, string], [Page, string]][] = [
    [hana, 'tiny castle', [ben, 'small fort'], [cleo, 'little tower']],
    [ben, 'loud fish', [hana, 'noisy trout'], [cleo, 'shouting carp']],
    [cleo, 'jazz cat', [hana, 'cool kitten'], [ben, 'piano tiger']],
  ];
  for (const [i, [, prompt, [a, lieA], [b, lieB]]] of rounds.entries()) {
    for (const p of all) await expect(p.getByText(`Drawing ${i + 1}/3`)).toBeVisible();
    await writeLie(a, lieA);
    await writeLie(b, lieB);
    await pick(a, lieB);
    await pick(b, lieA);
    await results(all, prompt);
    await hana.getByTestId('sketchy-next').click();
  }

  // The end: standings, awards and every drawing, on every phone. Each writer fooled one player
  // twice in round 2: +1,000 each.
  for (const p of all) {
    await expect(p.getByTestId('sketchy-over')).toBeVisible();
    await expect(p.getByText('Final standings')).toBeVisible();
  }
  await expect(hana.getByText('Game over! Ben wins with 5,600 points.')).toBeVisible();
  await hana.getByTestId('tab-scores').click();
  await expect(scoreOf(hana, 'Ben')).toContainText('5,600');
  await expect(scoreOf(hana, 'Hana')).toContainText('4,100');
  await expect(scoreOf(hana, 'Cleo')).toContainText('4,000');
  await hana.getByTestId('tab-play').click();
  await cleo.getByText(/Every drawing \(6\)/).click();
  await expect(cleo.getByTestId('sketchy-history').getByRole('listitem')).toHaveCount(6);
  await expect(cleo.getByTestId('sketchy-history')).toContainText('drew “purple elephant”');
});

test('a table screen shows the drawing party while the phones go quiet', async ({ browser }) => {
  test.setTimeout(180_000);
  cleanup.push(await importPacks(browser));
  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], PHONE)) as [
    Page,
    Page,
    Page,
  ];
  const all = [hana, ben, cleo];
  const tv = await pairTableScreen(browser, hana);
  const stage = tv.getByTestId('sk-stage');
  for (const name of ['Hana', 'Ben', 'Cleo']) await expect(stage.getByText(name)).toBeVisible();

  // With a table screen paired, the sound goes to it until the host picks otherwise.
  await expect(
    hana.getByTestId('sketchy-sound-settings').getByRole('button', { name: 'Table screen' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await hana.getByRole('button', { name: 'Start game' }).click();
  await expect(stage).toHaveAttribute('data-phase', 'draw');
  await expect(stage.getByText('It’s drawing time!')).toBeVisible();
  for (const p of all) await drawAndSend(p);

  // Hana's drawing on the TV; the titles come in, then the choices.
  await expect(stage).toHaveAttribute('data-phase', 'turn');
  await expect(stage.getByTestId('sk-stage-drawing')).toBeVisible();
  await writeLie(ben, 'grape monster');
  await expect(stage.getByTestId('sk-stage-progress')).toHaveText('1 of 2 titles in');
  await writeLie(cleo, 'violet hippo');
  await expect(stage.getByText('violet hippo')).toBeVisible();
  await pick(ben, 'violet hippo');
  await pick(cleo, 'purple elephant');

  // The reveal on the TV: Cleo's lie turns over first, then the truth.
  const card = stage.getByTestId('sk-stage-card');
  await expect(card).toHaveAttribute('data-face', 'lie', { timeout: 10_000 });
  await expect(card).toHaveAttribute('data-face', 'truth', { timeout: 10_000 });
  // Then the board waits for Next: the real title and the scores stay up.
  await expect(stage.getByText('“purple elephant”')).toBeVisible({ timeout: 10_000 });
  // The scoreboard: Cleo found it and fooled Ben (1,500), Hana drew it (1,000).
  await expect(stage.getByText('Cleo · 1,500')).toBeVisible();
  await expect(stage.getByText('Hana · 1,000')).toBeVisible();
  // The phones stayed quiet: no reveal card of their own while the TV shows it.
  for (const p of all) await expect(p.getByTestId('sketchy-phone-card')).toHaveCount(0);
  await results(all, 'purple elephant');
});
