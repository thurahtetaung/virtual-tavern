import { type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { readCards, readyUp, votes } from './masquerade-play.ts';
import {
  VAMPIRES,
  getReady,
  peek,
  playMarkedNight,
  playNight,
  setRoles,
} from './nightfall-play.ts';
import { type Exercised, type Shot, playUntil } from './royal-post-play.ts';
import { mockStatsApi, openStatsAsAdmin } from './stats-mock.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm e2e screenshots
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const cards = (p: Page) => p.getByRole('region', { name: 'Word cards' }).getByRole('button');

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
    await expect(cards(host)).toHaveCount(25);
    await host.screenshot({ path: `test-results/shots/${label}-spymaster.png`, fullPage: true });
    const redStarts = await host.getByText('Your turn! Give your team').isVisible();
    const [spy, op] = redStarts ? [host, others[0]!] : [others[1]!, others[2]!];
    await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
    await spy.getByRole('button', { name: '1', exact: true }).click();
    await spy.getByRole('button', { name: 'Give clue' }).click();
    await expect(op.getByText('Your turn to guess')).toBeVisible();
    await cards(op).first().click();
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
      // The team notes, with enough of them to scroll inside their box.
      for (const note of [
        'Their 2 keeps coming up as weather',
        'Clue "tide" could be their 1 or their 3',
        'They like puns, watch out',
        'Blue 4 is probably an animal',
        'Remember to vary our clues for keyword 2',
        'Last note, so the list has to scroll',
      ]) {
        await red.dec.getByLabel('Add a note').fill(note);
        await red.dec.getByLabel('Add a note').press('Enter');
        await expect(red.dec.getByRole('list', { name: 'Team notes' })).toContainText(note);
      }
      // Centred, so the fixed tab bar doesn't cover it.
      await red.dec.getByLabel('Add a note').evaluate((el) => {
        el.scrollIntoView({ block: 'center' });
      });
      await shot(red.dec, 'notes');
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

for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
  ['phone-light', { width: 390, height: 844 }, 'light'],
] as const) {
  test(`royal post screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(480_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/royal-post-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
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
        colorScheme,
        extraHTTPHeaders: {
          'cf-connecting-ip': `10.8.${['desktop', 'phone', 'phone-light'].indexOf(label)}.${ip++}`,
        },
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
    await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    await host.getByRole('button', { name: /^2019 edition/ }).click();
    await expect(host.getByText('Players (3/6)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    // Someone who joins mid-game watches.
    const watcher = await make('Wes');
    await watcher.goto(url);
    await expect(watcher.getByText(/^Watching:/).first()).toBeVisible();
    const done: Exercised = {
      guard: false,
      priest: false,
      handmaid: false,
      chancellor: false,
      baron: false,
      prince: false,
    };
    const wanted = [
      'my-turn',
      'targeting',
      'guard-guess',
      'priest-reveal',
      'baron-reveal',
      'handmaid',
      'prince',
      'chancellor',
      'elimination',
    ];
    // Each moment is captured the first time it comes up in play.
    let moments = 0;
    const moment: Shot = async (m, p) => {
      if (!taken.has(m)) await shot(p, m);
      if (++moments === 6) await shot(watcher, 'spectating');
    };
    await playUntil(
      host,
      players,
      '2019',
      done,
      (over) => over && wanted.every((m) => taken.has(m)),
      moment,
      async (over) => {
        if (!over && !taken.has('round-result')) await shot(host, 'round-result');
        if (over) await shot(host, 'podium');
      },
    );
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`echo screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/echo-${label}-${name}.png`,
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
    await host.getByRole('button', { name: 'Create an Echo room' }).click();
    await expect(host.getByText('Almost ready')).toBeVisible();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(host.url())));
    const all = [host, ...others];
    await expect(host.getByText('Everyone is in')).toBeVisible();
    await host.getByRole('button', { name: '8 cards' }).click();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();

    /** Plays one card: the guesser picks, everyone writes, then `finish` resolves it. */
    const playCard = async (
      finish: (guesser: Page, writers: Page[], word: string) => Promise<void>,
      shots = false,
    ) => {
      let guesser: Page | undefined;
      await expect
        .poll(async () => {
          for (const p of all)
            if (await p.getByRole('button', { name: 'Pick word 1' }).isEnabled()) guesser = p;
          return guesser !== undefined;
        })
        .toBe(true);
      const writers = all.filter((p) => p !== guesser);
      if (shots) await shot(guesser!, 'pick');
      await guesser!.getByRole('button', { name: 'Pick word 2' }).click();
      const word = await writers[0]!.getByTestId('secret-word').innerText();
      const clues = ['Lantern', 'lanterns', 'Harbour'];
      for (const [i, w] of writers.entries()) {
        await w.getByLabel('Your clue').fill(clues[i]!);
        if (shots && i === 0) await shot(w, 'clue');
        await w.getByRole('button', { name: 'Send clue' }).click();
        if (i < writers.length - 1) {
          await expect(w.getByRole('button', { name: '✓ Sent' })).toBeVisible();
        }
      }
      await expect(guesser!.getByLabel('Your guess')).toBeVisible();
      if (shots) await shot(guesser!, 'guess');
      await finish(guesser!, writers, word);
    };
    const nextCard = async () => {
      await host.getByRole('button', { name: /^(Next card|Finish)$/ }).click();
    };
    const wrong = async (guesser: Page, writers: Page[]) => {
      await guesser.getByLabel('Your guess').fill('Nothing');
      await guesser.getByRole('button', { name: 'Guess', exact: true }).click();
      // The game decides a miss on its own; the host can move on straight away.
      await expect(host.getByRole('button', { name: /^(Next card|Finish)$/ })).toBeVisible();
      return writers[0]!;
    };

    await playCard(async (guesser, _w, word) => {
      await guesser.getByLabel('Your guess').fill(word);
      await guesser.getByRole('button', { name: 'Guess', exact: true }).click();
      await expect(host.getByText('🎉 Got it!')).toBeVisible();
      await shot(host, 'reveal');
    }, true);
    await nextCard();
    await playCard(async (guesser, writers) => {
      const writer = await wrong(guesser, writers);
      await shot(writer, 'wrong');
    });
    // 5 cards left: two more misses (two cards each) and a pass end the deck.
    for (let i = 0; i < 2; i++) {
      await nextCard();
      await playCard(async (guesser, writers) => {
        await wrong(guesser, writers);
      });
    }
    await nextCard();
    await playCard(async (guesser) => {
      await guesser.getByRole('button', { name: 'Pass' }).click();
    });
    await nextCard();
    await expect(host.getByText('Game over!')).toBeVisible();
    await shot(host, 'over');
  });
}

// Hoodwink, with a made-up deck imported by the admin (the real decks are private).
for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`hoodwink screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const colorScheme = label === 'phone' ? 'dark' : 'light';
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/hoodwink-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    const admin = await (await browser.newContext({ viewport, colorScheme })).newPage();
    await ownLoginLimit(admin);
    await admin.goto('/tavern-keeper');
    await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
    await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
    await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
    const deck = await admin.request.post('/api/admin/question-decks', {
      data: {
        name: 'Made-up oddities',
        description: 'Invented facts for the screenshots.',
        questions: Array.from({ length: 5 }, (_, i) => ({
          prompt: `In the invented hamlet of Wobbleton ${i + 1}, every newborn is given a ceremonial ___ by the oldest villager.`,
          answer: 'Tin spoon',
          decoys: ['Velvet hat', 'Wooden duck', 'Goose feather'],
        })),
      },
    });
    expect(deck.status()).toBe(201);
    const deckId = ((await deck.json()) as { id: string }).id;
    try {
      await admin.reload();
      const decks = admin.getByRole('region', { name: 'Question decks' });
      await decks.scrollIntoViewIfNeeded();
      await decks.screenshot({ path: `test-results/shots/hoodwink-${label}-admin-decks.png` });

      let ip = 1;
      const make = async (name: string) => {
        const ctx = await browser.newContext({
          viewport,
          colorScheme,
          extraHTTPHeaders: { 'cf-connecting-ip': `10.5.${label === 'phone' ? 1 : 0}.${ip++}` },
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
      await host.getByRole('button', { name: 'Create a Hoodwink room' }).click();
      await expect(host).toHaveURL(/\/r\//);
      const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
      await Promise.all(others.map((p) => p.goto(host.url())));
      // The made-up deck has five questions, so pick five rounds before the game can start.
      await host.getByRole('button', { name: '5 rounds' }).click();
      await expect(host.getByRole('button', { name: '5 rounds' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(host.getByText('Everyone is in')).toBeVisible();
      await shot(host, 'lobby');
      await host.getByRole('button', { name: 'Start game' }).click();
      const [ana, ben, cy] = others as [Page, Page, Page];
      const everyone = [host, ana, ben, cy];

      const lies = [
        'A hand-knitted sock',
        'A tiny brass bell that must be rung at every single birthday until the child turns ninety',
        'Pickled egg',
      ];
      for (let round = 1; round <= 5; round++) {
        await expect(host.getByText(`Round ${round}/5`)).toBeVisible();
        if (round === 1) {
          await ana.getByLabel('Your lie').fill(lies[0]!);
          await shot(ana, 'writing');
        }
        for (const [i, p] of [ana, ben, cy].entries()) {
          await p.getByLabel('Your lie').fill(`${lies[i]!} ${round > 1 ? round : ''}`.trim());
          await p.getByRole('button', { name: 'Send lie' }).click();
        }
        await host.getByRole('button', { name: '🎲 Lie for me' }).click();
        for (const p of everyone)
          await expect(p.getByRole('list', { name: 'Answers' }).getByRole('button')).toHaveCount(5);
        if (round === 1) await shot(host, 'vote');
        for (const p of everyone) {
          const options = p.getByRole('list', { name: 'Answers' }).getByRole('button');
          for (let i = 0; i < 5; i++) {
            if (await options.nth(i).isEnabled()) {
              await options.nth(i).click();
              break;
            }
          }
        }
        await expect(host.getByRole('list', { name: 'Answers revealed' })).toBeVisible();
        if (round === 1) {
          await host.waitForTimeout(1200); // the reveal animates in
          await shot(host, 'reveal');
        }
        await host.getByRole('button', { name: round === 5 ? 'Finish' : 'Next round' }).click();
      }
      await expect(host.getByRole('list', { name: 'Podium' })).toBeVisible();
      await shot(host, 'podium');
    } finally {
      // Tidy up even on failure, so later runs see only their own decks.
      await admin.request.delete(`/api/admin/question-decks/${deckId}`);
    }
  });
}

// The admin stats page, served from the typed fixtures: phone in dark, desktop in light.
for (const [label, viewport, colorScheme] of [
  ['desktop', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
] as const) {
  test(`stats screenshots (${label})`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport, colorScheme });
    const page = await ctx.newPage();
    await mockStatsApi(page);
    await openStatsAsAdmin(page);
    // Charts and chips animate; let loads finish and transitions settle before each shot.
    const shot = async (name: string) => {
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `test-results/shots/stats-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
    const tab = (name: string) => page.getByRole('tab', { name, exact: true }).click();
    await shot('live');
    await tab('Overview');
    await expect(page.getByRole('region', { name: 'Game mix' }).locator('svg')).toBeVisible();
    await shot('overview');
    if (label === 'phone') {
      await page.getByRole('region', { name: 'Game nights calendar' }).scrollIntoViewIfNeeded();
      await shot('overview-heatmaps');
    }
    await tab('Games');
    await page.getByRole('group', { name: 'Game' }).getByRole('button', { name: /Echo/ }).click();
    await expect(page.getByRole('region', { name: 'Scores' })).toBeVisible();
    await shot('games-echo');
    if (label === 'phone') {
      await page.getByRole('region', { name: 'Words' }).scrollIntoViewIfNeeded();
      await shot('games-echo-words');
    }
    const words = page.getByRole('region', { name: 'Words' });
    for (const game of ['Reverie', 'Hoodwink']) {
      await page
        .getByRole('group', { name: 'Game' })
        .getByRole('button', { name: new RegExp(game) })
        .click();
      await expect(words.getByRole('list')).toBeVisible();
      if (label === 'phone') await words.scrollIntoViewIfNeeded();
      await shot(`games-${game.toLowerCase()}`);
    }
    await tab('Players');
    await expect(page.getByRole('table')).toBeVisible();
    await shot('players');
    await page.getByRole('button', { name: /^Ivy/ }).click();
    await expect(page.getByText('Also known as')).toBeVisible();
    await shot('player');
    await tab('Fun');
    await expect(page.getByText('Most dramatic finish')).toBeVisible();
    await shot('fun');
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`masquerade screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const phone = label === 'phone';
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/masquerade-${label}-${name}.png`,
        fullPage: !phone,
      });
    const make = async (name: string) => {
      const ctx = await browser.newContext({ viewport, colorScheme: phone ? 'dark' : 'light' });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      return p;
    };
    const host = await make('Hana');
    await host.goto('/');
    await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(['Ana', 'Ben', 'Cy'].map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben', 'Cy'][i]!]));
    await expect(host.getByText('Players (4/12)')).toBeVisible();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Start game' }).click();
    const dealt = await readCards(players, names);
    const local = dealt.locals[0]!;
    const tab = async (p: Page, name: string) => {
      if (phone) await p.getByRole('navigation').getByRole('button', { name }).click();
    };
    await shot(local, 'card-local');
    await shot(dealt.spy, 'card-spy');
    await tab(dealt.spy, 'Locations');
    const board = dealt.spy.getByRole('region', { name: 'Locations' });
    for (const n of ['Bakery', 'Gym', 'Cinema', 'Lift'].filter((x) => x !== dealt.location))
      await board.getByRole('button', { name: n, exact: true }).click();
    await board.getByRole('button', { name: 'Star Aquarium' }).click();
    await shot(dealt.spy, 'locations-spy');
    await tab(local, 'Ideas');
    await shot(local, 'ideas-local');
    await tab(dealt.spy, 'Ideas');
    await shot(dealt.spy, 'ideas-spy');
    await tab(dealt.spy, 'Play');
    await tab(local, 'Play');
    await readyUp(players);
    const [a, b, c] = dealt.locals as [Page, Page, Page];
    await votes([[a, names.get(dealt.spy)!]]);
    await shot(a, 'vote');
    await votes([
      [b, names.get(dealt.spy)!],
      [c, names.get(dealt.spy)!],
      [dealt.spy, names.get(a)!],
    ]);
    // A caught spy's screen opens on the board, ready to guess.
    await expect(dealt.spy.getByText('🎯 You were caught! Pick your one guess.')).toBeVisible();
    await shot(dealt.spy, 'caught');
    await board.getByRole('button', { name: `Pick ${dealt.location}`, exact: true }).click();
    await shot(dealt.spy, 'guess');
    await board.getByRole('button', { name: `Guess ${dealt.location}`, exact: true }).click();
    await expect(host.getByTestId('revealed-location')).toBeVisible();
    await shot(host, 'reveal');
  });
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test(`nightfall screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(240_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/nightfall-${label}-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
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
        extraHTTPHeaders: { 'cf-connecting-ip': `10.10.${label === 'phone' ? 1 : 0}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const names = ['Hana', 'Ana', 'Ben', 'Cy'];
    const host = await make(names[0]!);
    await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(names.slice(1).map(make));
    await Promise.all(others.map((p) => p.goto(url)));
    const players = [host, ...others];
    await expect(host.getByText('Players (4/10)')).toBeVisible();
    await setRoles(host, {
      werewolf: 2,
      seer: 1,
      robber: 1,
      troublemaker: 1,
      insomniac: 1,
      villager: 1,
    });
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '8 s', exact: true })
      .click();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    await shot(host, 'ready-covered');
    await host.getByRole('button', { name: 'Tap to see your card' }).click();
    await shot(host, 'ready');
    await host.getByRole('button', { name: 'Cover it again' }).click();
    const roles = await getReady(players);
    await expect(host.getByTestId(/night-/)).toBeVisible({ timeout: 15_000 });
    let idleShot = false;
    await playNight(players, roles, async (p) => {
      if (!taken.has('night-acting')) await shot(p, 'night-acting');
      if (!idleShot) {
        idleShot = true;
        const idle = players.find((q) => q !== p)!;
        if (await idle.getByTestId('night-idle').count()) await shot(idle, 'night-idle');
      }
    });
    await expect(host.getByRole('button', { name: 'Ready to vote' })).toBeVisible();
    await shot(host, 'day');
    await host.getByRole('tab', { name: 'Learned' }).click();
    await shot(host, 'day-learned');
    await host.getByRole('tab', { name: 'Roles' }).click();
    await shot(host, 'day-roles');
    await host.getByRole('tab', { name: 'Table' }).click();
    for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
    await expect(host.getByText('🗳️ The vote')).toBeVisible();
    await host.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await shot(host, 'vote');
    await others[0]!.getByRole('button', { name: `Vote for ${names[2]}` }).click();
    await others[1]!.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await others[2]!.getByRole('button', { name: `Vote for ${names[1]}` }).click();
    await expect(host.getByTestId('teams')).toBeVisible();
    await shot(host, 'reveal');
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await shot(host, 'reveal-night');
    await host.getByRole('tab', { name: 'Everyone’s cards' }).click();
    await host.getByTestId('reveal-player').first().getByRole('button').first().click();
    await shot(host, 'card-details');
  });

  test(`nightfall vampire screenshots (${label})`, async ({ browser, request }) => {
    test.setTimeout(300_000);
    const taken = new Set<string>();
    const shot = async (p: Page, name: string) => {
      taken.add(name);
      await p.screenshot({
        path: `test-results/shots/nightfall-${label}-vampire-${name}.png`,
        fullPage: label === 'desktop',
      });
    };
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
        extraHTTPHeaders: { 'cf-connecting-ip': `10.10.${label === 'phone' ? 3 : 2}.${ip++}` },
      });
      const p = await ctx.newPage();
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await p.goto('/backroom');
      await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
      await p.getByRole('button', { name: 'Knock' }).click();
      await p.getByText("You're on the list").waitFor();
      return p;
    };
    const names = ['Hana', 'Ana', 'Ben', 'Cy'];
    const host = await make(names[0]!);
    await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    // Join one at a time, so the seats follow `names`.
    const others: Page[] = [];
    for (const n of names.slice(1)) {
      const p = await make(n);
      await p.goto(url);
      await expect(host.getByText(`Players (${others.length + 2}/10)`)).toBeVisible();
      others.push(p);
    }
    const players = [host, ...others];
    await setRoles(host, {
      vampire: 1,
      'the-count': 1,
      werewolf: 1,
      cupid: 1,
      seer: 1,
      priest: 1,
      pickpocket: 1,
    });
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '8 s', exact: true })
      .click();
    await host.locator('details[aria-label="Vampire"]').scrollIntoViewIfNeeded();
    await shot(host, 'lobby');
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    let roles: string[] = [];
    for (let tries = 0; tries < 40; tries++) {
      roles = await peek(players);
      if (
        roles.includes('werewolf') &&
        roles.includes('cupid') &&
        roles.some((r) => VAMPIRES.includes(r)) &&
        roles.some((r) => ['seer', 'pickpocket'].includes(r))
      )
        break;
      await host.getByRole('button', { name: 'Shuffle and deal again' }).click();
      await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    }
    const W = roles.indexOf('werewolf');
    const T = roles.findIndex((r) => VAMPIRES.includes(r));
    const marked = roles.findIndex((r) => ['seer', 'pickpocket'].includes(r));
    await getReady(players);
    await expect(host.getByTestId(/night-/)).toBeVisible({ timeout: 15_000 });
    await playMarkedNight(players, names, roles, marked, async (p) => {
      if (!taken.has('dusk') && (await p.getByTestId('dusk').count())) await shot(p, 'dusk');
      if (!taken.has('lovers') && (await p.getByTestId('lovers').count())) await shot(p, 'lovers');
      if (!taken.has('acting') && (await p.getByTestId('prompt').count())) await shot(p, 'acting');
    });
    const lover = players[W]!;
    await expect(lover.getByRole('button', { name: 'Ready to vote' })).toBeVisible();
    await shot(lover, 'day');
    await lover.getByTestId('my-mark').getByRole('button').click();
    await shot(lover, 'my-mark');
    await lover.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await lover.getByRole('tab', { name: 'Learned' }).click();
    await shot(lover, 'day-learned');
    await lover.getByRole('tab', { name: 'Table' }).click();
    for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
    await expect(host.getByText('🗳️ The vote')).toBeVisible();
    for (const [i, p] of players.entries())
      await p.getByRole('button', { name: `Vote for ${names[i === W ? T : W]}` }).click();
    await expect(host.getByTestId('teams')).toBeVisible();
    await shot(host, 'reveal');
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await shot(host, 'reveal-night');
  });
}
