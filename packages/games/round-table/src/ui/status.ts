import { type PresencePlayer, listNames, waitingFor, waitingForHost } from '@vt/game-sdk';
import { MAX_REJECTIONS, type EndReason, type RoundTableView } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room (and online), so waiting texts can name people and the host. */
export interface People {
  hostId: string;
  players: readonly PresencePlayer[];
}

export const nameOf = (view: RoundTableView, id: string | null | undefined) =>
  view.game?.players.find((p) => p.id === id)?.name ??
  view.seats.find((s) => s.id === id)?.name ??
  'Someone';

/** "you" for the viewer, else the name. */
export const who = (view: RoundTableView, id: string | null | undefined, you = 'you') =>
  id && id === view.me?.id ? you : nameOf(view, id);

/** How the game ended, in a sentence. */
export const END_LINE: Record<EndReason, string> = {
  quests: 'Good completed three quests.',
  'assassin-missed': 'Good completed three quests, and the Assassin missed Merlin.',
  'assassin-hit': 'Good completed three quests, but the Assassin found Merlin.',
  fails: 'Evil sank three quests.',
  rejections: 'Five teams in a row were rejected.',
};

/** Who the table is waiting on right now (ids), from the public view. */
export function waitingOn(view: RoundTableView): string[] {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return [];
  switch (view.stage) {
    case 'reveal':
      return g.players.map((p) => p.id).filter((id) => !g.ready.includes(id));
    case 'propose':
      return [g.leader];
    case 'vote':
      return g.players.map((p) => p.id).filter((id) => !g.vote!.voted.includes(id));
    case 'quest':
      return g.quest!.team.filter((id) => !g.quest!.played.includes(id));
    case 'lady':
      return g.lady ? [g.lady.holder] : [];
    case 'assassinate':
      return g.assassin ? [g.assassin] : [];
    default:
      return [];
  }
}

/** The quest being built or played, its team size and how many Fails sink it. */
export function currentQuest(view: RoundTableView) {
  const g = view.game;
  const slot = g?.slot ?? null;
  if (!g || slot === null) return null;
  return { slot, number: slot + 1, ...g.quests[slot]! };
}

/** Plain-language guidance for whoever is looking at the screen: what to do right now. */
export function statusFor(view: RoundTableView, isHost: boolean, people?: People): Status {
  const me = view.me;
  const host = (what: string) =>
    people ? waitingForHost(people, what) : `Waiting for the host to ${what}…`;
  const waiting = (ids: string[]) => {
    if (!people) return '';
    const text = waitingFor(ids, people.players, { you: me?.id });
    return text ? ` ${text}.` : '';
  };
  if (view.phase === 'lobby') {
    if (me && !me.playing)
      return {
        text: 'The table is full: you’re watching, and you’ll get a seat when one frees up.',
        yourMove: false,
      };
    const blocker = view.setup.errors[0];
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is in. Check the roles, then press Start game!', yourMove: true }
      : { text: `All set. ${host('start')}`, yourMove: false };
  }
  const g = view.game!;
  const role = view.role;
  if (view.phase === 'over') {
    const end = g.end!;
    const mine = role ? (role.loyalty === end.winner ? 'You win! ' : 'You lose. ') : '';
    return {
      text: `${mine}${end.winner === 'good' ? 'Good' : 'Evil'} wins: ${END_LINE[end.reason]}`,
      yourMove: false,
    };
  }
  const q = currentQuest(view);
  const leader = who(view, g.leader, 'You');
  switch (view.stage) {
    case 'reveal':
      if (role && !g.ready.includes(me!.id))
        return {
          text: 'Read your secret role card (keep it to yourself), then tap “I’ve seen my role”.',
          yourMove: true,
        };
      return {
        text: `Everyone is reading their secret role.${waiting(waitingOn(view))}`,
        yourMove: false,
      };
    case 'propose': {
      if (g.leader === me?.id && role)
        return {
          text: g.targeting
            ? `You lead! Pick a quest, then tap ${q?.size ?? ''} players for it (you may pick yourself). Send the team to the vote when the table has talked.`
            : `You lead! Tap ${q?.size} players for quest ${q?.number} (you may pick yourself), then send the team to the vote.`,
          yourMove: true,
        };
      return {
        text: `${leader} is choosing a team of ${q?.size} for quest ${q?.number}. Say out loud who you trust.`,
        yourMove: false,
      };
    }
    case 'vote': {
      const vote = g.vote!;
      const last =
        g.rejections === MAX_REJECTIONS - 1
          ? ' This is the 5th proposal: if it’s rejected, Evil wins.'
          : '';
      if (role && vote.myVote === null)
        return {
          text: `Vote on ${who(view, vote.leader, 'your')}${vote.leader === me?.id ? '' : '’s'} team: Approve or Reject. Everyone’s vote shows once all are in.${last}`,
          yourMove: true,
        };
      return {
        text: `${role ? `You voted ${vote.myVote ? 'Approve' : 'Reject'} (you can still change it).` : 'The table is voting.'}${last}${waiting(waitingOn(view))}`,
        yourMove: false,
      };
    }
    case 'quest': {
      const quest = g.quest!;
      const onTeam = !!me && quest.team.includes(me.id);
      if (onTeam && role && quest.myCard === null)
        return {
          text:
            role.loyalty === 'good'
              ? 'You’re on the quest. Loyal players always play Success.'
              : 'You’re on the quest. Play Success to keep your cover, or Fail to sink it.',
          yourMove: true,
        };
      return {
        text: `The team is on quest ${q?.number}. Nobody sees who played what, only how many Fails.${waiting(waitingOn(view))}`,
        yourMove: false,
      };
    }
    case 'lady': {
      const holder = g.lady!.holder;
      if (holder === me?.id)
        return {
          text: 'You hold the Lady of the Lake: tap a player to check their loyalty. Only you will see the answer.',
          yourMove: true,
        };
      return {
        text: `${nameOf(view, holder)} is using the Lady of the Lake to check someone’s loyalty…`,
        yourMove: false,
      };
    }
    case 'assassinate': {
      const assassin = g.assassin;
      if (assassin === me?.id)
        return {
          text: 'Good won three quests, but you get one shot: talk with Evil, then tap who you think is Merlin.',
          yourMove: true,
        };
      if (role?.loyalty === 'evil')
        return {
          text: `Good won three quests. Help ${nameOf(view, assassin)} (the Assassin) work out who Merlin is: they make the call.`,
          yourMove: false,
        };
      return {
        text: `Good won three quests! ${nameOf(view, assassin)}, the Assassin, is choosing who they think is Merlin…`,
        yourMove: false,
      };
    }
    default:
      return { text: '', yourMove: false };
  }
}

/** "Ana, Ben and you": names for a list of ids. */
export const namesFor = (view: RoundTableView, ids: readonly string[]) =>
  listNames(ids.map((id) => who(view, id)));
