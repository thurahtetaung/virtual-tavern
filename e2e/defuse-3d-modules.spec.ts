import { type Page, expect } from '@playwright/test';
import { localArt, settings, table } from './defuse-play.ts';
import { type Op, call, changed, ready, stamp } from './defuse-3d-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// Every module kind solved through the 3D view, driven by the bot's solver (`nextMove`) through
// the scene's own parts (`window.__defuse3d`, test seed only). See defuse-3d.spec.ts.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** Plays the bomb to its end through the scene, handling each needy module once on the way. */
async function solveAll(p: Page, seen: Set<string>) {
  const kinds = new Map((await call(p, 'bomb')).modules.map((m) => [m.id, m.kind]));
  const needy = [...kinds].filter(([, k]) => ['venting-gas', 'capacitor', 'knob'].includes(k));
  let needyDone = needy.length === 0;
  let known = 0;
  let last = '';
  for (let guard = 0; guard < 400; guard++) {
    const b = await call(p, 'bomb');
    if (!b) return;
    const strikes = b.log.filter((e) => e.what === 'strike');
    for (const e of strikes.slice(known))
      console.log(`STRIKE ${JSON.stringify(e)} last move ${last}`);
    known = strikes.length;
    if (b.end) return;
    // The needy module, once it runs: answer, discharge or turn it once.
    if (!needyDone) {
      const n = b.modules.find((m) => m.id === needy[0]![0])!;
      if (n.state === 'running') {
        await call(p, 'focus', n.id);
        await p.waitForTimeout(300);
        const kind = needy[0]![1];
        // The solver's own answer (a "detonate?" question wants No); the capacitor is
        // discharged and the knob turned whether or not they need it yet.
        const mv = await call(p, 'next');
        const op: Op =
          mv && mv !== 'wait' && mv.module === n.id
            ? mv.op
            : kind === 'capacitor'
              ? { op: 'down' }
              : kind === 'knob'
                ? { op: 'turn' }
                : { op: 'none' };
        if (op.op === 'none') {
          await p.waitForTimeout(250);
          continue;
        }
        const before = await stamp(p);
        await call(p, 'press', await call(p, 'partFor', n.id, op));
        await changed(p, before);
        if (kind === 'capacitor') {
          await p.waitForTimeout(1000);
          await call(p, 'release');
        }
        seen.add(kind);
        console.log(`handled ${kind}`);
        needyDone = true;
        continue;
      }
    }
    const mv = await call(p, 'next');
    if (mv === null) return;
    if (mv === 'wait') {
      await p.waitForTimeout(250);
      continue;
    }
    // Simon replays its flashes and resets the entry: a press racing that moment is a strike.
    const simon = b.modules.find((m) => m.id === mv.module && m.kind === 'simon') as
      { playAt?: number } | undefined;
    if (simon?.playAt !== undefined) {
      const now = await p.evaluate(() => Date.now());
      if (Math.abs(now - simon.playAt) < 900) {
        await p.waitForTimeout(400);
        continue;
      }
    }
    // The last solvable module waits for the needy one (it wakes on a solve, or at 90 s).
    const left = b.modules.filter(
      (m) => !m.solved && !['venting-gas', 'capacitor', 'knob'].includes(m.kind),
    );
    if (!needyDone && left.length === 1 && left[0]!.id === mv.module) {
      await p.waitForTimeout(500);
      continue;
    }
    if ((await call(p, 'pose')).module !== mv.module) {
      await call(p, 'focus', mv.module);
      await p.waitForTimeout(250);
    }
    const before = await stamp(p);
    if (mv.op.op === 'up') await call(p, 'release');
    else {
      const i = await call(p, 'partFor', mv.module, mv.op);
      expect(
        i,
        `${kinds.get(mv.module)}: a part for ${JSON.stringify(mv.op)}`,
      ).toBeGreaterThanOrEqual(0);
      await call(p, 'press', i);
      if (mv.op.op === 'tap') await call(p, 'release');
    }
    await changed(p, before);
    const after = await call(p, 'bomb');
    last = `${kinds.get(mv.module)} ${JSON.stringify(mv.op)}`;
    for (const m of after?.modules ?? [])
      if (m.solved && !seen.has(m.kind)) {
        seen.add(m.kind);
        console.log(`solved ${m.kind}`);
      }
  }
}

// Under the test seed these four bombs hold every kind between them (the needy one differs with
// the module count): each test plays one through the scene and checks each of its kinds.
const BOMBS: [string, string[], string[]][] = [
  [
    '11',
    ['wires', 'button', 'keypad'],
    [
      'complicated-wires',
      'maze',
      'memory',
      'morse',
      'password',
      'simon',
      'whos-on-first',
      'wire-sequence',
      'capacitor',
    ],
  ],
  [
    '11',
    ['simon', 'whos-on-first', 'memory'],
    [
      'button',
      'complicated-wires',
      'keypad',
      'maze',
      'morse',
      'password',
      'wire-sequence',
      'wires',
      'capacitor',
    ],
  ],
  ['9', ['wires', 'button', 'keypad'], ['venting-gas']],
  ['8', ['wires', 'button', 'keypad'], ['knob']],
];

for (const [n, vetoes, kinds] of BOMBS)
  test(`modules solved through the 3D view: ${kinds.join(', ')}`, async ({ browser }) => {
    test.setTimeout(480_000);
    await openBackroom(await visitor(browser, 'Admin'));
    const [ana] = (await table(browser, ['Ana', 'Ben'], {
      setup: localArt,
      viewport: { width: 800, height: 450 },
    })) as [Page, Page];
    await settings(ana);
    // Ten minutes: every move goes through the scene, which is slow on a software renderer.
    await ana.getByTestId('set-time').selectOption('600');
    await ana.getByTestId('set-modules').selectOption(n);
    await ana.getByTestId('set-needy').click();
    await expect(ana.getByTestId('set-needy')).toHaveAttribute('aria-checked', 'true');
    await ana.getByTestId('vetoes').locator('summary').click();
    for (const k of vetoes) {
      await ana.getByTestId(`veto-${k}`).click();
      await expect(ana.getByTestId(`veto-${k}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await ana.getByTestId('start').click();
    await ready(ana);
    const seen = new Set<string>();
    await solveAll(ana, seen);
    await expect(ana.getByTestId('outcome')).toHaveText('Defused', { timeout: 15_000 });
    for (const k of kinds) expect(seen, k).toContain(k);
  });
