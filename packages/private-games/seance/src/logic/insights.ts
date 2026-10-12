import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { PILLARS, cardKey } from './cards.ts';
import type { Game, PsychicColor, SeanceAction, SeanceState } from './types.ts';

/**
 * Stats only. Nothing secret is reported while it is still secret: visions, ravens and verdicts
 * are public the moment they happen, and the targets, the culprit and the votes are only
 * reported once the game is over.
 * - `vision` (by the ghost): to whom, for which pillar, how many cards, the hour;
 * - `raven` (by the ghost): the hour;
 * - `guess` (by a psychic, at each verdict): pillar, right or wrong, the hour, the cards they
 *   held, how many hours this pillar took so far (`tries`), and the card guessed (`card`, an id
 *   such as `suspect-12`, which the browser names from the private manifest);
 * - `clairvoyance` (by the psychic who played it): ✓ or ✗, on whom, and whether it scored;
 * - `finish` (by a psychic): the hour they found their last card;
 * - `vote` (at the end, by each psychic): the group, whether it was the culprit's, the stage;
 * - `outcome`: win or loss and how, the hour, players and difficulty, the ghost, ravens,
 *   visions sent, and the final vote.
 */
export function insights(
  before: SeanceState,
  after: SeanceState,
  _action: SeanceAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const was = before.game && before.game.startedAt === g.startedAt ? before.game : null;
  const idOf = (c: PsychicColor) => g.psychics.find((p) => p.color === c)?.id ?? null;
  const events: InsightEvent[] = [];
  for (const s of g.sends.slice(was?.sends.length ?? 0)) {
    events.push({
      type: 'vision',
      playerId: g.ghost,
      props: {
        to: idOf(s.to),
        pillar: PILLARS[s.step] ?? null,
        cards: s.cards.length,
        hour: s.hour,
      },
    });
  }
  if (g.ravensUsed > (was?.ravensUsed ?? 0))
    events.push({ type: 'raven', playerId: g.ghost, props: { hour: g.hour } });
  const earlier = g.verdicts.slice(0, was?.verdicts.length ?? 0);
  for (const v of g.verdicts.slice(was?.verdicts.length ?? 0)) {
    const pillar = PILLARS[v.step]!;
    const tries = earlier.filter((x) => x.color === v.color && x.step === v.step).length + 1;
    const held = g.sends
      .filter((s) => s.to === v.color && s.step === v.step && s.hour <= v.hour)
      .reduce((n, s) => n + s.cards.length, 0);
    events.push({
      type: 'guess',
      playerId: idOf(v.color),
      props: {
        pillar,
        correct: v.correct,
        hour: v.hour,
        tries,
        visions: held,
        card: v.guess === null ? null : cardKey(pillar, v.guess),
      },
    });
    for (const m of v.marks) {
      events.push({
        type: 'clairvoyance',
        playerId: idOf(m.by),
        props: { target: idOf(v.color), kind: m.kind, hit: (m.kind === 'yes') === v.correct },
      });
    }
  }
  for (const p of g.psychics) {
    const old = was?.psychics.find((x) => x.color === p.color);
    if (p.finishedHour !== null && old && old.finishedHour === null)
      events.push({
        type: 'finish',
        playerId: p.id,
        props: { hour: p.finishedHour, level: p.level },
      });
  }
  if (before.phase !== 'over' && after.phase === 'over' && g.result) {
    const f = g.final;
    if (f) {
      for (const p of g.psychics) {
        const v = f.votes[p.color];
        if (v === undefined) continue;
        events.push({
          type: 'vote',
          playerId: p.id,
          props: { group: v, right: v !== null && v === f.culprit, level: p.level },
        });
      }
    }
    events.push(outcome(g, after));
  }
  return events;
}

function outcome(g: Game, state: SeanceState): InsightEvent {
  const r = g.result!;
  const f = g.final;
  const culpritColor = f && f.culprit !== null ? f.groups[f.culprit] : null;
  const votesForCulprit =
    f && f.culprit !== null ? Object.values(f.votes).filter((v) => v === f.culprit).length : 0;
  return {
    type: 'outcome',
    winners: r.winners,
    props: {
      win: r.win,
      how: r.how,
      hour: g.hour,
      players: g.psychics.length + 1,
      psychics: g.psychics.length,
      difficulty: g.difficulty,
      ghost: g.ghost,
      ghosts: [...g.formerGhosts, ...(g.ghost ? [g.ghost] : [])],
      ravens: g.ravensUsed,
      visions: g.sends.reduce((n, s) => n + s.cards.length, 0),
      wrong: g.verdicts.filter((v) => !v.correct).length,
      finished: g.psychics.filter((p) => p.step >= 3).length,
      culprit: culpritColor ? (g.psychics.find((p) => p.color === culpritColor)?.id ?? null) : null,
      votesForCulprit,
      tieBroken: r.tieBreaker !== null,
      topLevel: Math.max(0, ...g.psychics.map((p) => p.level)),
      timer: state.settings.timerSeconds ?? 0,
    },
  };
}
