import { type Browser, type Page, expect, test } from '@playwright/test';

type TeamName = 'Red' | 'Blue';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/') {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const transmission = (page: Page, team: TeamName) =>
  page.locator(`[aria-label="${team}'s transmission"]`);

/** Of a team's players, the one who currently has the clue form for that team. */
/** Of a team's players, the one who gets the clue form. Waits for the new round to render. */
async function encryptorOf(pages: Page[], team: TeamName) {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const p of pages) {
          if (await transmission(p, team).getByText('Your secret code').isVisible()) found = p;
        }
        return found !== undefined;
      },
      { message: `waiting for a ${team} Encryptor`, timeout: 10_000 },
    )
    .toBe(true);
  return found!;
}

async function sendClues(encryptor: Page, team: TeamName) {
  const tx = transmission(encryptor, team);
  const code = (await tx.locator('.font-mono').first().innerText()).split('-').map(Number);
  const inputs = tx.getByPlaceholder('A hint only your team will get');
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(`clue ${code[i]}`);
  await tx.getByRole('button', { name: 'Send clues' }).click();
  return code;
}

async function pick(page: Page, team: TeamName, code: number[]) {
  const tx = transmission(page, team);
  for (let i = 0; i < 3; i++) {
    await tx.getByRole('button', { name: `Clue ${i + 1} is keyword ${code[i]}` }).click();
    await expect(
      tx.getByRole('button', { name: `Clue ${i + 1} is keyword ${code[i]}` }),
    ).toHaveAttribute('aria-pressed', 'true');
  }
  await tx.getByRole('button', { name: /^Lock in/ }).click();
}

const wrong = (code: number[]) => [code[1]!, code[2]!, code[0]!];

test('two teams play Enigma until Red intercepts twice', async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create an Enigma room' }).click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const url = host.url();
  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, url)),
  );
  const red = [host, ana!];
  const blue = [ben!, cy!];

  await host.getByRole('button', { name: 'Join Red' }).click();
  await ana!.getByRole('button', { name: 'Join Red' }).click();
  await ben!.getByRole('button', { name: 'Join Blue' }).click();
  await cy!.getByRole('button', { name: 'Join Blue' }).click();
  await expect(host.getByText('Everyone is in')).toBeVisible();
  // The word-list summary describes Enigma, not a 25-word board.
  await expect(ben!.getByText(/Each team gets 4 secret keywords from this list/)).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // The scoreboard spells out the round and, in round 1, what its icons mean.
  await expect(cy!.getByRole('button', { name: /Round 1 of 8/ })).toBeVisible();
  await expect(
    cy!.getByText('🕵️ interceptions: 2 wins · 💥 miscommunications: 2 loses'),
  ).toBeVisible();

  // Team chat is private.
  await expect(host.getByText('Your keywords')).toBeVisible();
  await host.getByLabel('Message your team').fill('red only: their 2 is food');
  await host.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(ana!.getByText('red only: their 2 is food')).toBeVisible();
  await expect(ben!.getByText('Red team chat')).toHaveCount(0);
  await expect(ben!.getByText('red only: their 2 is food')).toHaveCount(0);

  // Shared notes reach teammates but not the other team. The note is a made-up word, so it can
  // never also be one of the dealt keywords.
  await ben!.getByLabel('Our guess for Red keyword 1').fill('Zorblax');
  await ben!.getByLabel('Our guess for Red keyword 1').blur();
  await expect(cy!.getByLabel('Our guess for Red keyword 1')).toHaveValue('Zorblax');
  await expect(host.getByText('Zorblax')).toHaveCount(0);

  // Two teammates add notes at the same time, and both notes survive.
  const addNote = async (page: Page, text: string) => {
    await page.getByLabel('Add a note').fill(text);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  };
  await Promise.all([addNote(ben!, 'Quuxle maybe'), addNote(cy!, 'Wibbleton surely')]);
  for (const p of [ben!, cy!]) {
    const notes = p.getByRole('list', { name: 'Team notes' });
    await expect(notes.getByText('Quuxle maybe')).toBeVisible();
    await expect(notes.getByText('Wibbleton surely')).toBeVisible();
  }
  await expect(host.getByText('Wibbleton')).toHaveCount(0);

  // Ben starts typing a guess while Cy saves a different one: Cy's is kept, Ben is told, and his
  // own text stays on screen to use instead.
  const benGuess = ben!.getByLabel('Our guess for Red keyword 2');
  await benGuess.fill('Frobnic');
  await cy!.getByLabel('Our guess for Red keyword 2').fill('Grumple');
  await cy!.getByLabel('Our guess for Red keyword 2').press('Enter');
  // Cy's next action can only reach Ben once Cy's guess is saved.
  await addNote(cy!, 'Plinth');
  await expect(ben!.getByText('Plinth')).toBeVisible();
  await expect(benGuess).toHaveValue('Frobnic');
  await benGuess.press('Enter');
  await expect(ben!.getByText('Cy just changed this')).toBeVisible();
  await expect(benGuess).toHaveValue('Grumple');
  await expect(cy!.getByLabel('Our guess for Red keyword 2')).toHaveValue('Grumple');
  await expect(ben!.getByText('Your version:')).toContainText('Frobnic');
  // Using it replaces Cy's guess, on purpose this time.
  await ben!.getByRole('button', { name: '(use it)' }).click();
  await expect(cy!.getByLabel('Our guess for Red keyword 2')).toHaveValue('Frobnic');
  await expect(ben!.getByText('Your version:')).toHaveCount(0);
  // Anyone on the team can remove a note.
  await cy!.getByRole('button', { name: 'Remove note: Plinth' }).click();
  await expect(ben!.getByText('Plinth')).toHaveCount(0);

  for (let round = 1; round <= 3; round++) {
    const redEnc = await encryptorOf(red, 'Red');
    const blueEnc = await encryptorOf(blue, 'Blue');
    const redCode = await sendClues(redEnc, 'Red');
    const blueCode = await sendClues(blueEnc, 'Blue');
    const redDecoder = red.find((p) => p !== redEnc)!;
    const blueDecoder = blue.find((p) => p !== blueEnc)!;

    if (round >= 2) {
      // Interceptors see the other team's past clues right above the picker.
      await expect(transmission(red[0]!, 'Blue').getByText('Their past clues')).toBeVisible();
      // Red intercepts Blue: both Red players must agree. Teammates see each other's picks live.
      await pick(red[0]!, 'Blue', blueCode);
      if (redEnc === red[0]) {
        // Hana has nothing left to do, so she's told who she's waiting for instead.
        await expect(host.getByText("Locked in on Blue's code. Waiting for: Ana.")).toBeVisible();
      }
      await expect(
        transmission(red[1]!, 'Blue').getByText(`Hana ${blueCode.join('-')} 🔒`),
      ).toBeVisible();
      await pick(red[1]!, 'Blue', blueCode);
      // Blue tries to intercept Red, and gets it wrong.
      for (const p of blue) await pick(p, 'Red', wrong(redCode));
    }
    await pick(redDecoder, 'Red', redCode);
    await pick(blueDecoder, 'Blue', blueCode);

    await expect(host.getByText('The code was').first()).toBeVisible();
    await expect(host.getByText('✓ Red decoded it.')).toBeVisible();
    if (round >= 2) {
      await expect(
        cy!.getByText(`🕵️ Red intercepted it! Red gets 🕵️ (${round - 1} of 2).`),
      ).toBeVisible();
    }
    if (round < 3) await host.getByRole('button', { name: 'Next round' }).click();
  }

  // The deciding reveal says so, and the host's button leads to the results.
  await expect(ben!.getByText(/Red wins! Red intercepted 2 codes\./)).toBeVisible();
  await host.getByRole('button', { name: 'See results' }).click();

  await expect(host.getByText('🏆 Red team wins!')).toBeVisible();
  await expect(ben!.getByText('Red intercepted 2 codes.', { exact: true })).toBeVisible();
  await expect(ben!.getByText('Red team wins!')).toHaveCount(1);
  // The last round's reveal stays on screen.
  await expect(ben!.getByRole('region', { name: 'The last round' })).toBeVisible();
  // Everyone's keywords are revealed at the end.
  await expect(ben!.getByText('Your keywords')).toBeVisible();
  await expect(ben!.getByText("Red's keywords")).toBeVisible();
});

test('fast taps on a slow connection still lock in the full code', async ({ browser }) => {
  test.setTimeout(90_000);
  // Delay everything the server sends by 300 ms, like a real phone connection.
  const laggy = async (name: string, url = '/') => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.routeWebSocket(/socket\.io/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => server.send(m));
      server.onMessage((m) => void setTimeout(() => ws.send(m), 300));
    });
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const host = await laggy('Hana');
  await host.getByRole('button', { name: 'Create an Enigma room' }).click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const [ana, ben, cy] = await Promise.all(['Ana', 'Ben', 'Cy'].map((n) => laggy(n, host.url())));
  await host.getByRole('button', { name: 'Join Red' }).click();
  await ana!.getByRole('button', { name: 'Join Red' }).click();
  await ben!.getByRole('button', { name: 'Join Blue' }).click();
  await cy!.getByRole('button', { name: 'Join Blue' }).click();
  await expect(host.getByText('Everyone is in')).toBeVisible();
  // The word-list summary describes Enigma, not a 25-word board.
  await expect(ben!.getByText(/Each team gets 4 secret keywords from this list/)).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // The scoreboard spells out the round and, in round 1, what its icons mean.
  await expect(cy!.getByRole('button', { name: /Round 1 of 8/ })).toBeVisible();
  await expect(
    cy!.getByText('🕵️ interceptions: 2 wins · 💥 miscommunications: 2 loses'),
  ).toBeVisible();
  await expect(host.getByText('Your keywords')).toBeVisible();

  const red = [host, ana!];
  const enc = await encryptorOf(red, 'Red');
  const code = await sendClues(enc, 'Red');
  await sendClues(await encryptorOf([ben!, cy!], 'Blue'), 'Blue');
  const decoder = red.find((p) => p !== enc)!;
  const tx = transmission(decoder, 'Red');
  await expect(tx.getByRole('button', { name: 'Clue 1 is keyword 1' })).toBeVisible();
  // Tap all three numbers back to back, without waiting for the server.
  for (let i = 0; i < 3; i++) {
    await tx
      .getByRole('button', { name: `Clue ${i + 1} is keyword ${code[i]}` })
      .click({ delay: 0 });
  }
  await tx.getByRole('button', { name: `Lock in ${code.join('-')}` }).click();
  // Red's only decoder locking in settles the vote straight away.
  await expect(tx.getByText('Your team has locked in')).toBeVisible();
});
