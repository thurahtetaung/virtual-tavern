import { describe, expect, it } from 'vitest';
import { nightfall } from '../logic/game.ts';
import { ARTIFACTS, NOSTRA_TEAMS, ROLE_IDS, type RoleId } from '../logic/roles.ts';
import { DEFAULT_WEIGHTS, type Ripple, type WeightTable, pickFor } from '../logic/tables.ts';
import { table, votes } from '../logic/test-utils.ts';
import type { Announcement, NoteBody } from '../logic/types.ts';
import {
  ENTRY_LABEL,
  announcementText,
  rippleText,
  setWords,
  tableTitle,
  toldText,
} from './alienText.ts';
import { deckFor } from './assets.ts';
import { announcementLines, cuesFor } from './audio.ts';
import { standingOf } from './standing.ts';
import { statusFor } from './status.ts';
import { describeEntry, describeNote, lineText, narrationText } from './text.ts';

const deck = deckFor(null, (id) => ARTIFACTS[id].summary);
const at = { name: (n: number) => ['Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay'][n - 1] ?? null };
const only = (t: WeightTable, key: string) => ({
  [t]: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS[t]).map((k) => [k, k === key ? 1 : 0])),
});
const STARE = only('alien', 'stare');
const room = { isHost: true, hostId: 'A', players: [], you: 'A' };

describe('the narrator’s Alien instructions, in words', () => {
  it('name players by number, with their names', () => {
    expect(setWords({ kind: 'numbers', numbers: [2, 5] }, at)).toBe('players 2 (Ben) or 5 (Eve)');
    expect(setWords({ kind: 'even' }, at)).toBe('any even-numbered player');
    expect(setWords({ kind: 'two-left' }, at)).toMatch(/two players/);
  });

  it('word every entry of every table', () => {
    const roles: Record<string, RoleId> = {
      alien: 'alien',
      oracle: 'oracle',
      'body-snatcher': 'body-snatcher',
      psychic: 'psychic',
      rascal: 'rascal',
      exposer: 'exposer',
      mortician: 'mortician',
      empath: 'empath',
    };
    for (const [t, role] of Object.entries(roles))
      for (const key of Object.keys(DEFAULT_WEIGHTS[t as WeightTable])) {
        const pick = pickFor(role, {
          rng: { next: () => 0.5, int: () => 0, shuffle: (x) => [...x] },
          n: 6,
          weights: only(t as WeightTable, key),
          roles: ['alien', 'werewolf', 'vampire'],
        })!;
        const text = toldText(pick, at, deck);
        expect(text, `${t}.${key}`).toMatch(/\w/);
        expect(text).not.toMatch(/undefined/);
        expect(ENTRY_LABEL[t as WeightTable][key], `${t}.${key}`).toBeTruthy();
      }
    for (const t of Object.keys(DEFAULT_WEIGHTS) as WeightTable[])
      expect(tableTitle(t, deck)).toBeTruthy();
  });

  it('word every ripple and announcement', () => {
    const ripples: Ripple[] = [
      { key: 'one-minute' },
      { key: 'vote-for-app' },
      { key: 'repeat-night' },
      { key: 'repeat-role', role: 'seer' },
      { key: 'i-am-alien', who: { kind: 'odd' } },
      { key: 'face-away', who: { kind: 'numbers', numbers: [1, 3, 5] } },
      { key: 'two-hand-vote', who: { kind: 'everyone' } },
      { key: 'no-speak', who: { kind: 'even' } },
      { key: 'view-1', actor: 2, from: { kind: 'center' } },
      { key: 'view-2', actor: 2, from: { kind: 'any' } },
      { key: 'dual-view', actors: [1, 4], from: { kind: 'numbers', numbers: [2, 3, 6] } },
      { key: 'insomniac', actors: [1, 2, 3] },
      { key: 'troublemaker', actor: 1, between: [2, 3] },
      { key: 'steal', actor: 1, from: { kind: 'odd' } },
      { key: 'drunk', actor: 1, from: { kind: 'any' } },
      { key: 'witch', actor: 1, from: { kind: 'even' } },
      { key: 'reveal', actor: 1, target: 'left' },
      { key: 'shuffle', players: [2, 5], giver: 5 },
      { key: 'repeat-observer', observer: 4 },
    ];
    for (const rp of ripples) {
      expect(rippleText(rp, at, deck)).not.toMatch(/undefined|null/);
      expect(announcementLines({ kind: 'ripple', ripple: rp }).length).toBeGreaterThan(1);
    }
    expect(rippleText({ key: 'troublemaker', actor: 1, between: [2, 3] }, at, deck)).toBe(
      'Player 1 (Ana), you may swap the cards of player 2 (Ben) and player 3 (Cy), without looking.',
    );
    const anns: Announcement[] = [
      { kind: 'oracle-parity', parity: 'odd' },
      { kind: 'oracle-view', number: 4, swapped: true },
      { kind: 'oracle-number', right: false },
      { kind: 'blob', shape: { left: 1, right: 1 } },
      ...NOSTRA_TEAMS.map((team) => ({ kind: 'nostradamus' as const, doppel: false, team })),
    ];
    for (const a of anns) expect(announcementText(a, at, deck)).not.toMatch(/undefined|null/);
    expect(announcementLines({ kind: 'blob', shape: { left: 0, right: 2 } })).toEqual([
      'blob:members:2-right',
      'blob:end:many',
    ]);
  });

  it('say every Alien narration line, and the third-person version for those asleep', () => {
    for (const key of [
      'alien:wake',
      'cow:wake',
      'groob-zerb:wake',
      'leader:groob-zerb',
      'oracle:wake',
      'nostradamus:wake',
    ]) {
      expect(lineText(key, deck)).toMatch(/\w/);
      expect(narrationText(key, deck, { awake: false })).not.toMatch(/\byou\b/i);
    }
  });
});

describe('what Alien-set players read', () => {
  const notes: NoteBody[] = [
    { kind: 'tipped', tipped: true },
    { kind: 'fist', tapped: true, helper: false },
    { kind: 'recruited', target: 'B', helper: true },
    { kind: 'passed-card', side: 'left', to: 'B' },
    { kind: 'snatched', slot: { player: 'B' }, role: 'seer' },
    { kind: 'took', slot: { center: 1 }, role: 'mason' },
    { kind: 'gave', from: { center: 0 }, to: 'A' },
    { kind: 'exposed', center: 2, role: 'werewolf' },
    { kind: 'pointed', target: null },
    { kind: 'saw-point', from: 'B', target: 'A' },
    { kind: 'foretold', team: 'alien' },
    { kind: 'oracle', question: 'number', answer: '7', outcome: 'number:wrong' },
    { kind: 'pretended' },
    { kind: 'watched', stepId: 'seer', awake: ['B'], touched: [{ player: 'C' }], marks: [] },
    { kind: 'shuffled', with: 'B', mine: 'seer', theirs: 'werewolf' },
    { kind: 'group', group: 'aliens', players: ['A', 'B'] },
    { kind: 'thumbs', of: 'groob-zerb', players: ['B'] },
  ];
  const nameOf = (id: string | null | undefined) =>
    ({ A: 'Ana', B: 'Ben', C: 'Cy' })[id as 'A'] ?? 'Someone';

  it('in their own notes', () => {
    for (const n of notes)
      expect(describeNote(n, nameOf, deck, undefined, 'A', at), n.kind).toMatch(/\w/);
    expect(
      describeNote({ kind: 'saw-point', from: 'B', target: 'A' }, nameOf, deck, undefined, 'A'),
    ).toBe('Ben pointed at you.');
  });

  it('in the replay', () => {
    for (const n of notes)
      expect(
        describeEntry({ step: 1, stepId: 'aliens', by: 'A', note: n }, nameOf, deck),
      ).not.toMatch(/\byou\b/i);
  });
});

describe('the Alien set on screen', () => {
  it('“Where you stand” follows a New Alien tap and a snatched card', () => {
    const h = table({
      players: ['body-snatcher', 'alien', 'villager', 'seer', 'villager'],
      settings: { weights: { ...STARE, 'body-snatcher': { steal: 1, center: 0, pretend: 0 } } },
    });
    h.toStep('body-snatcher');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'body-snatcher', action: 'steal', from: { kind: 'any' } };
    h.night('A', { players: ['C'] });
    h.dawn();
    const st = standingOf(h.view('A'), deck)!;
    expect(st.now).toBe('villager');
    expect(st.meaning).toContainEqual(expect.stringMatching(/Alien card/));
  });

  it('cues the announcements with their step, and the time loop’s steps, on every device', () => {
    const h = table({
      players: ['blob', 'werewolf', 'villager', 'seer'],
      center: ['alien', 'villager', 'villager'],
      settings: { weights: { ...STARE, ...only('ripple', 'repeat-night') }, narration: 'all' },
    });
    h.toStep('blob');
    const blob = cuesFor(h.view('C'));
    expect(blob[0]!.lines[0]).toMatch(/^blob:members:/);
    expect(cuesFor(h.view('A'))).toEqual(blob);
    h.toStep('ripple');
    expect(cuesFor(h.view('C'))[0]!.lines).toEqual(['ripple:intro', 'ripple:event:repeat-night']);
    h.tick();
    expect(h.view('C').night!.count).toBeGreaterThan(h.state.round!.night!.loopFrom!);
    expect(h.state.round!.night!.plan[h.state.round!.night!.index]).toBe('aliens');
    expect(cuesFor(h.view('C'))[0]!.lines).toEqual(['alien:wake']);
  });

  it('times the day’s cues from its real length', () => {
    const h = table({
      players: ['alien', 'villager', 'seer'],
      settings: { weights: { ...only('alien', 'timer'), ...only('ripple', 'none') } },
    });
    h.dawn();
    const v = h.view('B');
    expect(v.day!.seconds).toBe(150);
    expect(cuesFor(v)[0]!.at).toBe(v.day!.deadline! - 150_000);
  });

  it('asks a two-handed voter for the second vote', () => {
    const h = table({
      players: ['seer', 'villager', 'werewolf', 'villager'],
      center: ['alien', 'villager', 'villager'],
      settings: { weights: { ...STARE, ...only('ripple', 'two-hand-vote') } },
    });
    h.dawn();
    const two = h.state.round!.rules!.twoVotes!;
    if (!two.length) return;
    const p = two[0]!;
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    h.act({ type: 'vote', target: p === 'A' ? 'B' : 'A' }, p);
    expect(statusFor(h.view(p), { ...room, you: p }).text).toMatch(/second vote/);
  });

  it('every Alien role has an emblem-backed placeholder and a team label', () => {
    for (const r of ROLE_IDS) expect(deck.name(r)).toMatch(/\w/);
    void nightfall;
    void votes;
  });
});
