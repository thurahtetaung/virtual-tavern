/**
 * The cards: 23 dish types in five groups, 181 cards. Ids are plain dish words; the names players
 * see and the art come from the private manifest, with these words as the fallback.
 */

export type Group = 'nigiri' | 'rolls' | 'appetizers' | 'specials' | 'desserts';

export type TypeId =
  | 'nigiri'
  | 'maki'
  | 'temaki'
  | 'uramaki'
  | 'tempura'
  | 'sashimi'
  | 'dumpling'
  | 'eel'
  | 'tofu'
  | 'onigiri'
  | 'edamame'
  | 'miso'
  | 'chopsticks'
  | 'spoon'
  | 'menu'
  | 'takeout'
  | 'order'
  | 'soy'
  | 'tea'
  | 'wasabi'
  | 'pudding'
  | 'icecream'
  | 'fruit';

export type Fruit = 'w' | 'p' | 'o';
export type Shape = 'circle' | 'triangle' | 'square' | 'rectangle';

export interface Variant {
  id: string;
  type: TypeId;
  count: number;
  /** Nigiri: face value. */
  points?: number;
  /** Maki and uramaki: roll icons. */
  icons?: number;
  shape?: Shape;
  /** Fruit icons on the card. */
  fruit?: Partial<Record<Fruit, number>>;
  /** The order number of a card that acts in turn (chopsticks, spoon, menu, takeout box). */
  no?: number;
}

export interface TypeInfo {
  id: TypeId;
  group: Group;
  /** The player counts the type may be used with. */
  players: [number, number];
  /** Background colour for tea and soy sauce: nigiri and wasabi share one. */
  colour: string;
  emoji: string;
  /** The plain fallback name. */
  name: string;
  /** One line on how it scores (fallback; the guide has more). */
  short: string;
  variants: Variant[];
}

const v = (type: TypeId, count: number, extra: Partial<Variant> = {}, id: string = type) => ({
  id,
  type,
  count,
  ...extra,
});

const numbered = (type: TypeId, nos: number[]) =>
  nos.map((no) => v(type, 1, { no }, `${type}-${no}`));

export const TYPES: Record<TypeId, TypeInfo> = {
  nigiri: {
    id: 'nigiri',
    group: 'nigiri',
    players: [2, 8],
    colour: 'yellow',
    emoji: '🍣',
    name: 'Nigiri',
    short: '1, 2 or 3 points; ×3 on a wasabi',
    variants: [
      v('nigiri', 4, { points: 1 }, 'nigiri-egg'),
      v('nigiri', 5, { points: 2 }, 'nigiri-salmon'),
      v('nigiri', 3, { points: 3 }, 'nigiri-squid'),
    ],
  },
  maki: {
    id: 'maki',
    group: 'rolls',
    players: [2, 8],
    colour: 'maki',
    emoji: '🍥',
    name: 'Maki',
    short: 'Most roll icons 6, second 3 (6/4/2 with 6+)',
    variants: [1, 2, 3].map((n, i) => v('maki', [4, 5, 3][i]!, { icons: n }, `maki-${n}`)),
  },
  temaki: {
    id: 'temaki',
    group: 'rolls',
    players: [2, 8],
    colour: 'temaki',
    emoji: '🌯',
    name: 'Temaki',
    short: 'Most +4, fewest −4',
    variants: [v('temaki', 12)],
  },
  uramaki: {
    id: 'uramaki',
    group: 'rolls',
    players: [2, 8],
    colour: 'uramaki',
    emoji: '🍱',
    name: 'Uramaki',
    short: 'First to 10 icons 8, then 5, then 2',
    variants: [3, 4, 5].map((n) => v('uramaki', 4, { icons: n }, `uramaki-${n}`)),
  },
  tempura: {
    id: 'tempura',
    group: 'appetizers',
    players: [2, 8],
    colour: 'tempura',
    emoji: '🍤',
    name: 'Tempura',
    short: 'Each pair 5',
    variants: [v('tempura', 8)],
  },
  sashimi: {
    id: 'sashimi',
    group: 'appetizers',
    players: [2, 8],
    colour: 'sashimi',
    emoji: '🐟',
    name: 'Sashimi',
    short: 'Each three 10',
    variants: [v('sashimi', 8)],
  },
  dumpling: {
    id: 'dumpling',
    group: 'appetizers',
    players: [2, 8],
    colour: 'dumpling',
    emoji: '🥟',
    name: 'Dumpling',
    short: '1 3 6 10 15',
    variants: [v('dumpling', 8)],
  },
  eel: {
    id: 'eel',
    group: 'appetizers',
    players: [2, 8],
    colour: 'eel',
    emoji: '🐍',
    name: 'Eel',
    short: 'One −3, two or more 7',
    variants: [v('eel', 8)],
  },
  tofu: {
    id: 'tofu',
    group: 'appetizers',
    players: [2, 8],
    colour: 'tofu',
    emoji: '🧈',
    name: 'Tofu',
    short: 'One 2, two 6, three or more 0',
    variants: [v('tofu', 8)],
  },
  onigiri: {
    id: 'onigiri',
    group: 'appetizers',
    players: [2, 8],
    colour: 'onigiri',
    emoji: '🍙',
    name: 'Onigiri',
    short: 'Different shapes: 1 4 9 16',
    variants: (['circle', 'triangle', 'square', 'rectangle'] as const).map((shape) =>
      v('onigiri', 2, { shape }, `onigiri-${shape}`),
    ),
  },
  edamame: {
    id: 'edamame',
    group: 'appetizers',
    players: [3, 8],
    colour: 'edamame',
    emoji: '🫛',
    name: 'Edamame',
    short: '1 per opponent with edamame (up to 4)',
    variants: [v('edamame', 8)],
  },
  miso: {
    id: 'miso',
    group: 'appetizers',
    players: [2, 8],
    colour: 'miso',
    emoji: '🍲',
    name: 'Miso soup',
    short: '3, unless two are played in one turn',
    variants: [v('miso', 8)],
  },
  chopsticks: {
    id: 'chopsticks',
    group: 'specials',
    players: [2, 8],
    colour: 'chopsticks',
    emoji: '🥢',
    name: 'Chopsticks',
    short: 'Later: play a second card from your hand',
    variants: numbered('chopsticks', [1, 2, 3]),
  },
  spoon: {
    id: 'spoon',
    group: 'specials',
    players: [3, 8],
    colour: 'spoon',
    emoji: '🥄',
    name: 'Spoon',
    short: 'Later: ask for a card from another hand',
    variants: numbered('spoon', [4, 5, 6]),
  },
  menu: {
    id: 'menu',
    group: 'specials',
    players: [2, 6],
    colour: 'menu',
    emoji: '📜',
    name: 'Menu',
    short: 'Draw 4, play 1 of them',
    variants: numbered('menu', [7, 8, 9]),
  },
  takeout: {
    id: 'takeout',
    group: 'specials',
    players: [2, 8],
    colour: 'takeout',
    emoji: '🥡',
    name: 'Takeout box',
    short: 'Turn earlier cards face down: 2 each',
    variants: numbered('takeout', [10, 11, 12]),
  },
  order: {
    id: 'order',
    group: 'specials',
    players: [2, 6],
    colour: 'order',
    emoji: '🌈',
    name: 'Special order',
    short: 'Copies a card you played earlier',
    variants: [v('order', 3)],
  },
  soy: {
    id: 'soy',
    group: 'specials',
    players: [2, 8],
    colour: 'soy',
    emoji: '🫙',
    name: 'Soy sauce',
    short: 'Most colours: 4',
    variants: [v('soy', 3)],
  },
  tea: {
    id: 'tea',
    group: 'specials',
    players: [2, 8],
    colour: 'tea',
    emoji: '🍵',
    name: 'Tea',
    short: '1 per card of your biggest colour',
    variants: [v('tea', 3)],
  },
  wasabi: {
    id: 'wasabi',
    group: 'specials',
    players: [2, 8],
    colour: 'yellow',
    emoji: '🌿',
    name: 'Wasabi',
    short: 'Your next nigiri on it scores ×3',
    variants: [v('wasabi', 3)],
  },
  pudding: {
    id: 'pudding',
    group: 'desserts',
    players: [2, 8],
    colour: 'pudding',
    emoji: '🍮',
    name: 'Pudding',
    short: 'Game end: most +6, fewest −6',
    variants: [v('pudding', 15)],
  },
  icecream: {
    id: 'icecream',
    group: 'desserts',
    players: [2, 8],
    colour: 'icecream',
    emoji: '🍨',
    name: 'Ice cream',
    short: 'Game end: each four 12',
    variants: [v('icecream', 15)],
  },
  fruit: {
    id: 'fruit',
    group: 'desserts',
    players: [2, 8],
    colour: 'fruit',
    emoji: '🍉',
    name: 'Fruit',
    short: 'Game end: per fruit −2 0 1 3 6 10',
    variants: [
      v('fruit', 2, { fruit: { w: 2 } }, 'fruit-ww'),
      v('fruit', 2, { fruit: { p: 2 } }, 'fruit-pp'),
      v('fruit', 2, { fruit: { o: 2 } }, 'fruit-oo'),
      v('fruit', 3, { fruit: { w: 1, p: 1 } }, 'fruit-wp'),
      v('fruit', 3, { fruit: { w: 1, o: 1 } }, 'fruit-wo'),
      v('fruit', 3, { fruit: { p: 1, o: 1 } }, 'fruit-po'),
    ],
  },
};

export const TYPE_IDS = Object.keys(TYPES) as TypeId[];

export const VARIANTS: Record<string, Variant> = Object.fromEntries(
  TYPE_IDS.flatMap((t) => TYPES[t].variants.map((x) => [x.id, x])),
);

export const isVariant = (id: string): boolean => Object.hasOwn(VARIANTS, id);
export const variantOf = (id: string): Variant => VARIANTS[id]!;
export const typeOf = (variant: string): TypeId => VARIANTS[variant]!.type;
export const groupOf = (variant: string): Group => TYPES[typeOf(variant)].group;
export const isDessert = (variant: string) => groupOf(variant) === 'desserts';

/** The menu's shape: nigiri always, plus these many types of each group. */
export const MENU_SHAPE: Record<Exclude<Group, 'nigiri'>, number> = {
  rolls: 1,
  appetizers: 3,
  specials: 2,
  desserts: 1,
};

export const GROUPS: Group[] = ['nigiri', 'rolls', 'appetizers', 'specials', 'desserts'];
export const typesIn = (group: Group): TypeId[] => TYPE_IDS.filter((t) => TYPES[t].group === group);

/** Cards dealt to each player, by table size. */
export const HAND_SIZE: Record<number, number> = { 2: 10, 3: 10, 4: 9, 5: 9, 6: 8, 7: 8, 8: 7 };

/** Desserts shuffled into the deck before each round. */
export const dessertsFor = (players: number, round: number): number =>
  (players >= 6 ? [7, 5, 3] : [5, 3, 2])[round - 1] ?? 0;

/** Maki points by place. */
export const makiPlaces = (players: number): number[] => (players >= 6 ? [6, 4, 2] : [6, 3]);

/** Uramaki points by place (the race to 10 icons, then the round's end). */
export const URAMAKI_PLACES = [8, 5, 2];
export const URAMAKI_GOAL = 10;

export const DUMPLING = [0, 1, 3, 6, 10, 15];
export const ONIGIRI = [0, 1, 4, 9, 16];
export const FRUIT = [-2, 0, 1, 3, 6, 10];

/** Whether a type may be used with this many players. */
export const allowedAt = (type: TypeId, players: number) =>
  players >= TYPES[type].players[0] && players <= TYPES[type].players[1];

// ---- Menus ----

export interface MenuPreset {
  id: string;
  /** Plain fallback name (the manifest may rename it). */
  name: string;
  blurb: string;
  types: TypeId[];
}

/** The eight suggested menus. */
export const PRESETS: MenuPreset[] = [
  {
    id: 'first',
    name: 'Easy start',
    blurb: 'Gentle and simple: a good first game.',
    types: ['maki', 'tempura', 'sashimi', 'miso', 'wasabi', 'tea', 'icecream'],
  },
  {
    id: 'classic',
    name: 'Old favourites',
    blurb: 'The original small box’s dishes.',
    types: ['maki', 'tempura', 'sashimi', 'dumpling', 'chopsticks', 'wasabi', 'pudding'],
  },
  {
    id: 'sampler',
    name: 'Party mix',
    blurb: 'A taste of everything, with a menu to order from.',
    types: ['temaki', 'tempura', 'dumpling', 'tofu', 'wasabi', 'menu', 'icecream'],
  },
  {
    id: 'master',
    name: 'Deep cuts',
    blurb: 'Clever plays: spoons, takeout and fruit.',
    types: ['temaki', 'onigiri', 'tofu', 'sashimi', 'spoon', 'takeout', 'fruit'],
  },
  {
    id: 'points',
    name: 'High scores',
    blurb: 'Big numbers: uramaki races and copies.',
    types: ['uramaki', 'onigiri', 'dumpling', 'edamame', 'order', 'tea', 'icecream'],
  },
  {
    id: 'cutthroat',
    name: 'Sharp elbows',
    blurb: 'Interactive and in your face.',
    types: ['temaki', 'eel', 'tofu', 'miso', 'spoon', 'soy', 'pudding'],
  },
  {
    id: 'banquet',
    name: 'Big table',
    blurb: 'Works well with 6 to 8.',
    types: ['maki', 'tempura', 'dumpling', 'eel', 'spoon', 'chopsticks', 'icecream'],
  },
  {
    id: 'two',
    name: 'Table for two',
    blurb: 'Works well with 2.',
    types: ['uramaki', 'onigiri', 'tofu', 'miso', 'menu', 'order', 'fruit'],
  },
];

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id);

/** Why these types aren't a menu for this many players, or null. */
export function menuProblem(types: readonly TypeId[], players: number | null): string | null {
  const set = new Set(types);
  if (set.size !== types.length || types.some((t) => !TYPES[t])) return 'Pick each dish once.';
  if (set.has('nigiri')) return 'Nigiri is always on the menu.';
  for (const [group, n] of Object.entries(MENU_SHAPE) as [Exclude<Group, 'nigiri'>, number][]) {
    const have = types.filter((t) => TYPES[t].group === group).length;
    if (have !== n) return `A menu has ${n} ${GROUP_WORDS[group][n === 1 ? 0 : 1]} (${have} now).`;
  }
  if (players !== null) {
    const bad = types.filter((t) => !allowedAt(t, players));
    if (bad.length)
      return `${bad.map((t) => TYPES[t].name).join(' and ')} can’t be played with ${players} players.`;
  }
  return null;
}

export const GROUP_WORDS: Record<Group, [string, string]> = {
  nigiri: ['nigiri', 'nigiri'],
  rolls: ['roll', 'rolls'],
  appetizers: ['appetizer', 'appetizers'],
  specials: ['special', 'specials'],
  desserts: ['dessert', 'desserts'],
};

/** A random legal menu for this many players. */
export function randomMenu(players: number, pick: (n: number) => number): TypeId[] {
  const out: TypeId[] = [];
  for (const [group, n] of Object.entries(MENU_SHAPE) as [Exclude<Group, 'nigiri'>, number][]) {
    const pool = typesIn(group).filter((t) => allowedAt(t, players));
    for (let i = 0; i < n; i++) out.push(pool.splice(pick(pool.length), 1)[0]!);
  }
  return out;
}

/** The whole menu in display order: nigiri first, then each group. */
export const fullMenu = (types: readonly TypeId[]): TypeId[] => [
  'nigiri',
  ...GROUPS.slice(1).flatMap((g) => types.filter((t) => TYPES[t].group === g)),
];

/** Every variant of a menu's main deck (54 cards) and of its dessert. */
export function cardsOf(types: readonly TypeId[]): { main: string[]; desserts: string[] } {
  const main: string[] = [];
  const desserts: string[] = [];
  for (const t of ['nigiri', ...types] as TypeId[])
    for (const x of TYPES[t].variants)
      for (let i = 0; i < x.count; i++)
        (TYPES[t].group === 'desserts' ? desserts : main).push(x.id);
  return { main, desserts };
}
