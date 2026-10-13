// Splits the e2e specs into CI shards by measured run time, so no shard waits on a pile of slow
// specs. Playwright's own `--shard` splits by test count in file order, which put every serial
// back-room spec in the last shards.
//
//   node e2e/shards.ts 2 4                      # the spec files for shard 2 of 4
//   node e2e/shards.ts --plan 4                 # the split and each shard's estimated seconds
//   node e2e/shards.ts --update r1.json r2.json # refresh timings.json from JSON reports (CI
//                                               # uploads one per shard as e2e-timings-N)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_STATE } from '../playwright.config.ts';

const DIR = dirname(fileURLToPath(import.meta.url));
const TIMINGS = join(DIR, 'timings.json');

/** Playwright's default on a 4-core CI runner (half the cores). */
const WORKERS = 2;

interface Spec {
  file: string;
  seconds: number;
  serial: boolean;
}

interface Shard {
  files: string[];
  serial: number;
  parallel: number;
  longest: number;
}

/**
 * How long a shard takes: serial specs run one at a time on one worker while the other specs
 * share every worker, and a spec's tests always run in order on a single worker.
 */
function estimate(s: Shard): number {
  return Math.max(s.serial, (s.serial + s.parallel) / WORKERS, s.longest);
}

function specs(): Spec[] {
  const timings = JSON.parse(readFileSync(TIMINGS, 'utf8')) as Record<string, number>;
  const known = Object.values(timings).sort((a, b) => a - b);
  // A new spec counts as a typical one until timings.json is refreshed.
  const fallback = known[Math.floor(known.length / 2)] ?? 30;
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .sort()
    .map((file) => ({
      file,
      seconds: timings[file] ?? fallback,
      serial: SHARED_STATE.some((re) => re.test(file)),
    }));
}

/** Longest spec first, each to the shard it finishes soonest: deterministic for a given input. */
export function shards(total: number): Shard[] {
  const out: Shard[] = Array.from({ length: total }, () => ({
    files: [],
    serial: 0,
    parallel: 0,
    longest: 0,
  }));
  const sorted = specs().sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  for (const spec of sorted) {
    let best = out[0]!;
    let bestTime = Infinity;
    for (const shard of out) {
      const time = estimate({
        files: shard.files,
        serial: shard.serial + (spec.serial ? spec.seconds : 0),
        parallel: shard.parallel + (spec.serial ? 0 : spec.seconds),
        longest: Math.max(shard.longest, spec.seconds),
      });
      if (time < bestTime) [best, bestTime] = [shard, time];
    }
    best.files.push(spec.file);
    if (spec.serial) best.serial += spec.seconds;
    else best.parallel += spec.seconds;
    best.longest = Math.max(best.longest, spec.seconds);
  }
  return out;
}

/** Sums each spec file's test durations (first attempt) from Playwright JSON reports. */
function update(reportPaths: string[]): void {
  interface Suite {
    file: string;
    specs?: { tests: { results: { duration: number }[] }[] }[];
    suites?: Suite[];
  }
  const totals: Record<string, number> = {};
  const walk = (suite: Suite, file: string) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests)
        for (const result of test.results.slice(0, 1))
          totals[file] = (totals[file] ?? 0) + result.duration / 1000;
    for (const child of suite.suites ?? []) walk(child, file);
  };
  for (const path of reportPaths) {
    const report = JSON.parse(readFileSync(path, 'utf8')) as { suites: Suite[] };
    for (const suite of report.suites) walk(suite, basename(suite.file));
  }
  const sorted = Object.fromEntries(
    Object.entries(totals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, s]) => [file, Math.max(1, Math.round(s))]),
  );
  writeFileSync(TIMINGS, `${JSON.stringify(sorted, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, b, ...rest] = process.argv.slice(2);
  if (a === '--update' && b) {
    update([b, ...rest]);
  } else if (a === '--plan') {
    for (const [i, s] of shards(Number(b ?? 4)).entries())
      console.log(`${i + 1}: ~${Math.round(estimate(s))}s  ${s.files.join(' ')}`);
  } else {
    const index = Number(a);
    const total = Number(b);
    if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
      console.error(
        'usage: node e2e/shards.ts <index> <total> | --plan [total] | --update <report.json>…',
      );
      process.exit(2);
    }
    const files = shards(total)[index - 1]!.files;
    // An empty shard must never fall through to running the whole suite.
    if (files.length === 0) {
      console.error(`shard ${index}/${total} has no specs; use fewer shards`);
      process.exit(1);
    }
    console.log(files.map((f) => `e2e/${f}`).join(' '));
  }
}
