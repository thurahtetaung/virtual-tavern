import type { GameGuide } from '@vt/game-sdk';
import { STEPS } from './plan.ts';
import {
  ARTIFACTS,
  ARTIFACT_IDS,
  ENABLED_SETS,
  MARKS,
  MARK_IDS,
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
    : s.id === 'vampires'
      ? 'Vampires (together: Vampire, The Master, The Count)'
      : s.id === 'dusk'
        ? 'Everyone looks at their own Mark (the end of the dusk)'
        : s.id === 'lovers'
          ? 'The lovers wake and see each other'
          : s.doppel
            ? `Doppelganger, if she copied the ${roleLabel(s.role)}`
            : roleLabel(s.role),
);

export const guide: GameGuide = {
  tagline: 'One night, hidden roles, one vote: find a werewolf before sunrise, or be one.',
  players: '3 to 10',
  duration: '10 minutes a game',
  goal: 'Everyone gets a secret role. The village wins if at least one Werewolf (or Vampire) dies in the vote; the werewolves and vampires win if none of theirs does. Some roles have goals of their own.',
  quickStart: [
    'Everyone gets one secret role card: look at it, then press Ready.',
    'At night, keep your eyes closed until your role is called. When you wake, follow the prompt on your screen.',
    'Cards can be swapped in the night, so the role you end with may not be the one you were dealt.',
    'At daybreak, talk it over: claim, bluff and work out who the werewolves are.',
    'Then everyone votes at once. The player with the most votes dies.',
    'Usually the village wins if a werewolf dies and the werewolves win if none does; some roles bring goals of their own.',
  ],
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
        'If another Vampire votes for The Master, he can’t die in the vote; the next most voted (with more than one vote) dies instead.',
        'When a player with a Mark of Love dies, every other lover dies too, even a protected one.',
        'Anyone who votes for the player with the Mark of Disease, or for the Diseased, can’t win.',
      ],
    },
    {
      title: 'Epic battles',
      paragraphs: [
        'When the players include werewolves, vampires and villagers all at once (a Mark of the Vampire counts), it’s an epic battle, and the vote changes.',
      ],
      bullets: [
        'Protected players are left out, then the most voted player dies, as long as they have at least two votes, and so does the second most voted, even with one vote. Most Votes tokens #1 and #2 mark them.',
        'If several players tie for the most votes, only they die.',
        'Each evil team wins only if none of its members dies and a member of another evil team does. The village needs members of two different evil teams to die.',
      ],
    },
    {
      title: 'Who wins',
      bullets: [
        'The village wins if at least one Werewolf dies, or if no player is a Werewolf and nobody dies.',
        'The werewolves win if at least one player is a Werewolf and no Werewolf dies.',
        'If a Tanner dies, the werewolves can’t win; the Tanner wins.',
        'The vampires win if at least one player is a Vampire (by card or by Mark) and no Vampire dies. Renfield wins with them, even if he dies.',
        'The Assassin wins if a player with the Mark of the Assassin dies, alongside any team; the Apprentice Assassin, if an Assassin dies.',
        'A player with the Mark of the Traitor wins only if someone else on their team dies.',
        'Then everything is revealed: who started as what, where the cards ended up, and a step-by-step replay of the night.',
      ],
    },
    {
      title: 'Marks',
      paragraphs: [
        'With roles from the vampire set, every player starts with a face-down Mark of Clarity in front of them. At dusk, before the night proper, some roles give, take or swap Marks; then everyone wakes to look at their own Mark (never anyone else’s), and the lovers wake to see each other.',
        'A Mark belongs to the player, not the card: swapping cards leaves the Marks where they are. A player only ever holds one Mark; giving a new one sends the old one back unseen. A shield protects a card, never its Mark. An artifact that changes your role beats your card and the Mark of the Vampire.',
      ],
      bullets: MARK_IDS.map((m) => `${roleLabel(m)}: ${MARKS[m]}`),
    },
    {
      title: 'Artifacts',
      paragraphs: [
        'The Curator places a random artifact on a card. Whoever ends up with it sees it at daybreak, and must follow it.',
      ],
      bullets: ARTIFACT_IDS.map((a) => `${roleLabel(a)}: ${ARTIFACTS[a].summary}`),
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
    'Your Mark may have moved since you saw it at dusk: the Pickpocket and the Gremlin work in the dark.',
  ],
};
