/**
 * The board: 118 icons, numbered 1…118 in the printed board's order (column by column, each row
 * left then right). Code only knows the numbers and which group each is in; what an icon shows
 * and means comes from the private manifest.
 */

export const ICON_COUNT = 118;

export const GROUPS = ['things', 'qualities', 'matter', 'shapes', 'colours'] as const;
export type Group = (typeof GROUPS)[number];

/** Each group's ids, a column of the printed board. */
export const GROUP_RANGES: Record<Group, readonly [first: number, last: number]> = {
  things: [1, 28],
  qualities: [29, 56],
  matter: [57, 78],
  shapes: [79, 106],
  colours: [107, 118],
};

export const GROUP_LABELS: Record<Group, string> = {
  things: 'Things',
  qualities: 'Qualities',
  matter: 'Matter',
  shapes: 'Shapes',
  colours: 'Colours',
};

export const GROUP_EMOJI: Record<Group, string> = {
  things: '📦',
  qualities: '💗',
  matter: '🔥',
  shapes: '🔺',
  colours: '🎨',
};

/** What each group holds, in plain words (the guide and the phone tabs). */
export const GROUP_TEXT: Record<Group, string> = {
  things:
    'The big categories: people, animals, plants, places, buildings, vehicles, food, clothes, films, music, books, games, ideas and speech.',
  qualities:
    'What something is like: real or made up, young or old, slow or fast, love or death, happy or sad, money, time, power, science, medicine, and the body and senses.',
  matter:
    'What things are made of and the world around them: weather, night and day, fire, water, air, earth, rock, wood, metal, cloth, paper, and ideas like opposite, cut, part or inside.',
  shapes:
    'Lines, curves, shapes and solids, sizes, and directions: up, down, left, right, turning and switching on.',
  colours: 'Twelve colours, from red to see-through.',
};

export const isIcon = (n: number) => Number.isInteger(n) && n >= 1 && n <= ICON_COUNT;

export function groupOf(icon: number): Group {
  for (const g of GROUPS) {
    const [a, b] = GROUP_RANGES[g];
    if (icon >= a && icon <= b) return g;
  }
  throw new Error(`No icon ${icon}`);
}

/** A group's ids in board order. */
export function iconsOf(group: Group): number[] {
  const [a, b] = GROUP_RANGES[group];
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export const ALL_ICONS: readonly number[] = Array.from({ length: ICON_COUNT }, (_, i) => i + 1);
