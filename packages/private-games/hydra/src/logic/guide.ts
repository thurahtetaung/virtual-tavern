import type { GameGuide, GuideContext, GuideFooter, GuideTile } from '@vt/game-sdk';
import type { Manifest } from './manifest.ts';
import { type Names, PLACEHOLDER_NAMES, POWER_NAMES, POWER_TEXT, fillNames } from './names.ts';
import type { HydraView, Power, Role } from './types.ts';
import { RED_COUNT, type Track, trackFor } from './tables.ts';

/**
 * Hydra's rules, written with name tokens (`{blue}`, `{reds}`, `{leader}`…). The guide every
 * browser gets uses the neutral placeholders; unlocked players see it named from the private
 * manifest (`nameGuide`), with the original game's credit as its footer.
 */

/** Power names are filled in last (`{power:peek}`), from the edition's manifest or the defaults. */
const P = (p: Power) => `{power:${p}}`;

const track = (t: Track) =>
  t
    .slice(0, 5)
    .map((p, i) => `${i + 1}: ${p ? P(p) : '—'}`)
    .join(' · ');

const teams = (n: number) => {
  const reds = RED_COUNT[n]!;
  return `${n} players: ${n - reds} {blues}, ${reds - 1} {red}${reds - 1 > 1 ? 's' : ''} and {leader}`;
};

const RAW: GameGuide = {
  tagline: 'Elect a government, pass laws in secret, and find {leader} before it’s too late.',
  players: '5 to 10 players',
  duration: '20–40 minutes',
  goal: 'The {blues} win by passing 5 {bluePolicy} {policies} or by executing {leader}. The {reds} win with 6 {redPolicy} {policies}, or by getting {leader} elected {chancellor} once 3 {redPolicy} {policies} are on the board.',
  quickStart: [
    'Read your secret role. {reds} know each other; the {blues} know nothing.',
    'Each round the {candidate} nominates a {chancellor}, and everyone votes {yes} or {no}.',
    'Elected? The {president} draws 3 {policies} and discards 1; the {chancellor} discards 1 and enacts the other.',
    'Then both say what they saw. Anyone can lie, so question them out loud.',
    `{RedPolicy} {policies} give the {president} powers: ${P('investigate')}, ${P('peek')}, ${P('special')}, ${P('execute')}.`,
    'Three failed governments in a row and the people enact the top {policy} by themselves.',
  ],
  setup: [
    'Sit down in the lobby (5 to 10 players). The host can turn on the community rebalance, quick mode and timers.',
    'The host starts. Everyone reads their role card (slide it up, or hold it, so neighbours can’t see) and taps Ready.',
    'The first {candidate} is drawn at random; after that the role passes clockwise.',
  ],
  roles: [
    {
      name: '{blue}',
      summary:
        'You know nothing about anyone. Win with 5 {bluePolicy} {policies}, or by executing {leader}. Watch the votes and the claims.',
    },
    {
      name: '{red}',
      summary:
        'You know your fellow {reds} and who {leader} is. Win with 6 {redPolicy} {policies}, or by getting {leader} elected {chancellor} in the danger zone. Blend in.',
    },
    {
      name: '{Leader}',
      summary:
        'You are on the {red} team. At 5–6 players you know the other {red}; from 7 on you know nobody. Look trustworthy: if you’re elected {chancellor} once 3 {redPolicy} {policies} are down, you win.',
    },
  ],
  sections: [
    {
      title: 'Teams',
      bullets: [5, 6, 7, 8, 9, 10].map(teams),
    },
    {
      title: '1. Nomination',
      paragraphs: [
        'The {candidate} nominates any eligible player as {chancellor}. The last elected {president} and {chancellor} are term-limited: they can’t be nominated {chancellor} this time. With only five players left alive, only the last {chancellor} is term-limited.',
        'Greyed seats show why they can’t be picked. The “Next {president}” chip always shows who comes next.',
      ],
    },
    {
      title: '2. The vote',
      paragraphs: [
        'Everyone alive votes {yes} or {no}, including the candidates. You can change your vote until the last one is in; then they all flip at once.',
        'More {yes} than {no} elects the government; a tie fails. A failed vote moves the election tracker one step and the candidacy passes on.',
        'From 3 {redPolicy} {policies} on, electing {leader} as {chancellor} wins the game for the {reds}. Any other {chancellor} is then confirmed “Not {leader}”, which everyone sees.',
      ],
    },
    {
      title: '3. The legislative session',
      paragraphs: [
        'The {president} draws the top 3 {policies} and discards one face down. The other two are shuffled and passed to the {chancellor}, who discards one and enacts the other. No talking until it’s done.',
        'The two cards are shuffled on the way, so the order the {president} leaves them in can’t send a signal. Everyone is told.',
      ],
    },
    {
      title: '4. Claims',
      paragraphs: [
        'After every session the {president} claims the 3 cards they drew and which colour they discarded, and the {chancellor} the 2 they got (their discard follows from the {policy} that came out, so the log works it out). After an investigation or a peek the {president} claims what they saw. Claims are final, and anyone may lie, about the draw or the discard.',
        'Play waits for both claims. A claim timer counts down; once it runs out, the host may skip a missing claim (it’s logged).',
        'The claim log marks claims that can’t all be true from what everyone saw (for example, a {president} who claims three {redPolicy} cards when a {bluePolicy} {policy} came out, or who says they passed two {redPolicy} cards to a {chancellor} who says they got a {bluePolicy} one). It never uses secret information.',
      ],
    },
    {
      title: '5. Powers',
      paragraphs: [
        'A {redPolicy} {policy} that lands on a power gives it to the {president}, who must use it before the next round. A {bluePolicy} {policy} never gives a power.',
      ],
      bullets: [
        `${P('investigate')}: see one player’s {party} card ({blue} or {red}; {leader} shows {red}). Nobody can be investigated twice.`,
        `${P('special')}: choose the next {candidate}. Afterwards the order goes on from the {president}’s left.`,
        `${P('peek')}: look at the top three cards, then put them back in order.`,
        `${P('execute')}: execute a player. If it’s {leader}, the {blues} win. Otherwise nobody learns their role, and they can’t speak or vote any more.`,
      ],
    },
    {
      title: 'Quick reference: the {red} board',
      bullets: [
        `5–6 players · ${track(trackFor(5))} · 6: the {reds} win`,
        `7–8 players · ${track(trackFor(7))} · 6: the {reds} win`,
        `9–10 players · ${track(trackFor(9))} · 6: the {reds} win`,
        '{Veto}: from the 5th {redPolicy} {policy} on, the {chancellor} may ask for a {veto} before choosing. If the {president} agrees, both cards are discarded and the election tracker moves on.',
      ],
    },
    {
      title: 'The election tracker and chaos',
      paragraphs: [
        'Each failed vote or {veto} moves the tracker. On the third, the people enact the top {policy}: its power is ignored, the tracker resets and every term limit is forgotten. Enacting any {policy} also resets the tracker.',
        'When fewer than three cards are left after a session, the discard pile is shuffled back into the deck.',
      ],
    },
    {
      title: 'Options',
      bullets: [
        'Community rebalance (off by default): at 6 players a {redPolicy} {policy} starts on the board; at 7 and 9 the deck has one {redPolicy} {policy} fewer.',
        'Quick mode skips the dramatic pause before the table learns whether the {chancellor} is {leader}.',
        'Timers are off by default. With strict timers a missing vote isn’t counted, and other turns are played at random. Claims are never made for anyone.',
        'An absent player’s turn can be played by the host (“Act for”), and everyone is told.',
      ],
    },
  ],
  tips: [
    'Votes are public once they flip. Who voted {yes} for a government that passed a {redPolicy} {policy} is worth remembering.',
    'The deck chip shows how many {bluePolicy} and {redPolicy} cards are still unplayed: use it to check whether a claim is likely.',
    'Your ⭐ / ✕ marks and notes on players are private to your device.',
    'Once 3 {redPolicy} {policies} are down, every {chancellor} election is a gamble. Get people confirmed “Not {leader}” early.',
  ],
  glossary: [
    {
      term: 'Term-limited',
      meaning: 'The last elected {president} and {chancellor} can’t be the next {chancellor}.',
    },
    {
      term: 'Danger zone',
      meaning:
        '3 or more {redPolicy} {policies}: electing {leader} as {chancellor} wins it for the {reds}.',
    },
    {
      term: 'Chaos',
      meaning: 'Three failed governments in a row: the top {policy} is enacted by itself.',
    },
  ],
};

/** An edition's art for the guide, as URLs. */
export interface GuideArt {
  roles?: Partial<Record<Role | 'back', string>>;
  ballot?: string;
  policy?: string;
  powers?: Partial<Record<Power, string>>;
  /** The edition's own power texts (with name tokens or plain). */
  powerText?: Partial<Record<Power, string>>;
}

const POWERS: Power[] = ['investigate', 'special', 'peek', 'execute'];
const ROLES: Role[] = ['blue', 'red', 'leader'];
const LEVELS: Record<string, 'basics' | 'details' | 'edge'> = {
  Teams: 'basics',
  '1. Nomination': 'basics',
  '2. The vote': 'basics',
  '3. The legislative session': 'basics',
  '4. Claims': 'basics',
  '5. Powers': 'details',
  'The election tracker and chaos': 'details',
  Options: 'edge',
};

/**
 * The guide with the table's names and power names, plus an optional footer (the original
 * game's credit and any other) and the edition's art.
 */
export function nameGuide(
  names: Names,
  footer?: GuideFooter,
  powers: Partial<Record<Power, string>> = {},
  art: GuideArt = {},
): GameGuide {
  const f = (t: string) =>
    fillNames(
      t.replace(/\{power:(\w+)\}/g, (_m, p: Power) => powers[p] ?? POWER_NAMES[p]),
      names,
    );
  const fillList = (list: readonly string[]) => list.map(f);
  const quick = fillList(RAW.quickStart!);
  const tiles: GuideTile[] = [
    ...ROLES.map((r, i): GuideTile => {
      const a = art.roles?.[r];
      return {
        id: r,
        name: f(RAW.roles![i]!.name),
        text: f(RAW.roles![i]!.summary),
        group: 'Roles',
        tone: r === 'blue' ? 'good' : 'evil',
        icon: r === 'leader' ? '👑' : r === 'blue' ? '🕊️' : '🐍',
        ...(a && { art: a }),
      };
    }),
    ...POWERS.map((p): GuideTile => {
      const a = art.powers?.[p];
      return {
        id: `power-${p}`,
        name: f(P(p)),
        text: f(art.powerText?.[p] ?? POWER_TEXT[p]),
        group: 'Powers',
        icon: '⚡',
        meta: f('A {redPolicy} power for the {president}'),
        ...(a && { art: a }),
      };
    }),
  ];
  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as HydraView;
    if (!v?.settings) return undefined;
    const n = v.seats.filter((x) => x.playing).length;
    const size = n <= 6 ? 5 : n <= 8 ? 7 : 9;
    const used = new Set(trackFor(Math.max(5, Math.min(10, n))).filter(Boolean) as Power[]);
    const ctx: GuideContext = {
      summary: [
        `${n} ${n === 1 ? 'player' : 'players'}`,
        ...(n >= 5 ? [f(`the ${size}–${size + 1} player {red} board`)] : []),
        ...(v.settings.rebalance ? ['community rebalance'] : []),
      ].join(' · '),
      inGame: Object.fromEntries([
        ...ROLES.map((r): [string, number] => [
          r,
          r === 'red'
            ? Math.max(1, (RED_COUNT[n] ?? 2) - 1)
            : r === 'blue'
              ? Math.max(1, n - (RED_COUNT[n] ?? 2))
              : 1,
        ]),
        ...[...used].map((p): [string, number] => [`power-${p}`, 1]),
      ]),
    };
    if (v.role && v.me?.id === you) {
      const t = tiles.find((x) => x.id === v.role!.role)!;
      ctx.you = { name: t.name, text: t.text, tile: t.id, ...(t.art && { art: t.art }) };
      ctx.secret = true;
    }
    return ctx;
  };
  const step = (title: string, i: number, icon: string, a?: string) => ({
    title: f(title),
    text: quick[i]!,
    icon,
    ...(a && { art: a }),
  });
  return {
    tagline: f(RAW.tagline),
    players: RAW.players,
    duration: RAW.duration,
    goal: f(RAW.goal),
    quickStart: fillList(RAW.quickStart!),
    setup: fillList(RAW.setup),
    roles: RAW.roles!.map((r) => ({ name: f(r.name), summary: f(r.summary) })),
    sections: RAW.sections
      .filter((s) => !s.title.startsWith('Quick reference'))
      .map((s) => ({
        title: f(s.title),
        level: LEVELS[s.title] ?? 'details',
        ...(s.paragraphs && { paragraphs: fillList(s.paragraphs) }),
        ...(s.bullets && {
          bullets: fillList(
            s.title === '5. Powers'
              ? [
                  ...s.bullets,
                  RAW.sections.find((x) => x.title.startsWith('Quick reference'))!.bullets!.at(-1)!,
                ]
              : s.bullets,
          ),
        }),
      })),
    tips: fillList(RAW.tips),
    glossary: RAW.glossary!.map((g) => ({ term: f(g.term), meaning: f(g.meaning) })),
    steps: [
      step('Read your secret role', 0, '🎭', art.roles?.back),
      step('Nominate and vote', 1, '🗳️', art.ballot),
      step('Pass a {policy} in secret', 2, '📜', art.policy),
      step('Claim what you saw', 3, '🗣️'),
      step('Powers', 4, '⚡', art.powers?.execute),
      step('Chaos after 3 failures', 5, '🌀'),
    ],
    tiles: {
      label: 'Roles & powers',
      blurb: '3 roles · 4 powers',
      intro: f('The three roles, and the powers a {redPolicy} {policy} can give the {president}.'),
      items: tiles,
    },
    reference: [
      {
        title: f('The {red} board'),
        head: ['Players', '1', '2', '3', '4', '5'],
        rows: ([5, 7, 9] as const).map((n) => [
          `${n}–${n + 1}`,
          ...trackFor(n)
            .slice(0, 5)
            .map((p) => (p ? f(P(p)) : '—')),
        ]),
        note: f(
          'The 6th {redPolicy} {policy} wins it for the {reds}; 5 {bluePolicy} ones win it for the {blues}.',
        ),
      },
      {
        title: 'Teams',
        head: ['Players', f('{blues}'), f('{reds}'), f('{Leader}')],
        rows: [5, 6, 7, 8, 9, 10].map((n) => [
          String(n),
          String(n - RED_COUNT[n]!),
          String(RED_COUNT[n]! - 1),
          '1',
        ]),
      },
    ],
    room,
    ...(footer && { footer }),
  };
}

/** The guide's art for an edition (`gameId`'s folder), from its manifest. */
export function guideArtOf(man: Manifest | null, gameId: string): GuideArt {
  const url = (p: string | undefined) =>
    p && p.trim() ? `/api/backroom/assets/${gameId}/${p.trim().replace(/^\/+/, '')}` : undefined;
  const a = man?.art;
  const pick = <K extends string>(entries: [K, string | undefined][]) =>
    Object.fromEntries(entries.filter((e): e is [K, string] => !!e[1])) as Partial<
      Record<K, string>
    >;
  return {
    roles: pick<Role | 'back'>([
      ['blue', url(a?.roles?.blue?.[0])],
      ['red', url(a?.roles?.red?.[0])],
      ['leader', url(a?.roles?.leader?.[0])],
      ['back', url(a?.roles?.back)],
    ]),
    ...(url(a?.ballot?.yes) && { ballot: url(a?.ballot?.yes)! }),
    ...(url(a?.policy?.back) && { policy: url(a?.policy?.back)! }),
    powers: pick<Power>(POWERS.map((p) => [p, url(a?.powers?.[p])])),
    powerText: pick<Power>(POWERS.map((p) => [p, man?.powers?.[p]?.text?.trim() || undefined])),
  };
}

/**
 * The plain guide, which only stands in until the manifest has loaded. Its tagline (on the back
 * room's game card) is written without a placeholder role name.
 */
export const guide: GameGuide = {
  ...nameGuide(PLACEHOLDER_NAMES),
  tagline:
    'Elect a government, pass laws in secret, and unmask the hidden leader before it’s too late.',
};

export { creditOf, footerOf, namesOf, powerNamesOf } from './manifest.ts';
export type { Manifest } from './manifest.ts';
export { placeholderWord } from './labels.ts';
