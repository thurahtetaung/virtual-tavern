import { describe, expect, it } from 'vitest';
import { FRAME_LINES, buildNightPlan, stepLines } from '../logic/plan.ts';
import { ARTIFACTS, ROLE_IDS, type RoleId } from '../logic/roles.ts';
import { table } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import type { VoteResult } from '../logic/types.ts';
import {
  centreKinds,
  describeEntry,
  describeNote,
  markHistory,
  narrationText,
  teamLines,
} from './text.ts';

const deck = deckFor(null, (id) => ARTIFACTS[id].summary);
const SECOND_PERSON = /\b(you|your|yours|yourself)\b/i;

/** Plays a night out: everyone takes their first choice when they have one, else time runs out. */
function playNight(players: RoleId[], center: RoleId[], wolf?: RoleId) {
  const h = table({ players, center, ...(wolf ? { wolf } : {}) });
  for (let i = 0; i < 200 && h.state.stage === 'night'; i++) {
    for (const p of h.state.round!.night!.actors) {
      const pr = h.view(p).night?.acting?.prompt;
      if (!pr) continue;
      try {
        if (pr.sides) h.night(p, { side: 'left' });
        else if (pr.players && pr.players.ids.length >= pr.players.min)
          h.night(p, { players: pr.players.ids.slice(0, Math.max(1, pr.players.min)) });
        else if (pr.center) h.night(p, { center: pr.center.slots.slice(0, pr.center.min || 1) });
      } catch {
        // A choice the step refuses: let the clock decide.
      }
    }
    h.tick();
  }
  return h;
}

describe('the replay of the night', () => {
  it.each([
    [
      ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker'],
      ['drunk', 'insomniac', 'mason'],
    ],
    [
      ['werewolf', 'mason', 'mason', 'curator', 'village-idiot'],
      ['witch', 'minion', 'seer'],
    ],
    [
      ['alpha-wolf', 'werewolf', 'sentinel', 'paranormal-investigator', 'thing'],
      ['revealer', 'apprentice-seer', 'villager'],
    ],
    [
      ['vampire', 'the-count', 'cupid', 'priest', 'pickpocket'],
      ['gremlin', 'marksman', 'diseased'],
    ],
  ] as [RoleId[], RoleId[]][])('is in the third person throughout (%j)', (players, center) => {
    const h = playNight(players, center, players.includes('alpha-wolf') ? 'werewolf' : undefined);
    const nameOf = (id: string | null | undefined) => (id ? `Player ${id}` : 'Someone');
    const timeline = h.state.round!.night!.timeline;
    expect(timeline.length).toBeGreaterThan(0);
    for (const e of timeline) {
      const text = describeEntry(e, nameOf, deck, centreKinds(h.state.settings.roles));
      expect(text, JSON.stringify(e)).not.toMatch(SECOND_PERSON);
    }
  });

  it('names who saw whom, and who was alone', () => {
    const nameOf = (id: string | null | undefined) => (id ? `Player ${id}` : 'Someone');
    const group = (players: string[]) =>
      describeEntry(
        {
          step: 1,
          stepId: 'werewolves',
          by: 'A',
          note: { kind: 'group', group: 'werewolves', players },
        },
        nameOf,
        deck,
      );
    expect(group(['A', 'B'])).toBe('Player A saw the other werewolves: Player B.');
    expect(group(['A'])).toBe('Player A was the only werewolf awake.');
    expect(
      describeEntry(
        { step: 2, stepId: 'curator', by: 'A', note: { kind: 'artifact-placed', target: 'A' } },
        nameOf,
        deck,
      ),
    ).toBe('Player A placed an artifact on their own card.');
  });
});

describe('centre cards', () => {
  it('names the centre werewolf slot the same way everywhere', () => {
    const kinds = centreKinds(['alpha-wolf', 'werewolf', 'seer']);
    expect(kinds).toEqual(['center', 'center', 'center', 'wolf']);
    expect(centreKinds(['werewolf'])).toHaveLength(3);
    const nameOf = () => 'Ana';
    expect(describeNote({ kind: 'took-center', center: 3 }, nameOf, deck, kinds)).toContain(
      'the centre werewolf card',
    );
  });
});

describe('narration as text', () => {
  const roles: RoleId[] = ['werewolf', 'werewolf', 'seer', 'robber', 'minion', 'villager'];

  it('speaks to the players who are awake, and tells everyone else who is', () => {
    expect(narrationText('seer:wake', deck, { awake: true })).toMatch(/^SEER, wake up/);
    expect(narrationText('seer:wake', deck, { awake: false })).toBe('The Seer is awake.');
    expect(narrationText('seer:close', deck, { awake: false })).toBe(
      'The Seer goes back to sleep.',
    );
    expect(narrationText('werewolf:wake', deck, { awake: false })).toBe(
      'The werewolves are awake.',
    );
    expect(narrationText(FRAME_LINES.nightStart, deck, { awake: false })).toBe(
      'Everyone closes their eyes.',
    );
  });

  it('never gives an idle phone an instruction, for any step', () => {
    for (const id of buildNightPlan([...ROLE_IDS])) {
      const lines = stepLines(id, [...ROLE_IDS], { loneWolf: true });
      for (const key of [...lines.open, ...lines.close]) {
        const text = narrationText(key, deck, { awake: false });
        expect(text, key).not.toMatch(SECOND_PERSON);
        expect(text, key).not.toMatch(/wake up|close your eyes/i);
      }
    }
    expect(buildNightPlan(roles).length).toBeGreaterThan(0);
  });

  it('doesn’t say time ran out when everyone was ready to vote', () => {
    expect(narrationText(FRAME_LINES.vote, deck, { awake: true, readyEarly: true })).toBe(
      'Everyone’s ready. Three, two, one… vote!',
    );
    expect(narrationText(FRAME_LINES.vote, deck, { awake: true })).toMatch(/^Time’s up/);
  });

  it('names only the evil sides in play when it warns of an epic battle', () => {
    const say = (roles: RoleId[]) =>
      narrationText(FRAME_LINES.epicBattle, deck, { awake: false, roles });
    expect(say(['werewolf', 'alien', 'oracle'])).toBe(
      'Werewolves and aliens tonight: prepare for an epic battle!',
    );
    expect(say(['vampire', 'werewolf'])).toBe(
      'Werewolves and vampires tonight: prepare for an epic battle!',
    );
    expect(say(['vampire', 'alien', 'werewolf'])).toBe(
      'Werewolves, vampires and aliens tonight: prepare for an epic battle!',
    );
    expect(say([])).toBe('Prepare for an epic battle!');
  });
});

describe('Marks through the night', () => {
  const nameOf = (id: string | null | undefined) =>
    ({ A: 'Ana', B: 'Ben', C: 'Hana', D: 'Dee', E: 'Eve' })[id ?? ''] ?? 'Someone';

  /** First bite: the Vampire, Traitor and Assassin Marks land on the same player in turn. */
  function firstBite() {
    const h = table({ players: ['vampire', 'instigator', 'villager', 'assassin', 'villager'] });
    h.toStep('vampires');
    h.night('A', { players: ['C'] });
    h.toStep('instigator');
    h.night('B', { players: ['C'] });
    h.toStep('assassin');
    h.night('D', { players: ['C'] });
    h.dawn();
    return h;
  }

  it('shows the Mark each new one replaced in the replay', () => {
    const h = firstBite();
    const timeline = h.state.round!.night!.timeline;
    const line = (stepId: string) =>
      describeEntry(
        timeline.find((t) => t.stepId === stepId && t.note.kind === 'marked')!,
        nameOf,
        deck,
      );
    expect(line('vampires')).toBe('Ana gave the Mark of the Vampire to Hana.');
    expect(line('instigator')).toBe(
      'Ben gave the Mark of the Traitor to Hana. (Hana had the Mark of the Vampire)',
    );
    expect(line('assassin')).toBe(
      'Dee gave the Mark of the Assassin to Hana. (Hana had the Mark of the Traitor)',
    );
  });

  it('lists each player’s Marks, oldest first, for the reveal', () => {
    const h = firstBite();
    const history = markHistory(h.state.round!.night!.timeline, h.state.round!.marks!);
    expect(history).toEqual({ C: ['clarity', 'vampire', 'traitor', 'assassin'] });
    expect(markHistory([], null)).toEqual({});
  });

  it('names the lovers’ step for what it is, not a card', () => {
    const entry = { step: 3, stepId: 'lovers', by: null, note: { kind: 'nobody' as const } };
    expect(describeEntry(entry, nameOf, deck)).toBe('Nobody held a Mark of Love.');
    expect(describeEntry({ ...entry, stepId: 'doppelganger-seer' }, nameOf, deck)).toMatch(
      /didn’t copy this card/,
    );
  });

  it('tells a vampire whose pick it was, a robber with no one to rob, and a feared player', () => {
    expect(
      describeNote(
        { kind: 'marked', mark: 'vampire', targets: ['C'], chosenBy: 'B' },
        nameOf,
        deck,
        undefined,
        'A',
      ),
    ).toBe('Ben chose for you all: you gave the Mark of the Vampire to Hana.');
    expect(
      describeNote({ kind: 'blocked', reason: 'no-target', role: 'robber' }, nameOf, deck),
    ).toMatch(/no one to rob/);
    expect(describeNote({ kind: 'feared', role: 'seer' }, nameOf, deck)).toBe(
      'You held the Mark of Fear, so you slept through your turn as the Seer.',
    );
  });
});

describe('the reveal’s team lines', () => {
  const result = (teams: VoteResult['teams'], winners: string[]) =>
    ({ teams, winners }) as unknown as VoteResult;

  it('never says a side wins when Disease left nobody on it a winner', () => {
    const [vampires] = teamLines(result([{ team: 'vampire', won: true, players: ['B'] }], []));
    expect(vampires).toMatchObject({ won: false, sideWon: true, exceptions: [] });
  });

  it('names a traitor who lost with a winning side, and one who won with a losing side', () => {
    const lines = teamLines(
      result(
        [
          { team: 'village', won: true, players: ['A', 'B', 'C'] },
          { team: 'werewolf', won: false, players: ['D', 'E'] },
        ],
        ['A', 'C', 'E'],
      ),
    );
    expect(lines[0]).toMatchObject({ won: true, exceptions: ['B'] });
    expect(lines[1]).toMatchObject({ won: false, exceptions: ['E'] });
  });
});
