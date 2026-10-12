import { describe, expect, it } from 'vitest';
import { HOST, harness, ids, propose, questRound, rigged, voteAll } from '../logic/test-utils.ts';
import type { RoleId } from '../logic/types.ts';
import { statusFor, waitingOn } from './status.ts';

const BASE5: RoleId[] = ['merlin', 'servant', 'servant', 'assassin', 'minion'];
const people = (offline: string[] = []) => ({
  hostId: HOST,
  players: ids(5).map((id) => ({ id, name: id.toUpperCase(), connected: !offline.includes(id) })),
});

describe('status', () => {
  it('guides the lobby', () => {
    const h = harness(ids(4));
    expect(statusFor(h.view(HOST), true).text).toBe(
      'Almost ready: 5 players are needed (4 so far).',
    );
    const full = harness(ids(5));
    expect(statusFor(full.view(HOST), true)).toEqual({
      text: 'Everyone is in. Check the roles, then press Start game!',
      yourMove: true,
    });
    expect(statusFor(full.view('ana'), false, people()).text).toBe(
      'All set. Waiting for HOST (host) to start…',
    );
  });

  it('asks each player to read their card, then names who is left', () => {
    const h = rigged(BASE5, { ready: false });
    expect(statusFor(h.view('ana'), false).yourMove).toBe(true);
    h.act({ type: 'ready' }, 'ana');
    expect(statusFor(h.view('ana'), false, people(['dee'])).text).toBe(
      'Everyone is reading their secret role. Waiting for: HOST, BEN, CY and DEE (offline).',
    );
  });

  it('tells the leader what to pick and everyone else who is choosing', () => {
    const h = rigged(BASE5);
    expect(statusFor(h.view(HOST), true)).toEqual({
      text: 'You lead! Tap 2 players for quest 1 (you may pick yourself), then send the team to the vote.',
      yourMove: true,
    });
    expect(statusFor(h.view('ana'), false)).toEqual({
      text: 'HOST is choosing a team of 2 for quest 1. Say out loud who you trust.',
      yourMove: false,
    });
    expect(waitingOn(h.view('ana'))).toEqual([HOST]);
  });

  it('asks for a vote, and warns on the fifth proposal', () => {
    const h = rigged(BASE5);
    for (let i = 0; i < 4; i++) {
      propose(h, [HOST, 'ana']);
      voteAll(h, ['ana', 'ben', 'cy']);
    }
    propose(h, [HOST, 'ana']);
    const v = h.view('ben');
    expect(statusFor(v, false)).toEqual({
      text: 'Vote on DEE’s team: Approve or Reject. Everyone’s vote shows once all are in. This is the 5th proposal: if it’s rejected, Evil wins.',
      yourMove: true,
    });
    h.act({ type: 'vote', approve: false }, 'ben');
    expect(statusFor(h.view('ben'), false).text).toMatch(
      /^You voted Reject \(you can still change it\)\./,
    );
    expect(statusFor(h.view('dee'), false).text).toMatch(/^Vote on your team/);
  });

  it('speaks to Good and Evil differently on a quest', () => {
    const h = rigged(BASE5);
    propose(h, ['ana', 'dee']);
    voteAll(h);
    expect(statusFor(h.view('ana'), false).text).toBe(
      'You’re on the quest. Loyal players always play Success.',
    );
    expect(statusFor(h.view('dee'), false).text).toBe(
      'You’re on the quest. Play Success to keep your cover, or Fail to sink it.',
    );
    expect(statusFor(h.view('ben'), false).yourMove).toBe(false);
  });

  it('the Lady, the assassination and the end', () => {
    const h = rigged(
      ['merlin', 'servant', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'],
      { lady: true },
    );
    questRound(h, ['ana', 'ben', 'cy']);
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    expect(statusFor(h.view('gus'), false).yourMove).toBe(true);
    expect(statusFor(h.view('ana'), false).text).toBe(
      'GUS is using the Lady of the Lake to check someone’s loyalty…',
    );
    h.act({ type: 'lady', target: 'ana' }, 'gus');
    questRound(h, ['ana', 'ben', 'cy', 'dee']);
    expect(statusFor(h.view('eve'), false).yourMove).toBe(true);
    expect(statusFor(h.view('fin'), false).text).toMatch(/^Good won three quests\. Help EVE/);
    expect(statusFor(h.view('ana'), false).text).toBe(
      'Good won three quests! EVE, the Assassin, is choosing who they think is Merlin…',
    );
    h.act({ type: 'assassinate', target: 'ana' }, 'eve');
    expect(statusFor(h.view('ana'), false).text).toBe(
      'You win! Good wins: Good completed three quests, and the Assassin missed Merlin.',
    );
    expect(statusFor(h.view('eve'), false).text).toMatch(/^You lose\./);
  });
});
