import type { ContentProvider } from '@vt/game-sdk';
import { z } from 'zod';
import { type CardId, isCard } from './cards.ts';
import { type Check, checkSchema } from './checks.ts';

// The private content: the task cards and the voyages (mission lists), imported as content packs
// and never in the repo. Code knows only the kinds of conditions and mission rules; which tasks
// exist, their wording and difficulty, and what each mission asks, all come from the packs.
// Tests use small made-up packs.

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.union([z.string().trim().min(1).max(40), z.number().int()]).transform(String);
const cardId = z.string().refine(isCard, 'not a card');

/** The task cards: a condition, a difficulty per table size and the card's wording. */
export const tasksPack = z
  .array(
    z.object({
      id,
      check: checkSchema,
      difficulty: z.object({
        3: z.number().int().min(1).max(9),
        4: z.number().int().min(1).max(9),
        5: z.number().int().min(1).max(9),
      }),
      text: text(200),
      /** Re-deal the cards when one hand holds every card of any of these sets. */
      reDeal: z.array(z.array(cardId).min(1).max(8)).max(6).optional(),
    }),
  )
  .min(1)
  .max(400);
export type TasksPack = z.output<typeof tasksPack>;

export const COMMS = ['normal', 'currents', 'rapture', 'terrain', 'none'] as const;
export type Comms = (typeof COMMS)[number];
/** What an attempt's signals are like once unfamiliar terrain is settled. */
export type AttemptComms = Exclude<Comms, 'terrain'>;

export const SELECTIONS = [
  'normal',
  'free',
  'all-to-one',
  'captain-offers',
  'crew-wanted',
  'captain-skips',
  'hardest-first',
] as const;
export type Selection = (typeof SELECTIONS)[number];

/** A condition of the mission itself, or a fixed task, with its wording. */
const worded = z.object({ check: checkSchema, text: text(200) });

const missionSchema = z.object({
  n: z.number().int().min(1).max(99),
  title: text(80).optional(),
  /** The difficulty to draw tasks to; null for a mission without drawn tasks. */
  difficulty: z.number().int().min(1).max(40).nullable(),
  comms: z.enum(COMMS).default('normal'),
  /** Signals open only before this trick (1-based) and later. */
  commsFrom: z.number().int().min(2).max(13).optional(),
  selection: z.enum(SELECTIONS).default('normal'),
  /** Crew members wanted (`crew-wanted`): 1 or 2. */
  wanted: z.number().int().min(1).max(2).optional(),
  /** A real-time mission, and what it plays as without the timer. */
  timer: z
    .object({
      seconds: z.number().int().min(30).max(1800),
      untimed: z
        .object({
          comms: z.enum(COMMS).optional(),
          difficulty: z.number().int().min(1).max(40).optional(),
        })
        .default({}),
    })
    .optional(),
  /** Conditions the whole crew must meet (missions without task cards). */
  conditions: z.array(worded).max(4).optional(),
  /** Tasks every attempt uses instead of drawn ones. */
  fixedTasks: z.array(worded).max(8).optional(),
  /** The rule box, story and what's new: publisher text, private. */
  rule: text(600).optional(),
  story: text(3000).optional(),
  fresh: text(300).optional(),
});
export type MissionDef = z.output<typeof missionSchema>;

/** One campaign: its missions in order and the endless epilogue. */
export const voyagePack = z.object({
  /** A stable key the campaign is saved under (a re-import keeps it). */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/),
  name: text(60).optional(),
  missions: z.array(missionSchema).min(1).max(99),
  epilogue: z
    .object({
      difficulty: z.number().int().min(1).max(40),
      title: text(80).optional(),
      rule: text(600).optional(),
      story: text(3000).optional(),
    })
    .optional(),
});
export type VoyagePack = z.output<typeof voyagePack>;

export const PACK_KINDS = { tasks: tasksPack, voyage: voyagePack } as const;

/** A task card as the game keeps it in state. */
export interface TaskCard {
  /** `<pack id>:<task id>`. */
  key: string;
  check: Check;
  difficulty: Record<3 | 4 | 5, number>;
  text: string;
  reDeal: CardId[][];
}

export interface Voyage extends VoyagePack {
  packId: string;
}

type Packs = Pick<ContentProvider, 'contentPacks'>;

function parsed<T>(content: Packs, kind: string, schema: z.ZodType<T>) {
  return (content.contentPacks?.(kind) ?? []).flatMap((pack) => {
    const r = schema.safeParse(pack.data);
    return r.success ? [{ id: pack.id, name: pack.name, data: r.data }] : [];
  });
}

/** Every task card from every enabled tasks pack. */
export function taskCards(content: Packs): TaskCard[] {
  return parsed(content, 'tasks', tasksPack).flatMap((p) =>
    p.data.map((t) => ({
      key: `${p.id}:${t.id}`,
      check: t.check,
      difficulty: t.difficulty,
      text: t.text,
      reDeal: t.reDeal ?? [],
    })),
  );
}

/** The voyages on offer (one per key: the first pack wins). */
export function voyages(content: Packs): Voyage[] {
  const seen = new Set<string>();
  return parsed(content, 'voyage', voyagePack).flatMap((p) => {
    if (seen.has(p.data.key)) return [];
    seen.add(p.data.key);
    return [{ ...p.data, packId: p.id, name: p.data.name ?? p.name }];
  });
}
