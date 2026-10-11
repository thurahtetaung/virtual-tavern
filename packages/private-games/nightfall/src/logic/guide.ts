import type { GameGuide } from '@vt/game-sdk';
import { STEPS } from './plan.ts';
import {
  ARTIFACTS,
  ARTIFACT_IDS,
  ENABLED_SETS,
  ROLES,
  ROLE_IDS,
  SET_LABELS,
  roleLabel,
} from './roles.ts';

// Built from the role registry, so the guide always matches the engine. It uses the plain role
// words; the game screens show each card's real name and picture from private storage.

const playable = ROLE_IDS.filter((r) => ENABLED_SETS.includes(ROLES[r].set));

const wakeOrder = STEPS.filter((s) => playable.includes(s.role)).map((s) =>
  s.id === 'werewolves'
    ? 'Werewolves (together)'
    : s.doppel
      ? `Doppelganger, if she copied the ${roleLabel(s.role)}`
      : roleLabel(s.role),
);

export const guide: GameGuide = {
  tagline: 'One night, hidden roles, one vote: find a werewolf before sunrise, or be one.',
  players: '3 to 10',
  duration: '10 minutes a game',
  goal: 'Everyone gets a secret role. The village wins if at least one Werewolf dies in the vote; the werewolves win if none of them does. Some roles have goals of their own.',
  setup: [
    'The host picks the cards: one per player plus three for the centre (plus one when the Alpha Wolf is in). Presets cover proven setups for every table size.',
    'Everyone gets one card. Cover your screen, peek at your role, then press Ready.',
    'Night falls once everyone is ready. The app calls each role in turn.',
  ],
  sections: [
    {
      title: 'The night',
      paragraphs: [
        'Every role in the game is called in a fixed order, even when its card is in the centre, and every call lasts the same time. So nobody can tell from the clock which roles are really at the table.',
        'When your role is called, your screen lights up: tap players or centre cards to act, and see what you learn. Everyone else just sees the night. If you don’t choose in time, optional actions are skipped and required ones are made for you at random.',
        'You always act as the role you were dealt, even if your card has been swapped since. At the end of the night you are whatever card is in front of you, and you don’t get to look again.',
      ],
      bullets: wakeOrder.map((s, i) => `${i + 1}. ${s}`),
    },
    {
      title: 'The day and the vote',
      bullets: [
        'Talk it over. Say anything you like (lies included), but never show your screen.',
        'Press Ready to vote when you’re done; the vote opens when everyone is ready or the clock runs out.',
        'Everyone secretly votes for another player, then all votes show at once.',
        'The player with the most votes dies; on a tie, everyone tied dies. If nobody gets more than one vote, nobody dies.',
        'Votes for a Prince don’t count, and the Bodyguard’s pick protects instead of voting.',
      ],
    },
    {
      title: 'Who wins',
      bullets: [
        'The village wins if at least one Werewolf dies, or if no player is a Werewolf and nobody dies.',
        'The werewolves win if at least one player is a Werewolf and no Werewolf dies.',
        'If a Tanner dies, the werewolves can’t win; the Tanner wins.',
        'Then everything is revealed: who started as what, where the cards ended up, and a step-by-step replay of the night.',
      ],
    },
    {
      title: 'Artifacts',
      paragraphs: [
        'The Curator places a random artifact on a card. Whoever ends up with it sees it at daybreak, and must follow it.',
      ],
      bullets: ARTIFACT_IDS.filter((a) => !ARTIFACTS[a].needsSet).map(
        (a) => `${roleLabel(a)}: ${ARTIFACTS[a].summary}`,
      ),
    },
  ],
  roles: playable.map((r) => ({
    name: `${roleLabel(r)} (${SET_LABELS[ROLES[r].set]})`,
    summary: `${ROLES[r].summary} ${ROLES[r].win}`,
  })),
  tips: [
    'Claim a role, or don’t: the werewolves will be claiming too.',
    'Roles that swap cards make everyone unsure what they are now. Use that.',
    'Listen to who knows what: the Seer, Robber and Insomniac learned real cards.',
  ],
};
