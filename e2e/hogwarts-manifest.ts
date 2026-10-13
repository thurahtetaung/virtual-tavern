import type { Words } from './hydra-play.ts';

// A made-up manifest for Hydra's themed edition (the real one is private), shared by its spec and
// the screenshots.

export const MANIFEST = {
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
  copy: {
    'talk.claims': 'Grill the {president} and the {chancellor} before the next nomination.',
    'moment.cleared.stamp': 'Cleared: not {leaderName}',
  },
  colors: { blue: '#9b2335', red: '#6b3fa0' },
};

export const WORDS: Words = {
  create: /Create an? Hydra: Wands room/,
  team: { blue: 'Glow', red: 'Dusk' },
  blue: 'Sunlit',
  red: 'Shadowed',
  leader: 'Archon',
  yes: 'Bright',
  no: 'Dim',
  president: 'Warden',
  chancellor: 'Keeper',
  candidate: 'Warden-elect',
  policy: 'edict',
  policies: 'edicts',
};
