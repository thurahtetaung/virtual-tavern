import { describe, expect, it } from 'vitest';
import { parseArgs } from './import-content-pack.mjs';

describe('import-content-pack arguments', () => {
  it('reads the four positionals and names the pack after its file', () => {
    expect(
      parseArgs(['http://localhost:3000/', 'going-once', 'groups', 'packs/titles.json']),
    ).toEqual({
      baseUrl: 'http://localhost:3000',
      gameId: 'going-once',
      kind: 'groups',
      file: 'packs/titles.json',
      name: 'titles',
      enabled: true,
      dryRun: false,
    });
  });

  it('takes a name, a disabled switch and a dry run', () => {
    const args = parseArgs([
      'https://x.test',
      'going-once',
      'lines',
      'l.json',
      '--name',
      'Lines v2',
      '--disabled',
      '--dry-run',
    ]);
    expect(args).toMatchObject({ name: 'Lines v2', enabled: false, dryRun: true });
  });

  it('refuses bad input', () => {
    expect(parseArgs(['x', 'going-once', 'groups', 'f.json']).error).toMatch(/baseUrl/);
    expect(parseArgs(['http://x', 'Going Once', 'groups', 'f.json']).error).toMatch(/gameId/);
    expect(parseArgs(['http://x', 'going-once', 'groups']).error).toMatch(/expected/);
    expect(parseArgs(['http://x', 'going-once', 'groups', 'f.json', '--wat']).error).toMatch(
      /unknown/,
    );
  });
});
