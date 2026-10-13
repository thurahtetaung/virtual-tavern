import type { CardDef, CardId, Effect, FormKind, HeroId, SetId, Step, Sym } from './types.ts';

export interface HeroDef {
  id: HeroId;
  set: SetId;
  /** Seat and placeholder-card colour (a Tailwind hue name). */
  colour: string;
  /** Neutral fallback name, shown without the manifest. */
  label: string;
  /** One-line play style, shown without the manifest. */
  style: string;
}

export const HEROES: Record<HeroId, HeroDef> = {
  brute: {
    id: 'brute',
    set: 'core',
    colour: 'teal',
    label: 'Brute',
    style: 'Huge hits, smashes shields, heals while attacking.',
  },
  mage: {
    id: 'mage',
    set: 'core',
    colour: 'yellow',
    label: 'Mage',
    style: 'Burns everyone, steals shields, swaps hit points.',
  },
  knight: {
    id: 'knight',
    set: 'core',
    colour: 'red',
    label: 'Knight',
    style: 'Steady hits that heal, takes back a used card.',
  },
  thief: {
    id: 'thief',
    set: 'core',
    colour: 'purple',
    label: 'Thief',
    style: 'Fast chains, hides from everyone, plays your cards.',
  },
  ranger: {
    id: 'ranger',
    set: 'x1',
    colour: 'pink',
    label: 'Ranger',
    style: 'Boosted attacks, borrows cards, passes hit points round.',
  },
  druid: {
    id: 'druid',
    set: 'x1',
    colour: 'lime',
    label: 'Druid',
    style: 'Turns into a bear or a wolf for extra heals or hits.',
  },
};

export const SETS: Record<SetId, { label: string }> = {
  core: { label: 'Core heroes' },
  x1: { label: 'Expansion heroes' },
};

/** Heroes that can be picked in this release. */
export const ENABLED_HEROES: readonly HeroId[] = [
  'brute',
  'mage',
  'knight',
  'thief',
  'ranger',
  'druid',
];

interface Spec {
  count: number;
  /** Printed order, e.g. `atk1 play1`, `power play1`, `draw2 paw`. Shields are `shd<n>`. */
  steps: string;
  effect?: Effect;
  form?: FormKind;
  /** An attack card without printed swords (the druid's Form-bonus attack card is one anyway). */
  attack?: boolean;
}

const s = (count: number, steps: string, extra: Omit<Spec, 'count' | 'steps'> = {}): Spec => ({
  count,
  steps,
  ...extra,
});

const DECKS: Record<HeroId, Spec[]> = {
  brute: [
    s(1, 'shd1 draw1'),
    s(2, 'power play1', { effect: 'allDiscardDraw3' }),
    s(5, 'atk3'),
    s(2, 'atk2'),
    s(2, 'heal1 draw1'),
    s(2, 'atk1 play1'),
    s(2, 'power draw1', { effect: 'destroyOneShield' }),
    s(2, 'draw2'),
    s(1, 'shd3'),
    s(2, 'atk4'),
    s(1, 'shd3'),
    s(1, 'draw2 heal1'),
    s(1, 'shd2'),
    s(2, 'play2'),
    s(2, 'power', { effect: 'healPerOppThenHitEach' }),
  ],
  mage: [
    s(3, 'atk2'),
    s(2, 'power', { effect: 'stealShield' }),
    s(2, 'heal1 play1'),
    s(2, 'power', { effect: 'damageAll3' }),
    s(3, 'draw3'),
    s(4, 'atk3'),
    s(3, 'atk1 play1'),
    s(1, 'shd3'),
    s(2, 'shd1 draw1'),
    s(3, 'play2'),
    s(1, 'shd2'),
    s(2, 'power', { effect: 'swapHpWithOpp' }),
  ],
  knight: [
    s(1, 'power play1', { effect: 'destroyAllShields' }),
    s(1, 'draw2 heal1'),
    s(2, 'power heal2', { effect: 'takeFromDiscard' }),
    s(2, 'shd3'),
    s(3, 'atk3 heal1'),
    s(3, 'atk2 heal1'),
    s(2, 'play2'),
    s(1, 'shd2'),
    s(4, 'atk2'),
    s(3, 'atk1 play1'),
    s(2, 'atk3'),
    s(2, 'draw2'),
    s(2, 'shd1 draw1'),
  ],
  thief: [
    s(3, 'atk3'),
    s(2, 'power', { effect: 'disguise' }),
    s(2, 'play2'),
    s(1, 'draw2 heal1'),
    s(1, 'shd3'),
    s(5, 'atk1 play1'),
    s(2, 'power', { effect: 'playOpponentTop' }),
    s(2, 'power play1', { effect: 'destroyOneShield' }),
    s(2, 'heal1 play1'),
    s(2, 'shd2'),
    s(4, 'atk2'),
    s(2, 'shd1 draw1'),
  ],
  ranger: [
    s(2, 'draw2'),
    s(2, 'power play1', { effect: 'attackBonus' }),
    s(3, 'atk3'),
    s(2, 'play2'),
    s(1, 'shd3'),
    s(2, 'shd2'),
    s(2, 'shd1 heal1'),
    s(2, 'atk2 heal1'),
    s(2, 'power', { effect: 'drawFromEachOpp' }),
    s(2, 'power', { effect: 'rotateHpRight' }),
    s(3, 'atk1 play1'),
    s(1, 'atk2 play1'),
    s(3, 'atk2'),
    s(1, 'heal1 draw1'),
  ],
  druid: [
    s(3, 'atk3'),
    s(2, 'shd1 atk1'),
    s(2, 'heal1 draw1 atk1'),
    s(2, 'atk2 paw'),
    s(1, 'shd3'),
    s(2, 'heal2 power', { effect: 'formBear', form: 'bear' }),
    s(2, 'draw2 paw'),
    s(2, 'power play1', { effect: 'howlThenHitEach' }),
    s(2, 'play2'),
    s(2, 'shd2 paw'),
    s(3, 'atk1 play1'),
    s(2, 'draw2 power', { effect: 'freeFormPlay' }),
    s(3, 'atk2 power', { effect: 'formWolf', form: 'wolf' }),
  ],
};

function parse(hero: HeroId, index: number, spec: Spec): CardDef {
  const steps: Step[] = [];
  let shield = 0;
  for (const token of spec.steps.split(' ')) {
    if (token === 'power') steps.push({ k: 'power' });
    else if (token === 'paw') steps.push({ k: 'paw' });
    else {
      const m = /^(atk|heal|play|draw|shd)(\d)$/.exec(token);
      if (!m) throw new Error(`bad step ${token}`);
      if (m[1] === 'shd') shield = Number(m[2]);
      else steps.push({ k: m[1] as Sym, n: Number(m[2]) });
    }
  }
  return {
    id: `${hero}.${String(index + 1).padStart(2, '0')}`,
    hero,
    count: spec.count,
    steps,
    shield,
    attack: spec.attack ?? steps.some((st) => st.k === 'atk'),
    effect: spec.effect ?? null,
    form: spec.form ?? null,
  };
}

export const CARDS: Record<CardId, CardDef> = Object.fromEntries(
  (Object.keys(DECKS) as HeroId[]).flatMap((hero) =>
    DECKS[hero].map((spec, i) => {
      const def = parse(hero, i, spec);
      return [def.id, def] as const;
    }),
  ),
);

export const cardDef = (id: CardId): CardDef => {
  const def = CARDS[id];
  if (!def) throw new Error(`unknown card ${id}`);
  return def;
};

/** A hero's distinct cards, in deck order. */
export const cardsOf = (hero: HeroId): CardDef[] =>
  Object.values(CARDS).filter((c) => c.hero === hero);

/** A hero's 28 cards, one id per copy. */
export const deckList = (hero: HeroId): CardId[] =>
  cardsOf(hero).flatMap((c) => Array<CardId>(c.count).fill(c.id));

/** How many of a symbol a card shows (attack, heal, play, draw, or `shd` for shield points). */
export function symbolCount(def: CardDef, sym: Sym | 'shd'): number {
  if (sym === 'shd') return def.shield;
  return def.steps.reduce((n, st) => (st.k === sym ? n + st.n : n), 0);
}

export const isPower = (def: CardDef) => def.effect !== null;
export const hasPaw = (def: CardDef) => def.steps.some((st) => st.k === 'paw');
