// The fixed tables: genres per deck, the genre goals, the describing styles and the table modes.
// Names here are plain words; unlocked browsers may get others from the private manifest.

export type DeckKind = 'films' | 'tv';

export interface GenreInfo {
  id: string;
  name: string;
  emoji: string;
  /** The tape's colour (the genre's identity colour, as on its tape, the same in both themes). */
  colour: string;
}

/** The films' twelve genres: the base eight, then the four of the second box. */
export const FILM_GENRES: readonly GenreInfo[] = [
  { id: 'action', name: 'Action', emoji: '💥', colour: '#e07316' },
  { id: 'classics', name: 'All-Time Classics', emoji: '🎞️', colour: '#1f5fae' },
  { id: 'drama', name: 'Drama', emoji: '🎭', colour: '#4ba3b0' },
  { id: 'comedy', name: 'Comedy', emoji: '😂', colour: '#c99400' },
  { id: 'horror', name: 'Horror', emoji: '👻', colour: '#9a3412' },
  { id: 'family', name: 'Family', emoji: '👨‍👩‍👧', colour: '#c45ba5' },
  { id: 'animation', name: 'Animation', emoji: '🧸', colour: '#6d4bb0' },
  { id: 'scifi', name: 'Sci-Fi & Fantasy', emoji: '🚀', colour: '#5f9a24' },
  { id: 'heart', name: 'Heartwarmers', emoji: '💗', colour: '#d63f86' },
  { id: 'otherworld', name: 'From Another World', emoji: '🌍', colour: '#24894a' },
  { id: 'remakes', name: 'Remakes & Reboots', emoji: '🔁', colour: '#2c56c4' },
  { id: 'adult', name: 'Not for Kids', emoji: '🔞', colour: '#dc3d26' },
];

/** The TV deck's eight genres (one of each wins). Six share their ids (and tapes) with films. */
export const TV_GENRES: readonly GenreInfo[] = [
  { id: 'action', name: 'Action', emoji: '💥', colour: '#e07316' },
  { id: 'classics', name: 'Classic TV', emoji: '📺', colour: '#1f5fae' },
  { id: 'drama', name: 'Drama', emoji: '🎭', colour: '#4ba3b0' },
  { id: 'comedy', name: 'Comedy', emoji: '😂', colour: '#c99400' },
  { id: 'crime', name: 'Crime', emoji: '🕵️', colour: '#9a3412' },
  { id: 'reality', name: 'Reality TV', emoji: '🎤', colour: '#d63f86' },
  { id: 'animation', name: 'Animated', emoji: '🧸', colour: '#6d4bb0' },
  { id: 'scifi', name: 'Sci-Fi & Fantasy', emoji: '🚀', colour: '#5f9a24' },
];

export const FILM_GENRE_IDS = FILM_GENRES.map((g) => g.id);
export const TV_GENRE_IDS = TV_GENRES.map((g) => g.id);
export const BASE_GENRES = FILM_GENRE_IDS.slice(0, 8);
export const RETURNS_GENRES = FILM_GENRE_IDS.slice(8);

/** A deck's genre table. */
export const genresOf = (deck: DeckKind): readonly GenreInfo[] =>
  deck === 'tv' ? TV_GENRES : FILM_GENRES;

const BY_ID: Record<DeckKind, Map<string, GenreInfo>> = {
  films: new Map(FILM_GENRES.map((g) => [g.id, g])),
  tv: new Map(TV_GENRES.map((g) => [g.id, g])),
};
export const genreInfo = (id: string, deck: DeckKind = 'films'): GenreInfo =>
  BY_ID[deck].get(id) ?? { id, name: id, emoji: '🎬', colour: '#57534e' };

/**
 * What wins: `each` card of every genre in `genres`. The host picks the genres (at least
 * `MIN_GENRES`) and 1 or 2 of each; the film presets set both. Rooms saved before the genre picks
 * have only a preset (`Settings.goal`), which still reads as its genres.
 */
export type GoalId = 'base' | 'all' | 'returns' | 'tv';
export type FilmGoal = Exclude<GoalId, 'tv'>;
export type Each = 1 | 2;

export interface Goal {
  genres: readonly string[];
  /** Cards of each genre needed. */
  each: number;
}

export const GOALS: Record<GoalId, Goal> = {
  base: { genres: BASE_GENRES, each: 1 },
  all: { genres: FILM_GENRE_IDS, each: 1 },
  returns: { genres: RETURNS_GENRES, each: 2 },
  tv: { genres: TV_GENRE_IDS, each: 1 },
};
export const FILM_PRESETS: readonly FilmGoal[] = ['base', 'all', 'returns'];

export const MIN_GENRES = 4;
/**
 * Titles a genre needs in the chosen packs per card of it the goal asks for. A genre runs dry only
 * once every title of it is collected or on the table; ten a card leaves room for both teams'
 * copies, the six on the table and a long game's spare collected copies.
 */
export const TITLES_PER_CARD = 10;
export const titlesNeeded = (each: number) => TITLES_PER_CARD * each;

/** The goal settings pick (the genres in table order). */
export function goalFor(s: {
  deck: DeckKind;
  goal: FilmGoal;
  filmGenres?: string[];
  tvGenres?: string[];
  each?: Each;
}): Goal {
  const preset = GOALS[s.deck === 'tv' ? 'tv' : s.goal];
  const picked = (s.deck === 'tv' ? s.tvGenres : s.filmGenres) ?? preset.genres;
  return {
    genres: genresOf(s.deck)
      .map((g) => g.id)
      .filter((id) => picked.includes(id)),
    each: s.each ?? preset.each,
  };
}

/** The film preset a goal is, if any. */
export const presetOf = (goal: Goal): FilmGoal | null =>
  FILM_PRESETS.find(
    (id) =>
      GOALS[id].each === goal.each &&
      GOALS[id].genres.length === goal.genres.length &&
      GOALS[id].genres.every((g) => goal.genres.includes(g)),
  ) ?? null;

/** The goal in a line: "Collect 1 of each of 7 genres". */
export const goalLine = (goal: Goal) =>
  `Collect ${goal.each} of each of ${goal.genres.length} genres`;

/** How far a collection is towards the goal: `have` of `need` cards that count. */
export function progress(genres: readonly string[], goal: Goal): { have: number; need: number } {
  const counts = new Map<string, number>();
  for (const g of genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  const have = goal.genres.reduce((n, g) => n + Math.min(goal.each, counts.get(g) ?? 0), 0);
  return { have, need: goal.genres.length * goal.each };
}

export const complete = (genres: readonly string[], goal: Goal) => {
  const p = progress(genres, goal);
  return p.have >= p.need;
};

/** Genres a card would still count towards. */
export function missing(genres: readonly string[], goal: Goal): string[] {
  return goal.genres.filter((g) => genres.filter((x) => x === g).length < goal.each);
}

// ---- Styles and modes ----

export type StyleId = 'one-word' | 'quote' | 'act' | 'describe-badly' | 'cast';
export const STYLE_IDS: readonly StyleId[] = ['one-word', 'quote', 'act', 'describe-badly', 'cast'];

/** What a voice call plays instead of Act It: on Voice call squares and for a player on a call. */
export type ActAlt = 'describe-badly' | 'cast';
export const ACT_ALTS: readonly ActAlt[] = ['describe-badly', 'cast'];

export interface StyleInfo {
  id: StyleId;
  name: string;
  emoji: string;
  /** What the describer does, in one line. */
  how: string;
  /** Works over a voice call. */
  voiceSafe: boolean;
}

export const STYLES: Record<StyleId, StyleInfo> = {
  'one-word': {
    id: 'one-word',
    name: 'One Word',
    emoji: '☝️',
    how: 'Say one word only. Repeat it as often as you like.',
    voiceSafe: true,
  },
  quote: {
    id: 'quote',
    name: 'Quote It',
    emoji: '💬',
    how: 'Shout a quote from it. Don’t know one? Make it up.',
    voiceSafe: true,
  },
  act: {
    id: 'act',
    name: 'Act It',
    emoji: '🤸',
    how: 'Act it out in silence. No talking, no sounds.',
    voiceSafe: false,
  },
  'describe-badly': {
    id: 'describe-badly',
    name: 'Describe It Badly',
    emoji: '🙃',
    how: 'Describe the plot in a deliberately terrible but true way: Titanic is “a rich girl lets a poor guy freeze to death”.',
    voiceSafe: true,
  },
  cast: {
    id: 'cast',
    name: 'Name the Cast',
    emoji: '🌟',
    how: 'Name actors who are in it (for a show, characters work too). No words from the title.',
    voiceSafe: true,
  },
};

export type ModeId = 'room' | 'video' | 'voice' | 'mix';
export const MODE_IDS: readonly ModeId[] = ['room', 'video', 'voice', 'mix'];

export const MODES: Record<ModeId, { name: string; blurb: string; styles: StyleId[] }> = {
  room: {
    name: 'Same room',
    blurb: 'One Word · Quote It · Act It',
    styles: ['one-word', 'quote', 'act'],
  },
  video: {
    name: 'Video call',
    blurb: 'One Word · Quote It · Act It on camera',
    styles: ['one-word', 'quote', 'act'],
  },
  voice: {
    name: 'Voice call',
    blurb: 'One Word · Quote It · Describe It Badly',
    styles: ['one-word', 'quote', 'describe-badly'],
  },
  mix: { name: 'Mix', blurb: 'The host picks the styles', styles: ['one-word', 'quote', 'act'] },
};

/** The style a describer uses on a square: Act It moves to the room's alternative for a player on a call. */
export const styleFor = (
  style: StyleId,
  onCall: boolean,
  alt: ActAlt = 'describe-badly',
): StyleId => (onCall && !STYLES[style].voiceSafe ? alt : style);

/** A mode's squares, with Voice call's third one the room's alternative to Act It. */
export const modeStyles = (mode: ModeId, alt: ActAlt = 'describe-badly'): StyleId[] =>
  mode === 'voice' ? ['one-word', 'quote', alt] : [...MODES[mode].styles];

/** A mode's line of styles, naming the room's alternative to Act It on a voice call. */
export const modeBlurb = (mode: ModeId, alt: ActAlt = 'describe-badly'): string =>
  mode === 'voice' ? `One Word · Quote It · ${STYLES[alt].name}` : MODES[mode].blurb;

/** "film" or "show", for player-facing copy. */
export const nounOf = (deck: DeckKind, plural = false) =>
  deck === 'tv' ? (plural ? 'shows' : 'show') : plural ? 'films' : 'film';
