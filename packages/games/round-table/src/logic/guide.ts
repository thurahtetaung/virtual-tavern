import type { GameGuide } from '@vt/game-sdk';
import { ROLES, ROLE_ORDER } from './roles.ts';

/** Each role's one-line goal, for the role card (and the guide). */
export const ROLE_GOAL: Record<string, string> = {
  good: 'Win three quests, and keep Merlin hidden from the Assassin.',
  evil: 'Sink three quests, get five teams rejected in a row, or have the Assassin find Merlin.',
};

export const guide: GameGuide = {
  tagline: 'Loyal knights against hidden traitors: pick teams, vote, and protect Merlin.',
  players: '5–10 players (more can watch)',
  duration: '30–45 minutes',
  goal: 'Good wins by completing three of five quests and keeping Merlin hidden. Evil wins by sinking three quests, by getting five teams rejected in a row, or by naming Merlin at the end.',
  quickStart: [
    'Read your secret role card: it says your side and who you know. Never show it to anyone.',
    'The leader (👑) picks a team for the next quest; everyone talks it over out loud.',
    'Everyone votes Approve or Reject at once. Five rejected teams in a row and Evil wins.',
    'An approved team plays secret cards: Good must play Success, Evil may play Fail.',
    'Three quests decide the game. If Good gets three, the Assassin has one guess at Merlin.',
  ],
  setup: [
    'Gather 5 to 10 players in one room, on a call or around a table. Everyone talks out loud.',
    'The host picks a ready-made line-up (First game is the simplest) or chooses the special roles; Loyal Servants and Minions fill the rest.',
    'Optional: the Lady of the Lake (best from 7 players), Targeting, and timers.',
    'Press Start: everyone reads their own role card in private, then taps “I’ve seen my role”.',
  ],
  roles: ROLE_ORDER.map((id) => {
    const r = ROLES[id];
    return { name: `${r.name} (${r.loyalty === 'good' ? 'Good' : 'Evil'})`, summary: r.detail };
  }),
  sections: [
    {
      title: 'Two hidden sides',
      paragraphs: [
        'Most players are Good, loyal to the Round Table. A few are Evil, and Evil players (all but Oberon) know each other. Good players don’t know who anyone is, except Merlin (who knows the Evil players) and Percival (who knows Merlin, but can mix him up with Morgana).',
        'The app shows each player only their own card and what that role learns. Everything else happens in conversation: claim, accuse, bluff and persuade out loud.',
      ],
    },
    {
      title: 'Building a team',
      bullets: [
        'The leader (👑) picks exactly as many players as the quest needs (shown in its circle). Leaders may pick themselves.',
        'Everyone sees the team change as the leader taps names, so argue while it’s forming.',
        'When ready, the leader sends the team to the vote.',
      ],
    },
    {
      title: 'The vote',
      bullets: [
        'Everyone, the leader included, votes Approve or Reject. Votes stay secret until the last one is in, then everyone’s vote is shown.',
        'More Approves than Rejects sends the team on the quest. A tie is a rejection.',
        'A rejection passes the lead to the next player clockwise, who proposes a new team.',
        'Five rejected teams in a row (in one round) and Evil wins at once. 🔨 marks the player who would make that fifth, last proposal.',
      ],
    },
    {
      title: 'The quest',
      bullets: [
        'Each team member secretly plays a card. Good players can only play Success; Evil players may play Success or Fail.',
        'The cards are shuffled: everyone sees how many Fails were played, never who played them.',
        'One Fail sinks a quest, except quest 4 with 7 or more players, which needs two (marked “2 fails” on its circle).',
        'After every quest the lead passes clockwise and the next round begins.',
      ],
    },
    {
      title: 'The end',
      bullets: [
        'Three failed quests: Evil wins. Five rejections in a row: Evil wins.',
        'Three successful quests: the Assassin (after talking with Evil) names one player as Merlin. Right: Evil wins. Wrong: Good wins.',
        'Without Merlin in the game there is no assassination: three successes win it for Good.',
        'With Merlin but no Assassin card, one Evil player (never Oberon) is told privately that they make the pick.',
      ],
    },
    {
      title: 'Lady of the Lake (option)',
      bullets: [
        'The Lady starts with the player to the first leader’s right.',
        'After quests 2, 3 and 4, her holder checks one player and privately sees if they are Good or Evil. Everyone sees who was checked, never the result.',
        'The checked player takes the Lady. Nobody who has held her can be checked.',
        'The holder may tell the table anything about the result, true or not.',
      ],
    },
    {
      title: 'Targeting (option)',
      bullets: [
        'The leader also picks which quest the team attempts, using that quest’s team size.',
        'Each quest is played once, and quest 5 opens only once two quests have succeeded.',
        'Quest 4 still needs two Fails with 7 or more players, whenever it’s played.',
      ],
    },
    {
      title: 'Oberon: two readings',
      paragraphs: [
        'By the rulebook, Merlin sees Oberon as Evil and the Lady shows him as Evil. With the FAQ reading (an Advanced option), Merlin doesn’t see Oberon and the Lady shows him as Good.',
      ],
    },
    {
      title: 'Timers and absent players',
      bullets: [
        'Timers are off unless the host sets them. A reminder timer only turns red; a strict one acts.',
        'When a strict timer runs out: a missing vote counts as Approve, a missing quest card is Success, and the leader’s team, the Lady’s check and the assassination are picked at random.',
        'The host can do the same for a player who has gone quiet (Skip). Players who leave keep their seat, and the game plays their turns that way.',
      ],
    },
  ],
  tips: [
    'Good: watch the votes as closely as the quests. Who approved a team that failed?',
    'Merlin: nudge, don’t point. If the Assassin can spot you, Evil still wins.',
    'Percival: work out which of your two is the real Merlin, then quietly back them.',
    'Evil: a Fail on an early quest can give you away. Sometimes playing Success earns more trust.',
    'Use ⭐ and ✕ on the seats to keep private notes on who you trust. Only you see them.',
  ],
  glossary: [
    { term: 'Leader 👑', meaning: 'Picks the team this proposal.' },
    {
      term: 'Hammer 🔨',
      meaning: 'Makes the round’s fifth proposal: if it is rejected, Evil wins.',
    },
    { term: 'Vote track', meaning: 'Rejected teams in a row this round (five means Evil wins).' },
    { term: 'Lady 🌊', meaning: 'Her holder checks one player’s loyalty after quests 2, 3 and 4.' },
  ],
};
