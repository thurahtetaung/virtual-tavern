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

/** A team may only give a clue once per game, so every set of clues gets its own word. */
const FRESH =
  'echo golf hotel india kilo lima mike oscar papa romeo sierra tango maple cedar birch aspen willow hazel rowan alder larch spruce poplar yew'.split(
    ' ',
  );
let sent = 0;

async function sendClues(encryptor: Page, team: TeamName) {
  const tx = transmission(encryptor, team);
  // Covered until the Encryptor shows it.
  await expect(tx.locator('.font-mono')).toHaveCount(0);
  await expect(tx.getByText(/points to/)).toHaveCount(0);
  await tx.getByRole('button', { name: '👁️ Show your code' }).click();
  const code = (await tx.locator('.font-mono').first().innerText()).split('-').map(Number);
  const inputs = tx.getByPlaceholder('A hint only your team will get');
  // Clues can't contain numbers, so each one names its digit with a letter word.
  const words = ['alpha', 'bravo', 'charlie', 'delta'];
  const fresh = FRESH[sent++ % FRESH.length];
  for (let i = 0; i < 3; i++) await inputs.nth(i).fill(`clue ${words[code[i]! - 1]} ${fresh}`);
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

  // Team chat is private. Hana is Red's first Encryptor, so she stays quiet until the codes are revealed.
  await expect(host.getByText('Your keywords')).toBeVisible();
  await expect(host.getByLabel('Message your team')).toBeDisabled();
  await ana!.getByLabel('Message your team').fill('red only: their 2 is food');
  await ana!.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(host.getByText('red only: their 2 is food')).toBeVisible();
  await expect(ben!.getByText('Red team chat')).toHaveCount(0);
  await expect(ben!.getByText('red only: their 2 is food')).toHaveCount(0);

  // Shared notes reach teammates but not the other team. The note is a made-up word, so it can
  // never also be one of the dealt keywords.
  // Blue's Encryptor can't edit notes yet, so the other Blue player writes it.
  const blueEnc1 = await encryptorOf(blue, 'Blue');
  const blueWriter = blue.find((p) => p !== blueEnc1)!;
  await blueWriter.getByLabel('Our guess for Red keyword 1').fill('Zorblax');
  await blueWriter.getByLabel('Our guess for Red keyword 1').blur();
  await expect(blueEnc1.getByLabel('Our guess for Red keyword 1')).toHaveValue('Zorblax');
  // The muted Encryptor's note fields are greyed out, with a hint saying why.
  await expect(blueEnc1.getByLabel('Our guess for Red keyword 1')).toBeDisabled();
  await expect(blueEnc1.getByLabel('Add a note')).toBeDisabled();
  await expect(
    blueEnc1.getByText('The Encryptor can’t edit notes until the codes are revealed.').first(),
  ).toBeVisible();
  await expect(blueWriter.getByLabel('Add a note')).toBeEnabled();
  await expect(host.getByText('Zorblax')).toHaveCount(0);

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
      // Each pick shows as three little boxes, read out digit by digit.
      const hana = transmission(red[1]!, 'Blue').getByRole('listitem').filter({ hasText: 'Hana' });
      await expect(hana.getByRole('img', { name: blueCode.join(', ') })).toBeVisible();
      await expect(hana).toContainText('🔒');
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
    if (round === 1) {
      // Notes are tested once everyone's code is revealed: until it is revealed, an
      // Encryptor can't edit the notes.
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
  await expect(tx.getByText(`Your team is locked on ${code.join('-')}`)).toBeVisible();
});

test('a team can reopen an agreed code, and a mid-round end waits for the round', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const phone = async (name: string, url = '/') => {
    const page = await (
      await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
    ).newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const shot = async (page: Page, name: string) => {
    if (process.env.SCREENSHOTS) {
      await page.screenshot({ path: `test-results/shots/enigma-phone-${name}.png` });
    }
  };
  const host = await phone('Hana');
  await host.getByRole('button', { name: 'Create an Enigma room' }).click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const [ana, ben, cy] = await Promise.all(['Ana', 'Ben', 'Cy'].map((n) => phone(n, host.url())));
  await host.getByRole('button', { name: 'Join Red' }).click();
  await ana!.getByRole('button', { name: 'Join Red' }).click();
  await ben!.getByRole('button', { name: 'Join Blue' }).click();
  await cy!.getByRole('button', { name: 'Join Blue' }).click();
  await host.getByRole('button', { name: /^Alternating/ }).click();
  await expect(host.getByRole('button', { name: /^Alternating/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  const teams: Record<TeamName, Page[]> = { Red: [host, ana!], Blue: [ben!, cy!] };
  const other = (t: TeamName): TeamName => (t === 'Red' ? 'Blue' : 'Red');
  // Whichever team opens round 1 goes second in round 2.
  let first: TeamName | undefined;
  await expect
    .poll(async () => {
      for (const t of ['Red', 'Blue'] as const) {
        for (const p of teams[t]) {
          if (await transmission(p, t).getByText('Your secret code').isVisible()) first = t;
        }
      }
      return first !== undefined;
    })
    .toBeTruthy();
  const second = other(first!);

  /** `team` transmits; its decoder guesses right or wrong; the other team intercepts wrongly. */
  const turn = async (team: TeamName, decodes: boolean, intercept = true) => {
    const enc = await encryptorOf(teams[team], team);
    const code = await sendClues(enc, team);
    if (intercept) for (const p of teams[other(team)]) await pick(p, team, wrong(code));
    const decoder = teams[team].find((p) => p !== enc)!;
    await pick(decoder, team, decodes ? code : wrong(code));
    await expect(host.getByText('The code was').first()).toBeVisible();
  };

  // Round 1: the first team decodes, the second miscommunicates.
  await turn(first!, true, false);
  await host.getByRole('button', { name: 'Continue' }).click();
  await turn(second, false, false);
  await host.getByRole('button', { name: 'Next round' }).click();

  // Round 2: the second team goes first. The first team's interceptors agree on the real code...
  const enc = await encryptorOf(teams[second], second);
  const code = await sendClues(enc, second);
  const [i1, i2] = teams[first!];
  await pick(i1!, second, code);
  await pick(i2!, second, code);
  const lockedOn = transmission(i1!, second).getByText(
    `Your team is locked on ${code.join('-')} (waiting for the other team). Change your pick to reopen.`,
  );
  await expect(lockedOn).toBeVisible();
  await shot(i1!, 'locked-on');
  // ...then change their minds. Nothing was final, so the new pick is the one that counts.
  for (const p of [i1!, i2!]) {
    await transmission(p, second).getByRole('button', { name: 'Change my pick' }).click();
    await pick(p, second, wrong(code));
  }
  await expect(
    transmission(i1!, second).getByText(`Your team is locked on ${wrong(code).join('-')}`),
  ).toBeVisible();
  const decoder = teams[second].find((p) => p !== enc)!;
  await pick(decoder, second, wrong(code));
  await expect(
    host.getByText(`${first!} didn't intercept (guessed ${wrong(code).join('-')}).`),
  ).toBeVisible();

  // The second team now has 2 miscommunications, but the first team still plays its turn.
  const banner = `💥 ${second} has 2 miscommunications: the game ends after this round.`;
  for (const p of [host, ana!, ben!, cy!]) await expect(p.getByText(banner)).toBeVisible();
  await shot(i1!, 'ends-after-round');
  await host.getByRole('button', { name: 'Continue' }).click();
  await expect(ben!.getByText(banner)).toBeVisible();
  await turn(first!, true);
  await expect(ben!.getByText(banner)).toHaveCount(0);
  await expect(
    ben!.getByText(`${first!} wins! ${second} had 2 miscommunications.`, { exact: false }),
  ).toBeVisible();
  await expect(host.getByRole('button', { name: 'See results' })).toBeVisible();
});

test('a level score goes to a showdown on the other team’s keywords', async ({ browser }) => {
  test.setTimeout(120_000);
  // Phone and desktop, light and dark, so one run shoots every layout of the showdown.
  const looks = [
    { viewport: { width: 390, height: 844 }, colorScheme: 'light' },
    { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
    { viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
  ] as const;
  const join = async (i: number, name: string, url = '/') => {
    const page = await (await browser.newContext(looks[i])).newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const shot = async (page: Page, i: number, name: string) => {
    if (process.env.SCREENSHOTS) {
      const { viewport, colorScheme } = looks[i]!;
      const look = `${viewport.width < 600 ? 'phone' : 'desktop'}-${colorScheme}`;
      await page.screenshot({ path: `test-results/shots/enigma-${look}-${name}.png` });
    }
  };
  const host = await join(0, 'Hana');
  await host.getByRole('button', { name: 'Create an Enigma room' }).click();
  await expect(host.getByText('Pick a team below')).toBeVisible();
  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n, i) => join(i + 1, n, host.url())),
  );
  const pages = [host, ana!, ben!, cy!];
  const teams: Record<TeamName, Page[]> = { Red: [host, ana!], Blue: [ben!, cy!] };
  for (const t of ['Red', 'Blue'] as const) {
    for (const p of teams[t]) await p.getByRole('button', { name: `Join ${t}` }).click();
  }
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Two rounds in which both teams miscommunicate: 2 each, a level score.
  for (const round of [1, 2]) {
    const codes: Partial<Record<TeamName, number[]>> = {};
    const encs: Partial<Record<TeamName, Page>> = {};
    for (const t of ['Red', 'Blue'] as const) {
      encs[t] = await encryptorOf(teams[t], t);
      codes[t] = await sendClues(encs[t], t);
    }
    for (const t of ['Red', 'Blue'] as const) {
      const them: TeamName = t === 'Red' ? 'Blue' : 'Red';
      if (round === 2) for (const p of teams[them]) await pick(p, t, wrong(codes[t]!));
      await pick(
        teams[t].find((p) => p !== encs[t])!,
        t,
        wrong(codes[t]!),
      );
    }
    await expect(host.getByText('The code was').first()).toBeVisible();
    if (round === 1) await host.getByRole('button', { name: 'Next round' }).click();
  }
  await expect(host.getByText(/Dead level!.*so it goes to a showdown/)).toBeVisible();
  await host.getByRole('button', { name: 'Start the showdown' }).click();

  // Each team hands in its guesses once; the other team never sees them before the end.
  for (const [i, p] of pages.entries()) {
    await expect(p.getByRole('heading', { name: '🤝 Showdown' })).toBeVisible();
    await shot(p, i, 'showdown');
  }
  await ana!.getByLabel('Final guess for Blue keyword 1').fill('Zorblax');
  await ana!.getByRole('button', { name: 'Hand in our guesses' }).click();
  await expect(
    host.getByText('Your team has handed in its guesses. Waiting for Blue…'),
  ).toBeVisible();
  await expect(cy!.getByText('handed in ✓')).toBeVisible();
  await expect(cy!.getByText('Zorblax')).toHaveCount(0);
  await shot(host, 0, 'showdown-handed-in');
  await cy!.getByRole('button', { name: 'Hand in our guesses' }).click();

  for (const [i, p] of pages.entries()) {
    await expect(p.getByText('🤝 A shared win!')).toBeVisible();
    await expect(
      p.getByText(/In the showdown both teams named 0 keywords right, so they share the win\./),
    ).toBeVisible();
    await shot(p, i, 'showdown-over');
  }
  await expect(ben!.getByText('Zorblax')).toBeVisible();
});
