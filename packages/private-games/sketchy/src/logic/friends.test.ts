import type { ContentProvider } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { HOST, PROMPTS, harness } from './test-utils.ts';

// Friend mode: a pack whose every prompt is about another player is a host switch, off at first.

const content: ContentProvider = {
  wordLists: () => [],
  words: () => [],
  contentPacks: (kind) =>
    kind === 'prompts'
      ? [
          { id: 'main', name: 'Prompts', data: PROMPTS },
          {
            id: 'friends',
            name: 'About the players',
            data: [
              'at work',
              'secret',
              'dream job',
              'last meal',
              'pet',
              'car',
              'hobby',
              'hat',
              'song',
            ].map((w) => ({ prompt: `{player}’s ${w}` })),
          },
        ]
      : [],
};

describe('friend mode', () => {
  it('lists a pack of prompts about the players as friend mode, off by default', () => {
    const h = harness(4, 7, content);
    expect(h.state.packs.find((p) => p.id === 'friends')).toMatchObject({ friends: true });
    expect(h.state.packs.find((p) => p.id === 'main')).toMatchObject({ friends: false });
    expect(h.state.settings.packIds).toEqual(['main']);
  });

  it('deals its prompts with another player’s name once the host switches it on', () => {
    const h = harness(4, 7, content);
    h.act(HOST, { type: 'update-settings', packIds: ['friends'] });
    h.act(HOST, { type: 'start' });
    const names = Object.values(h.state.seats).map((s) => s.name.toLowerCase());
    const prompts = Object.values(h.state.game!.sketches).map((s) => s.prompt.text);
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).not.toContain('{player}');
      expect(names.some((n) => p.includes(n))).toBe(true);
    }
  });
});
