import { type Page, expect } from '@playwright/test';
import { localArt, settings, table } from './defuse-play.ts';
import { type Op, call, changed, ready, stamp } from './defuse-3d-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The defuser's 3D bomb. The e2e server builds every bomb from a fixed seed (see defuse-play.ts):
// with the default 3 modules it holds wires (cut the first), a keypad (keys 1, 4, 3, 2) and a
// password (GREAT). Without the private 3D pack (as in CI) the bomb is plain boxes; with
// DEFUSE_ART it is the real one. The test hooks on `window.__defuse3d` exist only while the server
// runs the test seed.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** Taps a point on the bomb with a real pointer (mouse or touch). */
async function tapAt(p: Page, at: { x: number; y: number } | null) {
  expect(at).not.toBeNull();
  if (await p.evaluate(() => matchMedia('(pointer: coarse)').matches))
    await p.touchscreen.tap(at!.x, at!.y);
  else await p.mouse.click(at!.x, at!.y);
}

/** Looks at a module with real taps: pick the bomb up if it is down, turn to its face, tap it. */
async function look(p: Page, id: string) {
  if ((await call(p, 'pose')).pose === 'desk') {
    await tapAt(p, await call(p, 'where', id));
    await expect.poll(async () => (await call(p, 'pose')).pose).toBe('held');
  }
  if ((await call(p, 'pose')).module === id) return;
  if ((await call(p, 'pose')).pose === 'module') {
    await call(p, 'back');
    await p.waitForTimeout(300);
  }
  if (Number(id[1]) !== (await call(p, 'pose')).face) {
    // The other face: turn the bomb over first.
    await call(p, 'turn', 'right');
    await call(p, 'turn', 'right');
  }
  await p.waitForTimeout(400);
  await tapAt(p, await call(p, 'where', id));
  await expect.poll(async () => (await call(p, 'pose')).module).toBe(id);
  await p.waitForTimeout(300);
}

/** Uses one part of the focused module with a real tap. */
async function use(p: Page, id: string, op: Op) {
  const i = await call(p, 'partFor', id, op);
  expect(i, `a part for ${JSON.stringify(op)}`).toBeGreaterThanOrEqual(0);
  const before = await stamp(p);
  await tapAt(p, await call(p, 'where', id, i));
  await changed(p, before);
}

test('a bomb defused through the 3D view, then one that goes off', async ({ browser }) => {
  test.setTimeout(150_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { setup: localArt })) as [Page, Page];
  // The 3D bomb is everyone's default.
  await expect(ana.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await ana.getByTestId('start').click();
  await ready(ana);
  await expect(ana.getByTestId('bomb-hint')).toHaveText('Click the bomb to pick it up.');
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 1');
  await expect(ben.getByTestId('bomb-3d')).toHaveCount(0);

  // The edges carry the serial number and the rest.
  const edges = await call(ana, 'edges');
  expect(edges.filter((e) => 'serial' in e)).toHaveLength(1);

  const bomb = await call(ana, 'bomb');
  const id = (kind: string) => bomb.modules.find((m) => m.kind === kind)!.id;
  await look(ana, id('wires'));
  await expect(ana.getByTestId('bomb-hint')).toHaveText(
    'Click a part to use it. Right-click or Esc to step back.',
  );
  await use(ana, id('wires'), { op: 'cut', wire: 0 });
  await expect.poll(async () => (await call(ana, 'look', id('wires')))?.led).toBe('pass');
  await expect(ana.getByTestId('bomb-hint')).toHaveCount(0);

  await look(ana, id('keypad'));
  for (const k of [0, 3, 2, 1]) await use(ana, id('keypad'), { op: 'press', button: k });
  await expect.poll(async () => (await call(ana, 'look', id('keypad')))?.led).toBe('pass');

  await look(ana, id('password'));
  for (const [c, letter] of [...'GREAT'].entries())
    for (let i = 0; i < 6; i++) {
      const shown = ((await call(ana, 'look', id('password'))) as { letters: string[] }).letters;
      if (shown[c] === letter) break;
      await use(ana, id('password'), { op: 'spin', column: c, by: 1 });
    }
  await use(ana, id('password'), { op: 'submit' });
  for (const p of [ana, ben])
    await expect(p.getByTestId('outcome')).toHaveText('Defused', { timeout: 10_000 });

  // Hardcore: one wrong cut and it goes off in Ben's hands; his screen goes dark first.
  await settings(ana);
  await ana.getByTestId('set-hardcore').click();
  await ana.getByTestId('next-bomb').click();
  await ready(ben);
  const wires = (await call(ben, 'bomb')).modules.find((m) => m.kind === 'wires')!.id;
  await look(ben, wires);
  await tapAt(ben, await call(ben, 'where', wires, 1));
  await expect(ben.getByTestId('explode-black')).toBeVisible();
  for (const p of [ana, ben])
    await expect(p.getByTestId('outcome')).toHaveText('Exploded', { timeout: 10_000 });
});

test('the hover outline follows the cursor and clears when it leaves', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 1280, height: 720 },
  })) as [Page, Page];
  // A full bomb, so the front face holds modules.
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  const [a, b] = (await call(ana, 'bomb')).modules.filter((m) => m.face === 0).map((m) => m.id);
  const lit = () => call(ana, 'lit');
  const hoverOn = async (id: string) => {
    const at = await call(ana, 'where', id);
    await ana.mouse.move(at!.x, at!.y, { steps: 4 });
  };
  // Over module A: A alone is lit.
  await hoverOn(a!);
  await expect.poll(lit).toHaveLength(1);
  const litA = (await lit())[0];
  // Over module B: the outline moves; A is no longer lit.
  await hoverOn(b!);
  await expect.poll(async () => (await lit())[0]).not.toBe(litA);
  await expect.poll(lit).toHaveLength(1);
  // Off the bomb (the canvas's left edge): nothing lit.
  await ana.mouse.move(4, 360, { steps: 4 });
  await expect.poll(lit).toHaveLength(0);
  // Back on B, then out of the canvas onto the overlay's ? button: nothing lit.
  await hoverOn(b!);
  await expect.poll(lit).toHaveLength(1);
  await ana.getByTestId('bomb-help').hover();
  await expect.poll(lit).toHaveLength(0);
  // Back on A, then zoom in and out with the cursor off the bomb: nothing stays lit.
  await hoverOn(a!);
  await expect.poll(lit).toHaveLength(1);
  await call(ana, 'focus', a!);
  await ana.mouse.move(4, 360, { steps: 2 });
  await call(ana, 'back');
  await expect.poll(lit).toHaveLength(0);
});

test('on touch the finger selects what it is on, and the selection never sticks', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana] = (await table(browser, ['Ana', 'Ben'], {
    setup: localArt,
    viewport: { width: 844, height: 390 },
    touch: true,
  })) as [Page, Page];
  // A full bomb, so the front face holds modules.
  await settings(ana);
  await ana.getByTestId('set-modules').selectOption('11');
  await ana.getByTestId('start').click();
  await ready(ana);
  await call(ana, 'pickUp');
  const [a, b] = (await call(ana, 'bomb')).modules.filter((m) => m.face === 0).map((m) => m.id);
  const lit = () => call(ana, 'lit');
  const cdp = await ana.context().newCDPSession(ana);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await expect.poll(async () => (await call(ana, 'pose')).pose).toBe('held');
  await ana.waitForTimeout(500);
  const at = (id: string) => call(ana, 'where', id) as Promise<{ x: number; y: number }>;
  // Finger down on A: A alone is selected.
  const pa = await at(a!);
  await touch('touchStart', pa.x, pa.y);
  await expect.poll(lit).toHaveLength(1);
  const litA = (await lit())[0];
  // The finger slides onto B: the selection moves (one lit, not A).
  const pb = await at(b!);
  for (let i = 1; i <= 6; i++)
    await touch('touchMove', pa.x + ((pb.x - pa.x) * i) / 6, pa.y + ((pb.y - pa.y) * i) / 6);
  await expect.poll(async () => (await lit())[0]).not.toBe(litA);
  await expect.poll(lit).toHaveLength(1);
  // Off the bomb: nothing selected; the lift leaves nothing either.
  await touch('touchMove', 4, 195);
  await expect.poll(lit).toHaveLength(0);
  await touch('touchEnd');
  await expect.poll(lit).toHaveLength(0);
  // A tap on B: selected while down, cleared on the lift, and B is looked at.
  await touch('touchStart', pb.x, pb.y);
  await expect.poll(lit).toHaveLength(1);
  await touch('touchEnd');
  await expect.poll(lit).toHaveLength(0);
  await expect.poll(async () => (await call(ana, 'pose')).module).toBe(b);
});
