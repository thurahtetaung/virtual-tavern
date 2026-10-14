import type { GameGuide, GuideContext, GuideTile } from '@vt/game-sdk';
import { makeGuide, stepsFor } from '@vt/game-masquerade/guide';
import type { MasqueradeView } from '@vt/game-masquerade/logic';

const base = makeGuide(
  'The host picks the first edition (30 locations), the second (20 locations) or both; the lobby shows each edition’s name.',
);

const quickStart = [
  'The host picks the first edition, the second or both; every location in play is on the Locations board.',
  'Everyone gets a card: the locals see the same location, the spy sees only “You’re the spy”.',
  'Take turns asking each other questions about the location, out loud, starting with the player the app names.',
  'When the clock runs out or everyone is Ready to vote, vote in secret for the spy.',
  'A caught spy gets one guess at the location from the board: right, and the spy steals the round.',
  'Points go to the spy or the locals each round; the most points after the last round wins.',
];

/** A location as the manifest describes it (art as a URL). */
export interface OriginalsLocation {
  id: string;
  name: string;
  edition: string;
  art?: string;
  tip?: string;
  questions?: string[];
}

/**
 * The guide, with a Locations tab when the private manifest names the locations (without it they
 * are only numbers, so there is nothing to browse).
 */
export function makeOriginalsGuide(locations: OriginalsLocation[] = []): GameGuide {
  const tiles: GuideTile[] = locations.map((l) => ({
    id: l.id,
    name: l.name,
    text: l.tip ?? 'A location in this edition.',
    group: l.edition,
    icon: '🗺️',
    ...(l.art && { art: l.art }),
    ...(l.questions?.length && {
      more: { title: 'Question ideas', items: l.questions.slice(0, 4) },
    }),
  }));
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as MasqueradeView;
    if (!Array.isArray(v?.locations)) return undefined;
    return {
      summary: `${v.locations.length} locations · ${v.settings.roundSeconds / 60} minute rounds${v.settings.twoSpies ? ' · two spies at 7+' : ''}`,
      ...(tiles.length && { inGame: Object.fromEntries(v.locations.map((id) => [id, 1])) }),
    };
  };
  return {
    ...base,
    quickStart,
    steps: stepsFor(quickStart).map((s, i) =>
      i === 0 && locations[0]?.art ? { ...s, art: locations[0].art } : s,
    ),
    ...(tiles.length && {
      tiles: {
        label: 'Locations',
        blurb: `${tiles.length} locations with question ideas`,
        intro: 'Every location, with a tip and some questions to ask. Filter by edition.',
        shape: 'wide' as const,
        items: tiles,
      },
    }),
    room,
  };
}

export const guide: GameGuide = makeOriginalsGuide();

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The guide with the manifest's locations: names, art, tips and question ideas. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = obj(manifest);
  const editions = obj(m.editions);
  const list = Object.entries(obj(m.locations)).flatMap(([id, raw]): OriginalsLocation[] => {
    const l = obj(raw);
    const name = str(l.name);
    if (!name) return [];
    const ed = id.slice(0, 2);
    const art = str(l.art);
    const tip = str(l.tip);
    const questions = Array.isArray(l.questions)
      ? l.questions.filter((q): q is string => typeof q === 'string')
      : [];
    return [
      {
        id,
        name,
        edition: str(obj(editions[ed]).name) ?? (ed === 'e1' ? 'Edition 1' : 'Edition 2'),
        ...(art && { art: `/api/backroom/assets/masquerade-originals/${art.replace(/^\/+/, '')}` }),
        ...(tip && { tip }),
        ...(questions.length && { questions }),
      },
    ];
  });
  return makeOriginalsGuide(list.sort((a, b) => a.id.localeCompare(b.id)));
}
