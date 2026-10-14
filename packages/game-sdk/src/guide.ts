/**
 * Beginner-friendly rules for a game, rendered by the web app's "How to play" page and in-game help.
 * Every game ships one, so all guides share the same structure.
 *
 * The page has four tabs: Learn (the goal and a short stepper), an optional browse tab (`tiles`),
 * Rules (`sections`, banded by `level`) and a Cheat sheet (`reference`, the glossary and tips).
 * Every field past `tips` is optional, so a guide without them still renders.
 */
export interface GameGuide {
  /** One sentence pitch shown on game cards. */
  tagline: string;
  players: string;
  duration: string;
  /** What you are trying to do, in one or two sentences. */
  goal: string;
  /**
   * The whole game in 5 or 6 short bullets ("what do I do now?"). The stepper shows them as its
   * steps when the guide has no `steps`.
   */
  quickStart?: string[];
  /** Short numbered steps to get a game going. */
  setup: string[];
  /** The rules, in reading order. */
  sections: GuideSection[];
  /** Who's who: shown on the Learn tab when the guide has no `tiles`. */
  roles?: GuideRole[];
  tips: string[];
  glossary?: { term: string; meaning: string }[];
  /** Shown last: credits for an adapted game (back-room games fill it from private storage). */
  footer?: GuideFooter;
  /** "How a game goes": 4 to 7 steps, each a short title and a sentence or two. */
  steps?: GuideStep[];
  /** What the last step says (after "That's the whole game"). */
  stepsDone?: string;
  /** The things to browse (roles, cards, heroes, locations), as tiles that open a card sheet. */
  tiles?: GuideTiles;
  /**
   * A second browse tab after the tiles: cards grouped under the tile they belong to (each hero's
   * deck), each with what it does in plain words.
   */
  catalog?: GuideCatalog;
  /** Small tables for the cheat sheet (scoring, the board, who wins). */
  reference?: GuideTable[];
  /**
   * Setups a reader can pick on the rules page (an edition, an expansion, a table size), so its
   * "In this game" filter works there too.
   */
  presets?: GuidePreset[];
  /**
   * What the room's state says about the guide: the options on, the cards in play, your role and
   * what happens now. Given the viewer's own `view()` and id; anything it can't tell, it leaves out.
   */
  room?: (view: unknown, you: string) => GuideContext | undefined;
}

export interface GuideFooter {
  title: string;
  paragraphs: string[];
  links?: { label: string; href: string }[];
}

export type GuideLevel = 'basics' | 'details' | 'edge';

export interface GuideSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  /**
   * Basics (everyone should know), details (when it comes up) or edge (host options, leaving,
   * timers). Defaults to details, or edge for a title about timers, leaving or options.
   */
  level?: GuideLevel;
  /** The setting this section depends on: in a room where it's off, it shows "Not in this game". */
  option?: GuideOption;
  /** A long list, folded away under its own summary ("Full wake order (74 steps)"). */
  list?: GuideList;
}

/** A setting a section or tile depends on: `key` for the room, `label` for the reader. */
export interface GuideOption {
  key: string;
  label: string;
}

export interface GuideList {
  title: string;
  items: GuideListItem[];
  /** Folded until opened (the rules page's long lists). */
  folded?: boolean;
}

export interface GuideListItem {
  label: string;
  art?: string;
  /** The viewer's own line (highlighted). */
  you?: boolean;
}

export interface GuideRole {
  name: string;
  summary: string;
  icon?: string;
}

export interface GuideStep {
  title: string;
  text: string;
  /** An emoji (or two) when there's no art. */
  icon?: string;
  /** An image URL (back-room art from private storage). */
  art?: string;
}

/** Which side a tile is on, shown as its top edge. */
export type GuideTone = 'good' | 'evil' | 'own' | 'alien' | 'neutral';

export interface GuideTile {
  id: string;
  name: string;
  text: string;
  /** Its filter chip ("Village", "Events", "Edition 2"). */
  group?: string;
  tone?: GuideTone;
  icon?: string;
  /** The tile picture (a portrait); `card` is the full card shown in the sheet. */
  art?: string;
  card?: string;
  /** Where the face is on `art` (fractions of its width and height), for the square crop. */
  focus?: [number, number];
  /** One line under the name in the sheet: team, set, whether it wakes. */
  meta?: string;
  /** The win line ("🏆 …"). */
  win?: string;
  /** A corner badge on the tile (a rank, "×2"). */
  badge?: string;
  /** Extra detail for the sheet (a deck list, question ideas). */
  more?: { title: string; items: string[] };
  /** Named abilities for the sheet, each with what it does ("Mighty powers"). */
  highlights?: { title: string; items: GuideHighlight[] };
  /** The catalog group with this tile's cards, linked from the sheet. */
  catalog?: string;
  /** The setting it needs, when it isn't always in the box. */
  option?: GuideOption;
}

export interface GuideTiles {
  /** The tab's name: "Roles", "Cards", "Heroes"… */
  label: string;
  /** The Learn tab's tile under the stepper: "59 roles · 8 Marks · 12 artifacts". */
  blurb?: string;
  intro?: string;
  /** Square portraits (default), wide landscapes or tall cards. */
  shape?: 'square' | 'wide' | 'card';
  items: GuideTile[];
}

export interface GuideHighlight {
  name: string;
  text: string;
  art?: string;
}

/** Cards in groups (one per hero, faction or set), shown on their own tab. */
export interface GuideCatalog {
  /** The tab's name ("Cards"). */
  label: string;
  /** The Learn tab's line ("12 decks · 147 kinds of card"). */
  blurb?: string;
  intro?: string;
  groups: GuideCatalogGroup[];
}

export interface GuideCatalogGroup {
  /** Matches `GuideContext.inGame` (and the tile it belongs to), for "In this game". */
  id: string;
  name: string;
  /** Its filter chip ("Core heroes"). */
  group?: string;
  /** One line under the name ("Core heroes · 28 cards"). */
  meta?: string;
  art?: string;
  focus?: [number, number];
  icon?: string;
  items: GuideCard[];
}

export interface GuideCard {
  id: string;
  name: string;
  /** What it does, in plain words. */
  text: string;
  /** Copies in the deck. */
  count?: number;
  /** A short symbol line ("⚔2 ⚡1"). */
  symbols?: string;
  /** A small picture for the list; `card` is the full card for the sheet. */
  art?: string;
  card?: string;
  /** A marked card ("✦ Mighty power"), with what it means for the sheet. */
  mark?: { label: string; text?: string };
}

export interface GuideTable {
  title: string;
  head: string[];
  rows: string[][];
  note?: string;
}

/** What a room (or a picked preset) tells the guide. */
export interface GuideContext {
  /** "In your room: …" (or under the preset picker on the rules page). */
  summary?: string;
  /** The option keys that are on; sections and tiles needing another one are "Not in this game". */
  options?: string[];
  /** The tiles in this game, with how many copies (1 when it doesn't matter). */
  inGame?: Record<string, number>;
  /** The viewer's own role or seat. */
  you?: GuideYou;
  /** "👉 you" lines under steps, by step index. */
  stepNotes?: Record<number, string>;
  /** A section's list for this game instead of the full one (the wake order), by section title. */
  lists?: Record<string, GuideList>;
}

export interface GuideYou {
  name: string;
  text?: string;
  art?: string;
  icon?: string;
  /** What's happening now, for you ("🌙 Night · step 3 of 7 · you're next"). */
  now?: string;
  /** The tile to open from the card. */
  tile?: string;
}

export interface GuidePreset {
  id: string;
  label: string;
  context: GuideContext;
}

/** A section's level: its own, or edge for the shell's usual leftovers, else details. */
export function levelOf(s: GuideSection): GuideLevel {
  if (s.level) return s.level;
  return /timer|coming and going|leav|drops? out|host options|^options|house rule|legacy|table rulings/i.test(
    s.title,
  )
    ? 'edge'
    : 'details';
}

/** The stepper's steps: the guide's own, or its quick start as plain steps. */
export function stepsOf(guide: GameGuide): GuideStep[] {
  if (guide.steps?.length) return guide.steps;
  return (guide.quickStart ?? []).map((line) => {
    const sentence = /^(.{8,60}?)[.:;!?](\s|$)/.exec(line)?.[1];
    return { title: sentence ?? line, text: sentence ? line : '' };
  });
}

/** Whether something tied to `option` is in a game with this context (no context: everything). */
export function isOn(option: GuideOption | undefined, ctx: GuideContext | undefined): boolean {
  return !option || !ctx?.options || ctx.options.includes(option.key);
}

/** What `shapeGuide` adds to a guide written as plain text. */
export interface GuideShape extends Partial<Omit<GameGuide, 'steps'>> {
  /** Each section's level by title (the rest default as `levelOf` says). */
  levels?: Record<string, GuideLevel>;
  /** Sections that depend on a setting, by title. */
  options?: Record<string, GuideOption>;
  /** The stepper: a title and an emoji per quick-start line, in order. */
  steps?: [title: string, icon: string][];
  /** An emoji per role, in order (Who's who). */
  roleIcons?: string[];
}

/** A plain-text guide with levels, options, a stepper built from its quick start, and extras. */
export function shapeGuide(guide: GameGuide, shape: GuideShape): GameGuide {
  const { levels = {}, options = {}, steps, roleIcons, ...rest } = shape;
  return {
    ...guide,
    ...rest,
    sections: guide.sections.map((s) => ({
      ...s,
      ...(levels[s.title] && { level: levels[s.title] }),
      ...(options[s.title] && { option: options[s.title] }),
    })),
    ...(guide.roles &&
      roleIcons && {
        roles: guide.roles.map((r, i) => (roleIcons[i] ? { ...r, icon: roleIcons[i] } : r)),
      }),
    ...(steps && {
      steps: steps.map(([title, icon], i) => ({ title, icon, text: guide.quickStart?.[i] ?? '' })),
    }),
  };
}
