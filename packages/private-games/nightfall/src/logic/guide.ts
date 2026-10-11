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
          : s.id === 'aliens'
            ? 'Aliens (together: Alien, Synthetic Alien, Groob, Zerb, Body Snatcher; the Cow puts out a fist)'
            : s.id === 'groob-zerb'
              ? 'Groob and Zerb, together'
              : s.id === 'blob'
                ? 'The Blob’s members are announced (nobody wakes)'
                : s.id === 'ripple'
                  ? 'A ripple, perhaps (announced to everyone)'
                  : s.doppel
                    ? `Doppelgänger, if she copied the ${roleLabel(s.role)}`
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
    'The host picks the cards: one per player plus three for the centre (plus one when the Alpha Wolf is in). The recommended cards for your table size are picked to start with, and follow the table as people join until the host changes them. Ready-made setups are tagged Beginner, Advanced or Chaos.',
    'Everyone gets one card. Cover your screen and peek at your role; Ready unlocks once you have looked.',
    'Night falls once everyone is ready (the host can start it early if someone dropped out). The app calls each role in turn.',
    'Narration: with Host’s device, only the host’s phone speaks, so put it in the middle of the table; with Every device, every phone speaks, which suits players who are apart. Every screen shows the narration as text either way.',
  ],
  sections: [
    {
      title: 'The night',
      paragraphs: [
        'Every role in the game is called in a fixed order, even when its card is in the centre, and every call lasts the same time. So nobody can tell from the clock which roles are really at the table.',
        'When your role is called, your screen lights up: tap players or centre cards to act, and see what you learn. Everyone else just sees which role is awake. If you don’t choose in time, optional actions are skipped and required ones are made for you at random.',
        'Left and right follow the seat order in the app, not where you sit, so the buttons name the player on each side.',
        'You always act as the role you were dealt, even if your card has been swapped since. At the end of the night you are whatever card is in front of you, and you don’t get to look again.',
      ],
      bullets: wakeOrder.map((s, i) => `${i + 1}. ${s}`),
    },
    {
      title: 'The day and the vote',
      bullets: [
        'Talk it over. Say anything you like (lies included), but never show your screen.',
        'Press Ready to vote when you’re done; the vote opens when everyone is ready or the clock runs out. The host can open it early (when someone has dropped out, say).',
        'Everyone secretly votes for another player, then all votes show at once.',
        'The player with the most votes dies; on a tie, everyone tied dies. If nobody gets more than one vote, nobody dies.',
        'Votes for a Prince don’t count, and the Bodyguard’s pick protects instead of voting: a Bodyguard’s buttons read Protect.',
        'If another Vampire votes for The Master, he can’t die in the vote; the next most voted (with more than one vote) dies instead.',
        'You can’t vote for a player who has left the game.',
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
        'Protected players are left out, then the most voted player dies, as long as they have at least two votes, and so does the second most voted, even with one vote. Everyone tied for second dies. Most Votes tokens #1 and #2 mark them.',
        'If several players tie for the most votes, only they die: nobody dies in second place.',
        'If nobody has two votes, nobody dies.',
        'Each evil team wins only if none of its members dies and a member of another evil team does. The village needs members of two different evil teams to die.',
      ],
    },
    {
      title: 'Who wins',
      bullets: [
        'The village wins if at least one Werewolf dies (with vampires instead of werewolves, a Vampire; with both, either), or if no player is a Werewolf or Vampire and nobody dies. In an epic battle the village needs one of each to die.',
        'The werewolves win if at least one player is a Werewolf and no Werewolf dies.',
        'The vampires win if at least one player is a Vampire (by card or by Mark) and no Vampire dies. Renfield wins with them, even if he dies. A Mark of the Vampire keeps its holder a Vampire whatever card they end with, the Assassins’ cards included.',
        'If a Tanner dies, no evil team can win (neither the werewolves nor the vampires); the Tanner wins. With no Tanner among the players, an Apprentice Tanner counts as one.',
        'The Cursed joins the werewolves if a Werewolf votes for him; with vampires in the game, a Vampire’s vote turns him too, and he joins the side that cast more of those votes (a tie makes him a Werewolf).',
        'The Assassin wins if a player with the Mark of the Assassin dies, alongside any team. The Apprentice Assassin wins if an Assassin dies; if she found no Assassin and placed the Mark herself, she wins when its holder dies, even if her card moves later.',
        'A player with the Mark of the Traitor wins only if someone else on their team dies, even when their team loses; their team’s result doesn’t count for them.',
        'A player held by the Mark of Fear sleeps through their turn, and learns at daybreak that they did.',
        'Then everything is revealed: who started as what, where the cards and Marks ended up (with each Mark a player held along the way), who was protected and why, and a step-by-step replay of the night.',
      ],
    },
    {
      title: 'Aliens',
      paragraphs: [
        'With roles from the alien set, every player has a number: their seat, counting up to the left (the table shows each number as a token). The narrator uses the numbers: “any even player”, “a player with a number higher than yours”, “players 2, 5 or 7”. When nobody fits, the action can’t be done.',
        'Many alien roles get their instruction at random when they wake, like the narrator choosing a card from a deck: the aliens might look at a card, show each other their cards, pass their cards round, shorten the day or tap a fist to recruit a New Alien. Only the players woken (or named) are told. In the lobby, the host can see and change how likely each instruction is under Alien options, and reset them.',
        'An Alien is anyone holding an alien card (Alien, Synthetic Alien, Groob, Zerb, the Body Snatcher, or a card the Body Snatcher took), a New Alien the aliens tapped (whatever card they hold), or anyone with the Alien Artifact. If any alien dies, the aliens lose.',
      ],
      bullets: [
        'The aliens win if at least one player is an Alien and none of them dies. The village wins if an alien (or a werewolf, or a vampire) dies.',
        'If the Synthetic Alien dies, he wins, and the aliens and the village both lose.',
        'With Groob and Zerb both among the players, they are rivals: each wins only if the other dies and they live (the village wins too, and the other aliens lose). The Leader then wins only if both live.',
        'If every player on the aliens’ side votes for the Leader, the aliens win and the village loses, even if an alien dies.',
        'The Blob doesn’t wake: the narrator announces how many neighbours are part of it (1 with 3–4 players, 2 with 5–6, 3 with 7–8, 4 with 9 or more), counted from wherever the Blob card ends up. The Blob wins if none of them dies, alongside any other team.',
        'The Mortician wins if a neighbour of the Mortician card dies, alongside any other team.',
        'The Oracle answers one question at the very start. Joining a team changes her side, but she doesn’t wake with it. If she fails the number question, she wins only by surviving, and everyone else only if she dies; with her card in the centre, everyone must survive to win.',
        'Nostradamus may look at up to three players’ cards, stopping at one that isn’t village; that card’s team is announced as his. He wins only if he lives and that team wins.',
        'The Empath watches while the players the narrator names point, eyes closed, at someone who fits its question.',
        'With aliens in the game, aliens, werewolves and vampires make an epic battle together: the village then needs players from two different evil sides to die.',
      ],
    },
    {
      title: 'Ripples',
      paragraphs: [
        'When the aliens’ own cards are in the game, the night may end with a ripple in the space-time continuum, announced to everyone. Each kind has its own odds (the host can change them); about one night in five has none.',
      ],
      bullets: [
        'A shorter day (one minute), voting for the app instead of a player (if the app gets the most votes, nobody dies), or voting with both hands.',
        'Some players may only say “I am an alien”, must face away from the table, or may not speak until the vote.',
        'A named player may look at cards, look at their own card, swap two players’ cards, rob, swap blindly, play the Witch or turn a card face up; two named players may show each other their cards and have them shuffled between them.',
        'A time loop: the whole night runs again on the board as it is (Marks are given again, shields placed again), everyone waking as their original role; the Oracle, the Blob and the ripple don’t come round again. Sometimes one player keeps their eyes open throughout and sees who wakes and what they touch.',
        'A repeat: one role in the game does its night action again, with fresh choices.',
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
    {
      title: 'During the day',
      bullets: [
        'The Learned tab starts with where you stand now: what you started as, your card and Mark as far as you know, and what that means for your side. Someone may still have moved them without you knowing.',
        'The Roles tab lists the cards in play in wake order (with copies, like ×2), the roles the Doppelgänger wakes again for, and the Marks and artifacts that can turn up.',
      ],
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
