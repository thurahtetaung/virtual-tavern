import { describe, expect, it } from 'vitest';
import { COPY, type CopyKey, copyLine, fillVars } from './copy.ts';
import { defineHydra, hydra } from './game.ts';
import { guide, nameGuide } from './guide.ts';
import { type Manifest, creditOf, footerOf, namesOf, powerNamesOf } from './manifest.ts';
import { PLACEHOLDER_NAMES, POWER_NAMES, POWER_TEXT, fillNames } from './names.ts';

/** A made-up edition: every name a neutral word Hydra never uses. */
const FAKE: Manifest = {
  title: 'Lantern',
  names: {
    blue: 'Glow',
    blues: 'Glows',
    red: 'Dusk',
    reds: 'Dusks',
    leader: 'the Archon',
    yes: 'Bright',
    no: 'Dim',
    president: 'Warden',
    chancellor: 'Keeper',
    candidate: 'Warden-elect',
    presidentShort: 'Ward',
    chancellorShort: 'Keep',
    policy: 'edict',
    policies: 'edicts',
    party: 'sigil',
    veto: 'quench',
    bluePolicy: 'Sunlit',
    redPolicy: 'Shadowed',
  },
  powers: {
    investigate: { name: 'Scry' },
    special: { name: 'Beckon' },
    peek: { name: 'Glimpse' },
    execute: { name: 'Snuff' },
  },
};

/** Hydra's own words: none may survive in an edition that names everything. */
const HYDRA_WORDS =
  /\b(Hydra|President|Presidential|Chancellor|Pres|Chanc|polic(y|ies)|party|veto|Loyalists?|Conspirators?|Usurper)\b/i;

/** Every copy line with every variable filled, so only names are left to check. */
const VARS = {
  P: 'Ana',
  C: 'Ben',
  player: 'Cy',
  target: 'Dee',
  voted: 3,
  alive: 5,
  ready: 2,
  total: 5,
  power: 'Scry',
  ballot: 'Bright',
  n: 1,
  of: 5,
  zone: 3,
  from: 1,
  to: 2,
  leaderName: 'Archon',
  timeout: '',
  what: 'a card was discarded',
  by: 'the host',
};

const lines = (names = namesOf(FAKE)) =>
  (Object.keys(COPY) as CopyKey[]).map((k) => [k, fillNames(fillVars(COPY[k], VARS), names)]);

const guideText = (g: ReturnType<typeof nameGuide>) => JSON.stringify(g);

describe('names', () => {
  it('fills lower and capitalised tokens and leaves anything else alone', () => {
    const n = namesOf(FAKE);
    expect(fillNames('the {president} and the {Policy} of {leader}: {Leader}', n)).toBe(
      'the Warden and the Edict of the Archon: The Archon',
    );
    expect(fillNames('{player} and {P} stay', n)).toBe('{player} and {P} stay');
    // "a" turns into "an" before a name that starts with a vowel, and stays "a" otherwise.
    const vowels = { ...n, veto: 'Ember-snuff', blue: 'Owl' };
    expect(fillNames('ask for a {veto}, a {policy} or A {blue}', vowels)).toBe(
      'ask for an Ember-snuff, an edict or An Owl',
    );
    expect(fillNames('a {veto}', PLACEHOLDER_NAMES)).toBe('a veto');
  });

  it('keeps Hydra’s words without a manifest, and a card adjective follows its team', () => {
    expect(namesOf(null)).toEqual(PLACEHOLDER_NAMES);
    const n = namesOf({ names: { blue: 'Fern', red: 'Briar' } });
    expect([n.bluePolicy, n.redPolicy]).toEqual(['Fern', 'Briar']);
    expect(n.president).toBe('President');
    expect(namesOf({ names: { blue: 'Fern', bluePolicy: 'Leafy' } }).bluePolicy).toBe('Leafy');
  });
});

describe('Hydra is unchanged with its own words', () => {
  it('every copy line reads as Hydra’s, with no token left over', () => {
    for (const [k, text] of lines(PLACEHOLDER_NAMES)) expect(text, k).not.toMatch(/\{[A-Za-z]+\}/);
    const say = (k: CopyKey, vars = {}) =>
      fillNames(fillVars(copyLine(undefined, k), { ...VARS, ...vars }), PLACEHOLDER_NAMES);
    expect(say('status.nominate.you')).toBe(
      'You’re the Presidential Candidate: nominate a Chancellor. Greyed seats can’t be picked (tap one to see why).',
    );
    expect(say('status.vote.you')).toBe(
      'Vote Yes or No on President Ana with Chancellor Ben. 3 of 5 voted.',
    );
    expect(say('moment.enact.red')).toBe('A Conspirator policy');
    expect(say('moment.leaderCheck.question')).toBe('Is the new Chancellor the Usurper?');
    expect(say('end.reason.leader-elected')).toBe(
      'The Usurper was elected Chancellor in the danger zone.',
    );
    expect(say('ribbon.veto')).toBe('Veto unlocked');
    expect(fillNames(POWER_NAMES.peek, PLACEHOLDER_NAMES)).toBe('Policy peek');
  });

  it('the guide has no token left over', () => {
    expect(guideText(guide)).not.toMatch(/\{[A-Za-z:]+\}/);
    expect(guide.sections.find((s) => s.title === '1. Nomination')?.paragraphs?.[0]).toMatch(
      /^The Presidential Candidate nominates any eligible player as Chancellor\./,
    );
  });
});

describe('an edition names everything', () => {
  it('every copy line, power text and the guide use only its words', () => {
    for (const [k, text] of lines()) expect(text, k).not.toMatch(HYDRA_WORDS);
    for (const text of Object.values(POWER_TEXT))
      expect(fillNames(text, namesOf(FAKE))).not.toMatch(HYDRA_WORDS);
    const named = nameGuide(namesOf(FAKE), undefined, powerNamesOf(FAKE));
    const text = guideText(named);
    expect(text).not.toMatch(/\{[A-Za-z:]+\}/);
    // The guide's own furniture ("5 to 10 players") aside, Hydra's words are all gone.
    expect(text.replace(/Quick reference/g, '')).not.toMatch(HYDRA_WORDS);
    expect(text).toContain('Glimpse');
    expect(text).toContain('Warden-elect');
  });

  it('copy lines come from the manifest where it has them, with variables and names', () => {
    const copy = { 'status.chaos': 'The {reds} storm the hall, {P}!', 'not.a.key': 'x', nudged: 7 };
    expect(copyLine(copy, 'status.chaos')).toBe('The {reds} storm the hall, {P}!');
    expect(fillNames(fillVars(copyLine(copy, 'status.chaos'), { P: 'Ana' }), namesOf(FAKE))).toBe(
      'The Dusks storm the hall, Ana!',
    );
    // A missing, blank or non-text line falls back to Hydra's.
    expect(copyLine(copy, 'status.dead')).toBe(COPY['status.dead']);
    expect(copyLine({ nudged: '  ' }, 'nudged')).toBe(COPY.nudged);
    expect(copyLine(copy, 'nudged')).toBe(COPY.nudged);
    expect(copyLine(null, 'nudged')).toBe(COPY.nudged);
    // Unknown variables stay as written.
    expect(fillVars('{P} and {nobody}', { P: 'Ana' })).toBe('Ana and {nobody}');
  });

  it('credits the edition’s artist next to the original game', () => {
    const credit = creditOf({
      credit: {
        game: 'The original',
        link: 'https://example.com/game',
        art: { name: 'Some Artist', link: 'https://example.com/art' },
        text: 'Credits.',
      },
    });
    expect(credit?.links).toEqual([
      { label: 'The original', href: 'https://example.com/game' },
      { label: 'Art: Some Artist', href: 'https://example.com/art' },
    ]);
    expect(footerOf(credit)?.links).toContainEqual({
      label: 'Art: Some Artist',
      href: 'https://example.com/art',
    });
  });
});

describe('editions', () => {
  it('share the engine under their own id, in the back room', () => {
    const e = defineHydra({ id: 'edition', name: 'Edition', description: 'x', guide });
    expect(e.id).toBe('edition');
    expect(e.access).toBe('private');
    // Everything but the id, the name and the blurb is Hydra's own (functions compared by reference).
    expect({ ...e, id: hydra.id, name: hydra.name, description: hydra.description }).toEqual(hydra);
    expect(hydra.id).toBe('hydra');
  });
});
