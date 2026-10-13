import { type AwardRule, TONES, renderCopy } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildGames } from '../games/registry.ts';
import { ALL_NIGHT_RULES } from './night-awards.ts';
import type { RuleInfo } from './select.ts';

/** Words the recap never uses: mock the move, never the person. */
const BANNED =
  /\b(stupid|idiots?|dumb|worst|losers?|fail(s|ed|ing)?|trash|chok(e|ed|es|ing)|carried|useless|ugly|fat|drunk|wasted|hammered|brain ?dead)\b/i;

/** A 12-character name stands in for every player; names render as placeholders otherwise. */
const NAME = 'Bartholomew!';
const PARAMS = {
  n: 12,
  m: 10,
  s: 12.5,
  w: 'Lighthouse',
  team: 'Blue',
  time: '1:30',
  r: 12,
  role: 'Lighthouse',
  role2: 'Lighthouse',
  loc: 'Lighthouse',
  card: 'Lighthouse',
};
/** Most characters a line may run to once filled in. */
const MAX_LINE = 70;

/** A line as players would read it: one 12-character name, 10-character words, 2-digit numbers. */
function filled(template: string): string {
  const text = renderCopy(template, { players: ['p1', 'p2'], value: 12, params: PARAMS });
  return text
    .replace(/\{p:p1\} & \{p:p2\}/g, NAME)
    .replace(/\{p:[^}]*\}/g, NAME)
    .replace(/\{(role|loc|card):[^}]*\}/g, 'Lighthouse');
}

const games = buildGames();
const modules = [...games.values()].flatMap((g) =>
  g.awards ? [{ game: g.id, rules: g.awards.rules }] : [],
);
const everyRule: { owner: string; rule: RuleInfo | AwardRule }[] = [
  ...modules.flatMap((m) => m.rules.map((rule) => ({ owner: m.game, rule }))),
  ...ALL_NIGHT_RULES.map((rule) => ({ owner: 'night', rule })),
];

describe('award copy', () => {
  it('every game ships an award module', () => {
    expect(modules.map((m) => m.game).sort()).toEqual([...games.keys()].sort());
  });

  it('rule ids are unique', () => {
    // Editions share their game's award module (and so its rule ids).
    const ids = everyRule
      .filter(({ owner }) => owner !== 'masquerade-originals' && owner !== 'hogwarts')
      .map(({ rule }) => rule.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it.each(everyRule.map(({ owner, rule }) => [`${owner} ${rule.id}`, rule] as const))(
    '%s: two variants per tone, short, kind and with a fact',
    (_name, rule) => {
      for (const tone of TONES) {
        const variants = rule.copy[tone];
        expect(variants.length, `${rule.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const v of variants) {
          const line = filled(v);
          expect(line, `${rule.id}: "${v}"`).not.toMatch(BANNED);
          expect(line.length, `${rule.id}: "${line}"`).toBeLessThanOrEqual(MAX_LINE);
          // Placeholders all filled: nothing like "{x}" survives.
          expect(line, `${rule.id}: "${v}"`).not.toMatch(/\{\w+(\|time)?\}/);
        }
      }
      expect(rule.title).not.toMatch(BANNED);
      if (rule.wholesomeTitle) expect(rule.wholesomeTitle).not.toMatch(BANNED);
      expect(rule.emoji.length).toBeGreaterThan(0);
    },
  );

  it('blunders read kindly in Wholesome mode', () => {
    for (const { rule } of everyRule.filter(({ rule }) => rule.valence === 'chaos')) {
      for (const v of rule.copy.wholesome) expect(v, rule.id).not.toMatch(BANNED);
      // The wholesome copy is a reframing, not the cheeky line again.
      expect(rule.copy.wholesome).not.toEqual(rule.copy.cheeky);
    }
  });

  it('timeout awards never reach the night card', () => {
    const timeouts = everyRule.filter(({ rule }) =>
      /radio-silence|autopilot|sleepwalker/.test(rule.id),
    );
    expect(timeouts.length).toBeGreaterThan(0);
    for (const { rule } of timeouts) expect((rule as AwardRule).stripOnly).toBe(true);
  });
});
