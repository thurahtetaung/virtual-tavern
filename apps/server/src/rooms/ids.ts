import { createHash, randomInt } from 'node:crypto';

const ADJECTIVES = [
  'amber',
  'brave',
  'bright',
  'calm',
  'clever',
  'cosy',
  'crimson',
  'dusty',
  'eager',
  'fancy',
  'gentle',
  'golden',
  'grand',
  'happy',
  'hidden',
  'jolly',
  'keen',
  'lively',
  'lucky',
  'merry',
  'misty',
  'noble',
  'odd',
  'proud',
  'quiet',
  'rapid',
  'royal',
  'rusty',
  'silver',
  'sleepy',
  'snowy',
  'sunny',
  'swift',
  'tidy',
  'velvet',
  'witty',
];
const NOUNS = [
  'anchor',
  'badger',
  'barrel',
  'candle',
  'castle',
  'cellar',
  'dragon',
  'falcon',
  'flagon',
  'fox',
  'goblet',
  'griffin',
  'hearth',
  'kettle',
  'lantern',
  'lute',
  'meadow',
  'mill',
  'moose',
  'otter',
  'owl',
  'pony',
  'quill',
  'raven',
  'river',
  'rook',
  'stag',
  'tankard',
  'thistle',
  'toad',
  'tower',
  'trout',
  'wagon',
  'walrus',
  'willow',
  'wren',
];
const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

const pick = (items: readonly string[]) => items[randomInt(items.length)]!;

/** Readable, hard-to-guess room slug, e.g. `amber-otter-lantern-7k3q`. */
export function newRoomId(): string {
  const suffix = Array.from({ length: 4 }, () => pick([...ALPHANUM])).join('');
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}-${suffix}`;
}

/**
 * Public player id derived from the browser's secret token. Ids are shown to other players;
 * tokens never leave the owner's browser and the server, so ids cannot be used to impersonate.
 */
export function playerIdFromToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16);
}

export const randomSeed = () => randomInt(2 ** 32);
