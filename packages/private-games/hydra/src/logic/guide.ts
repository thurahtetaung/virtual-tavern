import type { GameGuide, GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES, POWER_NAMES, fillNames } from './names.ts';
import type { Power } from './types.ts';
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
    '{RedPolicy} {policies} give the {president} powers: investigate, peek, call a special election, execute.',
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

/**
 * The guide with the table's names and power names, plus an optional footer (the original
 * game's credit and any other).
 */
export function nameGuide(
  names: Names,
  footer?: GuideFooter,
  powers: Partial<Record<Power, string>> = {},
): GameGuide {
  const f = (t: string) =>
    fillNames(
      t.replace(/\{power:(\w+)\}/g, (_m, p: Power) => powers[p] ?? POWER_NAMES[p]),
      names,
    );
  const fillList = (list: readonly string[]) => list.map(f);
  return {
    tagline: f(RAW.tagline),
    players: RAW.players,
    duration: RAW.duration,
    goal: f(RAW.goal),
    quickStart: fillList(RAW.quickStart!),
    setup: fillList(RAW.setup),
    roles: RAW.roles!.map((r) => ({ name: f(r.name), summary: f(r.summary) })),
    sections: RAW.sections.map((s) => ({
      title: f(s.title),
      ...(s.paragraphs && { paragraphs: fillList(s.paragraphs) }),
      ...(s.bullets && { bullets: fillList(s.bullets) }),
    })),
    tips: fillList(RAW.tips),
    glossary: RAW.glossary!.map((g) => ({ term: f(g.term), meaning: f(g.meaning) })),
    ...(footer && { footer }),
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
export { placeholderWord } from './labels.ts';
