import { describe, expect, it } from 'vitest';
import { FRAME_LINES, buildNightPlan, stepLines } from '../logic/plan.ts';
import { ARTIFACTS, ROLE_IDS, type RoleId } from '../logic/roles.ts';
import { table } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import { centreKinds, describeEntry, describeNote, narrationText } from './text.ts';

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
});
