/**
 * Beginner-friendly rules for a game, rendered by the web app's "How to play" page and in-game help.
 * Every game ships one, so all guides share the same structure.
 */
export interface GameGuide {
  /** One sentence pitch shown on game cards. */
  tagline: string;
  players: string;
  duration: string;
  /** What you are trying to do, in one or two sentences. */
  goal: string;
  /** Short numbered steps to get a game going. */
  setup: string[];
  /** The rules, in reading order. */
  sections: GuideSection[];
  roles?: { name: string; summary: string }[];
  tips: string[];
  glossary?: { term: string; meaning: string }[];
}

export interface GuideSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}
