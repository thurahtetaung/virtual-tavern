import { describe, expect, it } from 'vitest';
import { cliffhanger } from '../logic/definition.ts';
import {
  HOST,
  type Harness,
  keepAndPlace,
  pair,
  started,
  winFaceOff,
} from '../logic/test-utils.ts';
import { HURRY, LOUD, clockCues, eventCues, gainFor, soundModeOf } from './audio.ts';
import { momentAt } from './moments.ts';

const viewOf = (h: Harness, id: string | null = HOST) => cliffhanger.view(h.state, id);

describe('the clock', () => {
  it('ticks a face-off twice a second, four times in its last 5 s, the last three louder, then buzzes', () => {
    const h = started(4, { settings: { answerSeconds: 10 } });
    const [a] = pair(h);
    h.act(a, { type: 'said' });
    const v = viewOf(h);
    const end = v.round!.faceoff!.deadline!;
    const cues = clockCues(v, end - 10_000, end + 1);
    const ticks = cues.filter((c) => c.cue === 'tick');
    expect(ticks.filter((c) => c.at! < end - 5000)).toHaveLength(9);
    expect(ticks.filter((c) => c.at! >= end - 5000)).toHaveLength(20);
    expect(ticks.filter((c) => c.gain === LOUD).map((c) => end - c.at!)).toEqual([750, 500, 250]);
    expect(cues.filter((c) => c.cue === 'buzzer').map((c) => c.at)).toEqual([end]);
  });

  it('ticks a turn once a second, then steps through the three hurries, then buzzes', () => {
    const h = started();
    const [a] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const v = viewOf(h);
    const t = v.round!.turn!;
    const cues = clockCues(v, t.startedAt, t.endsAt + 1);
    const hurries = cues.filter((c) => c.cue.startsWith('hurry'));
    expect(hurries.map((c) => [c.cue, t.endsAt - c.at!, c.maxMs])).toEqual(
      HURRY.map((x) => [x.cue, x.from, x.from - x.to]),
    );
    expect(cues.filter((c) => c.cue === 'tick').every((c) => c.at! < t.endsAt - 10_000)).toBe(true);
    expect(cues.at(-1)).toMatchObject({ cue: 'buzzer', at: t.endsAt });
    // Split windows give the same cues, each once.
    const mid = t.startedAt + 12_345;
    const split = [...clockCues(v, t.startedAt, mid), ...clockCues(v, mid, t.endsAt + 1)];
    expect(split.map((c) => c.key)).toEqual(cues.map((c) => c.key));
  });

  it('sends a press sting per answer and a got sting per card, the describer’s own personal', () => {
    const h = started();
    const [a, b] = pair(h);
    h.act(a, { type: 'said' });
    h.act(b, { type: 'said' });
    expect(eventCues(viewOf(h)).filter((c) => c.cue === 'press')).toHaveLength(1);
    h.tick();
    keepAndPlace(h);
    const describer = h.state.round!.turn!.describer;
    const card = h.state.round!.board[h.state.round!.turn!.team]![0]!.card.id;
    h.act(describer, { type: 'got', card });
    const got = eventCues(viewOf(h, describer)).filter((c) => c.cue === 'got');
    expect(got).toEqual([expect.objectContaining({ key: `got:${card}`, personal: true })]);
  });
});

describe('where it plays', () => {
  const d = (
    mode: 'off' | 'host' | 'all' | 'stage',
    more: Partial<Parameters<typeof gainFor>[1]> = {},
  ) => ({
    mode,
    isHost: false,
    isStage: false,
    describing: false,
    ...more,
  });
  const tick = { key: 'k', cue: 'tick' as const, at: 0 };
  const got = { key: 'g', cue: 'got' as const, at: null, personal: true };

  it('plays the room’s cues on the host’s device, every device or the table screen', () => {
    expect(gainFor(tick, d('host', { isHost: true }))).toBe(1);
    expect(gainFor(tick, d('host'))).toBe(0);
    expect(gainFor(tick, d('all'))).toBe(1);
    expect(gainFor(tick, d('stage'))).toBe(0);
    expect(gainFor(tick, d('stage', { isStage: true }))).toBe(1);
    expect(gainFor(tick, d('off', { isHost: true }))).toBe(0);
  });

  it('keeps the describer’s clock quieter on a call and their own cues on their phone', () => {
    expect(gainFor(tick, d('all', { describing: true }))).toBe(0.5);
    expect(gainFor(got, d('host'))).toBe(0.5);
    expect(gainFor(got, d('stage'))).toBe(0);
  });

  it('follows the table until the host picks, and falls back from a missing table screen', () => {
    const s = { sound: 'host' as const, soundChosen: false, mode: 'room' as const };
    expect(soundModeOf(s, true)).toBe('stage');
    expect(soundModeOf(s, false)).toBe('host');
    expect(soundModeOf({ ...s, mode: 'video' }, false)).toBe('all');
    expect(soundModeOf({ ...s, sound: 'stage', soundChosen: true }, false)).toBe('host');
  });
});

describe('moments', () => {
  it('shows GO! as a turn starts and TIME’S UP when it runs out', () => {
    const h = started();
    const [a] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const t = viewOf(h).round!.turn!;
    expect(momentAt(viewOf(h), t.startedAt + 100)?.kind).toBe('go');
    expect(momentAt(viewOf(h), t.startedAt + 5000)).toBeNull();
    // The other side's placing clock may run out first.
    while (h.state.round?.stage === 'turn') h.tick();
    expect(momentAt(viewOf(h), t.endsAt + 100)?.kind).toBe('times-up');
  });
});
