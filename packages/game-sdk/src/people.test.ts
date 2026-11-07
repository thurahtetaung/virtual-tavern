import { describe, expect, it } from 'vitest';
import {
  anyOffline,
  hostLabel,
  listNames,
  lobbyStatus,
  namesWithPresence,
  playersNeeded,
  waitingFor,
  waitingForHost,
} from './people.ts';

const players = [
  { id: 'a', name: 'Ana', connected: true },
  { id: 'b', name: 'Ben', connected: false },
  { id: 'c', name: 'Cy', connected: true },
  { id: 'd', name: 'Dee', connected: true },
  { id: 'e', name: 'Eve', connected: true },
];

describe('listNames', () => {
  it('joins names in plain English', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ana'])).toBe('Ana');
    expect(listNames(['Ana', 'Ben'])).toBe('Ana and Ben');
    expect(listNames(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy');
  });
});

describe('waitingFor', () => {
  it('names who is left and marks anyone offline', () => {
    expect(waitingFor(['a', 'b'], players)).toBe('Waiting for: Ana and Ben (offline)');
  });

  it('is empty when nobody is left', () => {
    expect(waitingFor([], players)).toBe('');
  });

  it('calls the viewer "you", last', () => {
    expect(waitingFor(['a', 'c', 'b'], players, { you: 'a' })).toBe(
      'Waiting for: Cy, Ben (offline) and you',
    );
  });

  it('skips players who have left the room', () => {
    expect(namesWithPresence(['a', 'gone'], players)).toBe('Ana');
  });

  it('shortens long lists', () => {
    expect(namesWithPresence(['a', 'b', 'c', 'd', 'e'], players)).toBe(
      'Ana, Ben (offline), Cy and 2 more',
    );
    expect(namesWithPresence(['a', 'c', 'd', 'e'], players)).toBe('Ana, Cy, Dee and Eve');
  });
});

describe('host helpers', () => {
  it('names the host', () => {
    expect(waitingForHost({ hostId: 'a', players })).toBe('Waiting for Ana (host) to start…');
    expect(waitingForHost({ hostId: 'b', players }, 'deal')).toBe(
      'Waiting for Ben (host, offline) to deal…',
    );
    expect(hostLabel({ hostId: 'x', players })).toBe('the host');
    expect(hostLabel({ hostId: 'b', players })).toBe('Ben (offline)');
  });

  it('spots offline players', () => {
    expect(anyOffline(['a', 'c'], players)).toBe(false);
    expect(anyOffline(['a', 'b'], players)).toBe(true);
  });
});

describe('lobbyStatus', () => {
  const need = playersNeeded(3, 2);
  it('gives the host who can start the action look', () => {
    expect(lobbyStatus({ isHost: true, hostId: 'a', players }, null)).toEqual({
      text: 'Start when ready.',
      me: true,
    });
  });
  it('says nothing to a host who cannot start yet: the reason sits under Start game', () => {
    expect(lobbyStatus({ isHost: true, hostId: 'a', players }, need)).toBeNull();
  });
  it('tells a guest what is missing, else who starts', () => {
    expect(need).toBe('3 players are needed (2 seated).');
    expect(lobbyStatus({ isHost: false, hostId: 'a', players }, need)).toEqual({
      text: need,
      me: false,
    });
    expect(lobbyStatus({ isHost: false, hostId: 'a', players }, null)).toEqual({
      text: 'Waiting for Ana (host) to start…',
      me: false,
    });
  });
});
