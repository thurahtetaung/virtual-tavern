import { describe, expect, it } from 'vitest';
import { cleanPack, hostLineProblems, parseArgs, plainText } from './import-content-pack.mjs';

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
      replace: false,
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

describe('host line checks', () => {
  it('flag labels, file names, stage directions and unfinished lines', () => {
    expect(
      hostLineProblems({
        sold: ['Sold!', 'New Version'],
        opening: ['Here we go (long sigh).', 'clip AUC037.ogg here.', 'Who starts'],
        congrats: ['Well done, {player}!', '{player}.'],
      }),
    ).toEqual([
      'sold: "New Version" (a recording label)',
      'opening: "Here we go (long sigh)." (a stage direction in brackets)',
      'opening: "clip AUC037.ogg here." (a file or cue name)',
      'opening: "Who starts" (no sentence ending)',
      'congrats: "{player}." (no words)',
    ]);
  });
});

describe('import-content-pack markup', () => {
  it('takes tags and entities out of every string, keeping the words', () => {
    expect(plainText('The movie <i>Speed</i>')).toBe('The movie Speed');
    expect(plainText('Fish &amp; chips&#8230;')).toBe('Fish & chips…');
    expect(plainText('<scr<script>ipt>x')).toBe('x');
    expect(plainText('&lt;b&gt;Bus&lt;/b&gt;')).toBe('Bus');
    const { data, changed } = cleanPack([
      { id: 1, titles: ['<b>Bus</b>', 'Van', '  Car  '], house: ['k_0'] },
    ]);
    expect(data).toEqual([{ id: 1, titles: ['Bus', 'Van', 'Car'], house: ['k_0'] }]);
    expect(changed).toBe(1);
    expect(cleanPack({ filler: ['Hi &amp; bye.'] })).toEqual({
      data: { filler: ['Hi & bye.'] },
      changed: 1,
    });
  });

  it('takes a --replace switch', () => {
    expect(
      parseArgs(['http://x.test', 'going-once', 'groups', 'g.json', '--replace']),
    ).toMatchObject({ replace: true });
  });
});
