import type { GameGuide, GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES, POWER_NAMES, fillNames } from './names.ts';
import { RED_COUNT, type Track, trackFor } from './tables.ts';

/**
 * Hydra's rules, written with name tokens (`{blue}`, `{reds}`, `{leader}`…). The guide every
 * browser gets uses the neutral placeholders; unlocked players see it named from the private
 * manifest (`nameGuide`), with the original game's credit as its footer.
 */

const track = (t: Track) =>
  t
    .slice(0, 5)
    .map((p, i) => `${i + 1}: ${p ? POWER_NAMES[p] : '—'}`)
    .join(' · ');

const teams = (n: number) => {
  const reds = RED_COUNT[n]!;
  return `${n} players: ${n - reds} {blues}, ${reds - 1} {red}${reds - 1 > 1 ? 's' : ''} and {leader}`;
};

const RAW: GameGuide = {
  tagline: 'Elect a government, pass laws in secret, and find {leader} before it’s too late.',
  players: '5 to 10 players',
  duration: '20–40 minutes',
  goal: 'The {blues} win by passing 5 {blue} policies or by executing {leader}. The {reds} win with 6 {red} policies, or by getting {leader} elected Chancellor once 3 {red} policies are on the board.',
  quickStart: [
    'Read your secret role. {reds} know each other; the {blues} know nothing.',
    'Each round the Presidential Candidate nominates a Chancellor, and everyone votes {yes} or {no}.',
    'Elected? The President draws 3 policies and discards 1; the Chancellor discards 1 and enacts the other.',
    'Then both say what they saw. Anyone can lie, so question them out loud.',
    '{red} policies give the President powers: investigate, peek, call a special election, execute.',
    'Three failed governments in a row and the people enact the top policy by themselves.',
  ],
  setup: [
    'Sit down in the lobby (5 to 10 players). The host can turn on the community rebalance, quick mode and timers.',
    'The host starts. Everyone reads their role card (slide it up, or hold it, so neighbours can’t see) and taps Ready.',
    'The first Presidential Candidate is drawn at random; after that the role passes clockwise.',
  ],
  roles: [
    {
      name: '{blue}',
      summary:
        'You know nothing about anyone. Win with 5 {blue} policies, or by executing {leader}. Watch the votes and the claims.',
    },
    {
      name: '{red}',
      summary:
        'You know your fellow {reds} and who {leader} is. Win with 6 {red} policies, or by getting {leader} elected Chancellor in the danger zone. Blend in.',
    },
    {
      name: '{Leader}',
      summary:
        'You are on the {red} team. At 5–6 players you know the other {red}; from 7 on you know nobody. Look trustworthy: if you’re elected Chancellor once 3 {red} policies are down, you win.',
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
        'The Presidential Candidate nominates any eligible player as Chancellor. The last elected President and Chancellor are term-limited: they can’t be nominated Chancellor this time. With only five players left alive, only the last Chancellor is term-limited.',
        'Greyed seats show why they can’t be picked. The “Next President” chip always shows who comes next.',
      ],
    },
    {
      title: '2. The vote',
      paragraphs: [
        'Everyone alive votes {yes} or {no}, including the candidates. You can change your vote until the last one is in; then they all flip at once.',
        'More {yes} than {no} elects the government; a tie fails. A failed vote moves the election tracker one step and the candidacy passes on.',
        'From 3 {red} policies on, electing {leader} as Chancellor wins the game for the {reds}. Any other Chancellor is then confirmed “Not {leader}”, which everyone sees.',
      ],
    },
    {
      title: '3. The legislative session',
      paragraphs: [
        'The President draws the top 3 policies and discards one face down. The other two are shuffled and passed to the Chancellor, who discards one and enacts the other. No talking until it’s done.',
        'The two cards are shuffled on the way, so the order the President leaves them in can’t send a signal. Everyone is told.',
      ],
    },
    {
      title: '4. Claims',
      paragraphs: [
        'After every session the President claims the 3 cards they drew and which colour they discarded, and the Chancellor the 2 they got (their discard follows from the policy that came out, so the log works it out). After an investigation or a peek the President claims what they saw. Claims are final, and anyone may lie, about the draw or the discard.',
        'Play waits for both claims. A claim timer counts down; once it runs out, the host may skip a missing claim (it’s logged).',
        'The claim log marks claims that can’t all be true from what everyone saw (for example, a President who claims three {red} cards when a {blue} policy came out, or who says they passed two {red} cards to a Chancellor who says they got a {blue} one). It never uses secret information.',
      ],
    },
    {
      title: '5. Powers',
      paragraphs: [
        'A {red} policy that lands on a power gives it to the President, who must use it before the next round. A {blue} policy never gives a power.',
      ],
      bullets: [
        `${POWER_NAMES.investigate}: see one player’s party card ({blue} or {red}; {leader} shows {red}). Nobody can be investigated twice.`,
        `${POWER_NAMES.special}: choose the next Presidential Candidate. Afterwards the order goes on from the President’s left.`,
        `${POWER_NAMES.peek}: look at the top three cards, then put them back in order.`,
        `${POWER_NAMES.execute}: execute a player. If it’s {leader}, the {blues} win. Otherwise nobody learns their role, and they can’t speak or vote any more.`,
      ],
    },
    {
      title: 'Quick reference: the {red} board',
      bullets: [
        `5–6 players · ${track(trackFor(5))} · 6: the {reds} win`,
        `7–8 players · ${track(trackFor(7))} · 6: the {reds} win`,
        `9–10 players · ${track(trackFor(9))} · 6: the {reds} win`,
        'Veto: from the 5th {red} policy on, the Chancellor may ask for a veto before choosing. If the President agrees, both cards are discarded and the election tracker moves on.',
      ],
    },
    {
      title: 'The election tracker and chaos',
      paragraphs: [
        'Each failed vote or veto moves the tracker. On the third, the people enact the top policy: its power is ignored, the tracker resets and every term limit is forgotten. Enacting any policy also resets the tracker.',
        'When fewer than three cards are left after a session, the discard pile is shuffled back into the deck.',
      ],
    },
    {
      title: 'Options',
      bullets: [
        'Community rebalance (off by default): at 6 players a {red} policy starts on the board; at 7 and 9 the deck has one {red} policy fewer.',
        'Quick mode skips the dramatic pause before the table learns whether the Chancellor is {leader}.',
        'Timers are off by default. With strict timers a missing vote isn’t counted, and other turns are played at random. Claims are never made for anyone.',
        'An absent player’s turn can be played by the host (“Act for”), and everyone is told.',
      ],
    },
  ],
  tips: [
    'Votes are public once they flip. Who voted {yes} for a government that passed a {red} policy is worth remembering.',
    'The deck chip shows how many {blue} and {red} cards are still unplayed: use it to check whether a claim is likely.',
    'Your ⭐ / ✕ marks and notes on players are private to your device.',
    'Once 3 {red} policies are down, every Chancellor election is a gamble. Get people confirmed “Not {leader}” early.',
  ],
  glossary: [
    {
      term: 'Term-limited',
      meaning: 'The last elected President and Chancellor can’t be the next Chancellor.',
    },
    {
      term: 'Danger zone',
      meaning: '3 or more {red} policies: electing {leader} as Chancellor wins it for the {reds}.',
    },
    {
      term: 'Chaos',
      meaning: 'Three failed governments in a row: the top policy is enacted by itself.',
    },
  ],
};

const fillList = (list: readonly string[], names: Names) => list.map((t) => fillNames(t, names));

/** The guide with the table's names, plus an optional footer (the original game's credit). */
export function nameGuide(names: Names, footer?: GuideFooter): GameGuide {
  const f = (t: string) => fillNames(t, names);
  return {
    tagline: f(RAW.tagline),
    players: RAW.players,
    duration: RAW.duration,
    goal: f(RAW.goal),
    quickStart: fillList(RAW.quickStart!, names),
    setup: fillList(RAW.setup, names),
    roles: RAW.roles!.map((r) => ({ name: f(r.name), summary: f(r.summary) })),
    sections: RAW.sections.map((s) => ({
      title: f(s.title),
      ...(s.paragraphs && { paragraphs: fillList(s.paragraphs, names) }),
      ...(s.bullets && { bullets: fillList(s.bullets, names) }),
    })),
    tips: fillList(RAW.tips, names),
    glossary: RAW.glossary!.map((g) => ({ term: f(g.term), meaning: f(g.meaning) })),
    ...(footer && { footer }),
  };
}

export const guide: GameGuide = nameGuide(PLACEHOLDER_NAMES);

export { creditOf, footerOf, namesOf } from './manifest.ts';
