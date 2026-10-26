import {
  type Moment,
  type Profile,
  type RevealAnswer,
  type RevealInput,
  type Step,
  revealMoments,
  variantOf,
} from '@vt/game-sdk/show';
import { liePoints } from '../logic/game.ts';
import { revealOrder } from '../logic/reveal.ts';
import {
  REVEAL_FLIP_MS,
  REVEAL_STEP_MS,
  type SketchyView,
  TRUTH_POINTS,
  type TurnView,
} from '../logic/types.ts';
import { voiceClip } from './audio.ts';

// Sketchy's show as data: every beat the table screen and the phones play, built purely from the
// view on the server clock (or, for things the view doesn't time, such as a drawing being sent,
// from when this device first saw them: `ShowCtx.seen`). Sounds are steps too (`audio.ts` says
// which device plays which). Targets the table screen (`Stage.tsx`) and the phone
// (`PhoneShow.tsx`) register:
//   tile:<id>/<part>, qmark:<id>/<part> · count/<part> · banner · worm:<id>, fill:<id> · arm
//   clock · drawing · pencil:<k> · choice:<i> · tick:<k> · card…, chip:<k>…, author… (the reveal)
//   artist/<part>, artist.name, artist.title, artist.points · streak · board · score:<id>/<part>
//   thumb:<i>, like:<i> · likes, likes.name, crown, cup:<id>, cup:<id>/arm · final, final:<id>
//   winners · fireworks · streak:<id> · subtitle (a phone's personal line)
// Moments only move things and set words; what lasts the views render.

const STAGE: Profile[] = ['stage'];
const FULL: Profile[] = ['stage', 'phone-full'];
const PHONES: Profile[] = ['phone-quiet', 'phone-full'];

/** Where the second drawing-time beat starts after the first round's 3-2-1. */
const COUNT_MS = 2700;

export interface ShowCtx {
  you: string | null;
  profile: Profile;
  /** When this device first saw each `seenKeys` key, on the server clock (0: long before). */
  seen: Readonly<Record<string, number>>;
  /** The rig's reveal parts (`revealParts(rig.tracks)`); empty without a rig. */
  parts: RevealInput['parts'];
  /** The rig's mid-track art swaps (pencils, thumbs, the 3-2-1 digits, the crown). */
  swaps?: Record<string, Record<string, [number, string][]>>;
  /** The joke for a prompt (its file and length), when the voice has one. */
  jokeFor?: (prompt: string) => { file: string; ms: number } | null;
}

const anim = (t: number, target: string, track: `${string}.${string}`, more: Partial<Step> = {}) =>
  ({ t, kind: 'anim', target, track, ...more }) as Step;
const text = (t: number, target: string, words: string, more: Partial<Step> = {}) =>
  ({ t, kind: 'text', target, text: words, ...more }) as Step;
const sfx = (t: number, clip: string, more: Partial<Step> = {}) =>
  ({ t, kind: 'sfx', clip, ...more }) as Step;
const pop = (t: number, target: string, on: Profile[] = FULL, ms = 300): Step => ({
  t,
  kind: 'css',
  target,
  keyframes: [
    { transform: 'scale(0)', opacity: 0 },
    { transform: 'scale(1.12)', opacity: 1, offset: 0.7 },
    { transform: 'scale(1)', opacity: 1 },
  ],
  ms,
  easing: 'ease-out',
  on,
});
/** A row popping up that is already shown: the swell without the fade (the original's 367 ms). */
const grow = (t: number, target: string): Step => ({
  t,
  kind: 'css',
  target,
  keyframes: [
    { transform: 'scale(0.6)' },
    { transform: 'scale(1.12)', offset: 0.7 },
    { transform: 'scale(1)' },
  ],
  ms: 367,
  easing: 'ease-out',
  on: STAGE,
});
/** A quick swell, as a streak bumps a balloon (the original's StreakBump). */
const bump = (t: number, target: string): Step => ({
  t,
  kind: 'css',
  target,
  keyframes: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
  ms: 567,
  on: STAGE,
});
const show = (
  t: number,
  target: string,
  opacity: number,
  on: Profile[] = FULL,
  ms = 250,
): Step => ({
  t,
  kind: 'css',
  target,
  keyframes: [{ opacity }],
  ms,
  on,
});

/** A part's art swaps for a label, as `set` steps the page's `SwapArt` follows. */
function swapSteps(
  ctx: ShowCtx,
  part: string,
  label: string,
  t: number,
  target: string,
  on: Profile[] = STAGE,
): Step[] {
  return (ctx.swaps?.[part]?.[label] ?? []).map(([ms, key]) => ({
    t: t + ms,
    kind: 'set',
    target,
    attr: 'data-show',
    value: key,
    on,
  }));
}

/** A player's slot for their own yelp and sting (by seat, the original's eight). */
export function slotOf(view: SketchyView, id: string): number {
  const i = view.seats.findIndex((s) => s.id === id);
  return (i < 0 ? 0 : i) % 8;
}

const turnKey = (view: SketchyView) => `${view.game?.round}:${view.game?.turn?.number}`;

/**
 * The keys whose first sight on this device times a moment (the view has no time for them): who
 * sat down, who sent a drawing, each lie and vote coming in, likes, the end. Keys already there
 * when the device arrived count as long past.
 */
export function seenKeys(view: SketchyView): string[] {
  const g = view.game;
  if (view.phase === 'lobby') return view.seats.filter((s) => s.playing).map((s) => `join:${s.id}`);
  // One key for the whole end: a later snapshot of it must not restart its beats.
  if (view.phase === 'over') return ['over'];
  if (!g) return [];
  const keys: string[] = [];
  if (g.stage === 'draw') for (const id of g.drawn) keys.push(`drawn:${g.round}:${id}`);
  const t = g.turn;
  if (t && (g.stage === 'write' || g.stage === 'vote')) {
    for (let k = 0; k < t.done; k++) keys.push(`${g.stage}:${turnKey(view)}:${k}`);
    if (t.myLie !== null) keys.push(`mylie:${turnKey(view)}`);
  }
  if (t && g.stage === 'reveal')
    for (const o of t.options)
      if (o.likes) keys.push(`like:${turnKey(view)}:${o.index}:${o.likes}`);
  return keys;
}

const at = (ctx: ShowCtx, key: string) => ctx.seen[key] ?? 0;

// ---- 1 the lobby ----

function lobby(view: SketchyView, ctx: ShowCtx): Moment[] {
  return view.seats
    .filter((s) => s.playing)
    .map((s) => ({
      id: `join:${s.id}`,
      at: at(ctx, `join:${s.id}`),
      steps: [
        // As the original's lobby: a question mark on the seat, then it turns to the player.
        anim(0, `tile:${s.id}/tile-playerName`, 'tile-playerName.AppearQuestionMark', {
          on: STAGE,
        }),
        {
          t: 0,
          kind: 'css',
          target: `tilePic:${s.id}`,
          keyframes: [{ opacity: 0 }],
          ms: 1,
          on: STAGE,
        },
        anim(0, `qmark:${s.id}/qmark-ring`, 'qmark-ring.Appear', { on: STAGE }),
        anim(0, `qmark:${s.id}/qmark-qMark`, 'qmark-qMark.Appear', { on: STAGE }),
        sfx(0, 'lobby.qmark'),
        anim(600, `tile:${s.id}/tile-playerName`, 'tile-playerName.TransitionToPicture', {
          on: STAGE,
        }),
        anim(600, `qmark:${s.id}/qmark-qMark`, 'qmark-qMark.Disappear', { on: STAGE }),
        anim(600, `qmark:${s.id}/qmark-ring`, 'qmark-ring.Disappear', { on: STAGE }),
        pop(600, `tilePic:${s.id}`, STAGE, 467),
        sfx(600, 'lobby.player'),
      ],
    }));
}

// ---- 2, 3 drawing time and each drawing sent ----
//
// The original (its Main flowchart and `GameplayActionPackage`): "It's drawing time!" with its
// sting, the round's line (prompts sent / drawing again / the last batch), then each player's
// pencil inches across its row for the whole drawing time, drawing a line in their colour: that is
// the clock (no numbers). A drawing sent: the pencil breaks, then that player's own yelp, and their
// picture takes the pencil's place. The "30 second warning" comes 35 s before the end.

/** How long before the end of drawing time the hurry-up line comes (the original's 35 s). */
const DRAW_HURRY_MS = 35_000;
/** Writing and picking: the hurry-up line this long before the end (the original's 10 s). */
const HURRY_MS = 10_000;
/** The timer's numbers go 5 s apart, each with its sting as it goes (the original's row). */
export const TIMER_STEP_S = 5;

function drawing(view: SketchyView, ctx: ShowCtx): Moment[] {
  const g = view.game!;
  const first = g.round === 1;
  const b = first ? COUNT_MS : 0;
  const line = first ? 'draw.start' : g.round >= g.rounds ? 'draw.last' : 'draw.again';
  const pick = variantOf(`draw:${g.since}`, 64);
  const steps: Step[] = [
    ...(first
      ? [
          ...['count-countdownBG', 'count-d3', 'count-device'].map((p) =>
            anim(0, `count/${p}`, `${p}.GameStartAppear`, { on: STAGE }),
          ),
          ...swapSteps(ctx, 'count-d3', 'GameStartAppear', 0, 'count/count-d3'),
          ...['count-countdownBG', 'count-d3', 'count-device'].map((p) =>
            anim(2633, `count/${p}`, `${p}.Disappear`, { on: STAGE }),
          ),
          sfx(0, `lobby.countdown#${pick}`),
          // As the original's start: everybody's in, the count of players, "Let's go!".
          sfx(0, 'lobby.allIn'),
          sfx(0, voiceClip(`intro.${Math.min(8, Math.max(3, g.players.length))}`, pick)),
          sfx(0, voiceClip('start.go', pick)),
        ]
      : []),
    pop(b, 'banner'),
    show(b + 3200, 'banner', 0),
    sfx(b, 'draw.title'),
    sfx(b, voiceClip(line, pick)),
    ...(first ? [sfx(b, voiceClip('draw.luck', pick))] : []),
    ...g.players.flatMap((id, i) => [
      anim(b + 300 + i * 90, `pencilBox:${id}/pencilBox-container`, 'pencilBox-container.Appear', {
        on: STAGE,
      }),
      anim(b + 300 + i * 90, `pencilBox:${id}/pencilBox-dot`, 'pencilBox-dot.Appear', {
        on: STAGE,
      }),
    ]),
  ];
  const out: Moment[] = [{ id: `draw:${g.round}:${g.since}`, at: g.since, steps }];
  for (const id of g.drawn) {
    out.push({
      id: `drawn:${g.round}:${id}`,
      at: at(ctx, `drawn:${g.round}:${id}`),
      steps: [
        anim(0, `worm:${id}`, 'worm.Finished', { on: STAGE }),
        anim(0, `fill:${id}`, 'wormFill.Finished', { on: STAGE }),
        ...swapSteps(ctx, 'worm', 'Finished', 0, `worm:${id}`),
        ...swapSteps(ctx, 'wormFill', 'Finished', 0, `fill:${id}`),
        sfx(0, 'draw.break'),
        // The yelp follows the break, as the original chains them.
        sfx(150, `yelp#${slotOf(view, id)}`),
        anim(400, `pencilBox:${id}/pencilBox-container`, 'pencilBox-container.Disappear', {
          on: STAGE,
        }),
        anim(400, `pencilBox:${id}/pencilBox-dot`, 'pencilBox-dot.Disappear', { on: STAGE }),
        pop(400, `drawn:${id}`, STAGE, 367),
        sfx(0, 'me:sent', { for: id, on: PHONES }),
        { t: 0, kind: 'haptic', pattern: [20], for: id, on: PHONES },
      ],
    });
  }
  return out;
}

// ---- 4 the clock ----

/**
 * The clock's sounds, as the original's: drawing time has only its hurry-up line; writing and
 * picking have a row of numbers 5 s apart, each with its sting as it goes, the hurry-up line 10 s
 * before the end, and at the end the timer's own sound (or the buzzer when time ran out).
 */
function clock(view: SketchyView): Moment[] {
  const g = view.game!;
  if (g.deadline === null || g.stage === 'reveal') return [];
  const pick = variantOf(`clock:${g.since}`, 64);
  const beat = (left: number, steps: Step[]): Moment => ({
    id: `clock:${g.since}:${left}`,
    at: g.deadline! - left,
    steps,
  });
  if (g.stage === 'draw') return [beat(DRAW_HURRY_MS, [sfx(0, voiceClip('draw.hurry', pick))])];
  const total = Math.round((g.deadline - g.since) / 1000);
  const out: Moment[] = [];
  for (let s = TIMER_STEP_S; s <= Math.min(60, total - 1); s += TIMER_STEP_S)
    out.push(beat(s * 1000, [sfx(0, `timer.${s}`), pop(0, `tick:${s}`, STAGE, 250)]));
  out.push(
    beat(HURRY_MS, [sfx(0, voiceClip(g.stage === 'write' ? 'write.hurry' : 'vote.hurry', pick))]),
    beat(0, [sfx(0, 'timer.buzz'), anim(0, 'clock', 'timer.Disappear', { on: STAGE })]),
  );
  return out.filter((m) => m.at > g.since);
}

// ---- 5, 6 a drawing comes up, lies come in ----
//
// The original (its Shortie flowchart): after the drawings are in, the timer's "off" sound and
// "Your drawings are in" (or the scold when some are missing); each drawing then fades on under
// "What is it?" with its sound and the timer's numbers popping on; 1.75 s later the narrator asks
// for titles ("Use your devices…", or "Okay, the next drawing…" then "Enter your titles… now!").
// Each title in: a writer's pencil breaks (the original shows who; ours keeps writers hidden, so
// only the writer's own phone hears their yelp).

function writing(view: SketchyView, ctx: ShowCtx, t: TurnView): Moment[] {
  const g = view.game!;
  const key = turnKey(view);
  const pick = variantOf(`turn:${key}:${g.since}`, 64);
  const firstOfRound = t.number === 1;
  const missed = firstOfRound && t.of < g.players.length;
  const intro: Step[] = firstOfRound
    ? [
        sfx(0, 'timer.off'),
        sfx(
          0,
          voiceClip(
            t.of === 1 && g.players.length > 1
              ? 'turn.oneDrawing'
              : missed
                ? 'turn.missed'
                : 'turn.first',
            pick,
          ),
        ),
        sfx(300, 'draw.done'),
        sfx(500, 'draw.pencilsOff'),
      ]
    : [sfx(0, 'board.off')];
  const ask =
    g.round === 1 && firstOfRound
      ? [sfx(1750, voiceClip('write.prompt', pick))]
      : [sfx(1750, voiceClip('turn.next', pick)), sfx(1750, voiceClip('write.now', pick))];
  const out: Moment[] = [
    {
      id: `turn:${key}`,
      at: g.since,
      steps: [
        ...intro,
        sfx(0, 'turn.whatIsIt'),
        sfx(0, 'timer.numbers'),
        ...ask,
        anim(0, 'arm', 'arm.Appear', { on: STAGE }),
        ...Array.from({ length: t.writerCount }, (_, k) => [
          anim(900 + k * 90, `pencil:${k}`, 'worm.Appear', { on: STAGE }),
          anim(1240 + k * 90, `pencil:${k}`, 'worm.Draw', { on: STAGE }),
          ...swapSteps(ctx, 'worm', 'Draw', 1240 + k * 90, `pencil:${k}`),
        ]).flat(),
      ],
    },
  ];
  for (let k = 0; k < t.done; k++) {
    out.push({
      id: `write:${key}:${k}`,
      at: at(ctx, `write:${key}:${k}`),
      steps: [
        anim(0, `pencil:${k}`, 'worm.Break', { on: STAGE }),
        ...swapSteps(ctx, 'worm', 'Break', 0, `pencil:${k}`),
        sfx(0, 'write.break'),
      ],
    });
  }
  if (t.myLie !== null && ctx.you)
    out.push({
      id: `mylie:${key}`,
      at: at(ctx, `mylie:${key}`),
      steps: [
        sfx(0, 'me:break', { for: ctx.you, on: PHONES }),
        sfx(150, `me:yelp#${slotOf(view, ctx.you)}`, { for: ctx.you, on: PHONES }),
        { t: 0, kind: 'haptic', pattern: [15], for: ctx.you, on: PHONES },
      ],
    });
  return out;
}

// ---- 7, 8 the choices, votes coming in ----
//
// The original: the choices pop on with their sound and the timer, then "Here are your
// choices…"; picking runs to its music with the number stings and "Pick something!" 10 s from
// the end. When the picks are in, the music stops and "Let's see what people picked" leads into
// the reveal (ours starts at once: the line plays over the first answer's drumroll).

function voting(view: SketchyView, ctx: ShowCtx, t: TurnView): Moment[] {
  const g = view.game!;
  const key = turnKey(view);
  const pick = variantOf(`vote:${key}:${g.since}`, 64);
  const out: Moment[] = [
    {
      id: `vote:${key}`,
      at: g.since,
      steps: [
        sfx(0, 'timer.end'),
        sfx(0, 'vote.choices'),
        sfx(0, voiceClip('vote.choices', pick)),
        sfx(0, 'timer.numbers'),
        ...t.options.flatMap((o, i) => [
          pop(250 + i * 140, `choice:${o.index}`),
          sfx(250 + i * 140, `vote.balloon#${i}`),
        ]),
        anim(0, 'arm', 'arm.Appear', { on: STAGE }),
      ],
    },
  ];
  for (let k = 0; k < t.done; k++)
    out.push({
      id: `voted:${key}:${k}`,
      at: at(ctx, `vote:${key}:${k}`),
      steps: [pop(0, `voted:${k}`, STAGE, 250), sfx(0, 'vote.tick')],
    });
  return out;
}

// ---- 9, 10 the reveal and the truth; 11, 12 the board and likes ----

/** The board's answers with the points each gives (its authors for a lie, each finder for the truth). */
export function answersOf(t: TurnView): RevealAnswer[] {
  return t.options.map((o) => {
    const voters = o.voters ?? [];
    const authors = o.authors ?? [];
    const points: Record<string, number> = {};
    if (o.truth) for (const id of voters) points[id] = TRUTH_POINTS + (t.streakBonus?.[id] ?? 0);
    else if (!o.house)
      for (const id of authors) points[id] = liePoints(voters.length, authors.length);
    return {
      index: o.index,
      text: o.text,
      truth: !!o.truth,
      house: !!o.house,
      authors,
      voters,
      points,
    };
  });
}

/** When the one-by-one reveal ends on the server clock (null when it was skipped). */
export function revealEndOf(t: TurnView): number | null {
  return t.revealAt === null ? null : t.revealAt + revealOrder(t.options).length * REVEAL_STEP_MS;
}

/**
 * The scoreboard's beats after the truth (the original's: it comes on with the drawing sliding
 * aside, 1 s later the points pop on with the likes, 3 s later the streaks, then the reshuffle).
 */
export const BOARD = { points: 1000, streak: 4000, reshuffle: 4650 } as const;

function revealing(view: SketchyView, ctx: ShowCtx, t: TurnView): Moment[] {
  const g = view.game!;
  const key = turnKey(view);
  const out: Moment[] = [];
  const order = revealOrder(t.options);
  const truth = t.options.find((o) => o.truth);
  const found = truth?.voters ?? [];
  const pick = variantOf(`reveal:${key}`, 64);
  if (t.revealAt !== null) {
    const steps = revealMoments({
      key: `rv:${key}`,
      at: t.revealAt,
      order,
      answers: answersOf(t),
      stepMs: REVEAL_STEP_MS,
      flipMs: REVEAL_FLIP_MS,
      parts: ctx.parts,
      players: g.players.length,
      slotOf: (id) => slotOf(view, id),
      artist: t.artist,
    });
    steps[0]?.steps.push(sfx(0, voiceClip('reveal.picks', pick)));
    const last = steps.at(-1);
    if (last && t.artist) {
      // The truth's artist: their name and the real title, then their points.
      const f = REVEAL_FLIP_MS;
      const artistPoints = t.points?.[t.artist] ?? 0;
      last.steps.push(
        text(f, 'artist.name', `{p:${t.artist}}`, { on: FULL }),
        text(f, 'artist.title', t.prompt ?? '', { on: FULL }),
        text(
          f + 900,
          'artist.points',
          artistPoints > 0 ? `+${artistPoints.toLocaleString('en-US')}` : '',
          { on: FULL },
        ),
      );
      if (ctx.you && t.artist === ctx.you && found.length)
        last.steps.push(
          { t: f, kind: 'flash', colour: 'success', for: ctx.you, on: PHONES },
          {
            t: f,
            kind: 'subtitle',
            text: `${found.length} found your drawing! +${artistPoints.toLocaleString('en-US')}`,
            ms: 2600,
            for: ctx.you,
            on: PHONES,
          },
        );
    }
    out.push(...steps);
  }
  // After the truth: the joke about the prompt or a reaction, then the scoreboard's beats while
  // the board waits for the host's Next (the original moves on by itself 3 s after the reshuffle).
  const end = revealEndOf(t) ?? g.since;
  const voters = t.options.reduce((n, o) => n + (o.voters?.length ?? 0), 0);
  const lies = t.options.filter((o) => !o.truth && (o.voters?.length ?? 0) > 0);
  const sameWay = voters >= 2 && found.length === 0 && lies.length === 1 && !lies[0]!.house;
  const allHouse = voters >= 2 && lies.length === 1 && !!lies[0]!.house && found.length === 0;
  const joke = t.prompt && ctx.jokeFor ? ctx.jokeFor(t.prompt) : null;
  const line = joke ? null : sameWay ? 'reveal.sameWay' : allHouse ? 'reveal.allDecoy' : null;
  // The scoreboard waits for what is said (the original's flowchart waits for the clip's end).
  const said = joke ? joke.ms + 250 : line ? 2500 : 250;
  const b = said;
  const ids = view.scores.filter((s) => g.players.includes(s.id) || s.score > 0).map((s) => s.id);
  const streaks = found.filter((id) => (t.streakBonus?.[id] ?? 0) > 0);
  const flip = streaks.length ? BOARD.reshuffle + 640 : BOARD.streak;
  out.push({
    id: `board:${key}`,
    at: end,
    steps: [
      ...(joke ? [sfx(0, `joke:${joke.file}`)] : []),
      ...(line ? [sfx(0, voiceClip(line, pick))] : []),
      sfx(b, 'board.clear'),
      sfx(b, 'board.on'),
      sfx(b, 'board.slide'),
      // Each player's blue balloon pops on (the score bar under it waits), their points pop up
      // a second later, then the streaks, then the balloons flip round to the score bars.
      ...ids.flatMap((id, i) => [
        show(0, `score:${id}/bar`, 0, STAGE, 1),
        show(0, `score:${id}/pop`, 0, STAGE, 1),
        pop(b + i * 60, `score:${id}/balloon`, STAGE, 300),
      ]),
      sfx(b + BOARD.points, 'board.points'),
      ...ids.map((id) => pop(b + BOARD.points, `score:${id}/pop`, STAGE, 400)),
      ...(streaks.length
        ? [
            sfx(b + BOARD.streak, voiceClip('reveal.streak', pick)),
            sfx(b + BOARD.streak + 500, 'reveal.streak'),
            ...streaks.flatMap((id) => [
              pop(b + BOARD.streak, `streak:${id}`, FULL, 450),
              bump(b + BOARD.streak, `score:${id}/balloon`),
            ]),
          ]
        : []),
      sfx(b + flip, 'board.reshuffle'),
      sfx(b + flip, 'board.flip'),
      ...ids.flatMap((id) => [
        show(b + flip, `score:${id}/balloon`, 0, STAGE, 200),
        show(b + flip, `score:${id}/pop`, 0, STAGE, 200),
        pop(b + flip + 150, `score:${id}/bar`, STAGE, 433),
      ]),
    ],
  });
  for (const o of t.options) {
    if (!o.likes) continue;
    out.push({
      id: `like:${key}:${o.index}:${o.likes}`,
      at: at(ctx, `like:${key}:${o.index}:${o.likes}`),
      steps: [
        text(0, `thumb:${o.index}.n`, String(o.likes), { on: FULL }),
        anim(0, `thumb:${o.index}`, 'thumb.Up', { on: STAGE }),
        ...swapSteps(ctx, 'thumb', 'Up', 0, `thumb:${o.index}`),
        pop(0, `like:${o.index}`, PHONES, 250),
        sfx(0, 'likes.thumb'),
      ],
    });
  }
  return out;
}

// ---- 13, 14 the end ----
//
// The original (its EndGame flowchart and `GameplayActionPackage`): the final scores come on from
// last place to first, 500 ms apart from 1.75 s, each with that player's yelp, over the gliss and
// drumroll; 1.15 s after the last the winners spring up with the ta-da. Then the likes award: the
// cup comes on, every arm rises to its likes (100 px a second, each thumb sounding as it stops)
// while a drumroll plays, cut when the last arm stops; 0.5 s later the crown zips onto the most
// liked, with the crown sound 0.1 s later and the clapping 0.6 s later.

/** Who had the most likes over the game (ties all of them), or nobody. */
export function mostLiked(view: SketchyView): string[] {
  const best = Math.max(0, ...view.scores.map((s) => s.likes));
  return best > 0 ? view.scores.filter((s) => s.likes === best).map((s) => s.id) : [];
}

/** The end's beats on its own clock (ms from when the end began). */
export function endTimes(view: SketchyView) {
  const n = view.scores.length;
  const first = 1750;
  const each = 500;
  const winner = first + each * n + 1150;
  const likes = winner + 3000;
  const maxLikes = Math.max(1, ...view.scores.map((s) => s.likes));
  /** Each arm rises for its share of the cup's height (the original: 100 px a second). */
  const rise = (likes: number) => Math.round(600 + 3000 * (likes / maxLikes));
  const risen = likes + 1000 + rise(maxLikes);
  return { first, each, winner, likes, rise, risen, crown: risen + 500 };
}

function ending(view: SketchyView, ctx: ShowCtx): Moment[] {
  const key = seenKeys(view)[0]!;
  const liked = mostLiked(view);
  const top = Math.max(0, ...view.scores.map((s) => s.score));
  const winners = top > 0 ? view.scores.filter((s) => s.score === top).map((s) => s.id) : [];
  const T = endTimes(view);
  const lastFirst = [...view.scores].reverse();
  const steps: Step[] = [
    sfx(0, 'end.gliss', { ms: T.winner }),
    ...lastFirst.flatMap((s, i) => [
      // Scale only: the row's showing is the stage's own (from the end's clock), so a pop cut short
      // can never leave a score hidden.
      grow(T.first + i * T.each, `final:${s.id}`),
      sfx(T.first + i * T.each, `yelp#${slotOf(view, s.id)}`),
    ]),
    anim(T.winner, 'winners', 'winners.Appear', { on: FULL }),
    { t: T.winner, kind: 'confetti', n: 60, on: FULL },
    sfx(T.winner, 'end.tada'),
    ...winners.map((id): Step => ({
      t: T.winner,
      kind: 'haptic',
      pattern: [30, 60, 30, 60, 90],
      for: id,
      on: PHONES,
    })),
  ];
  if (liked.length) {
    steps.push(
      sfx(T.likes + 1000, 'likes.drumroll', { ms: T.risen - T.likes - 1000 }),
      ...view.scores.slice(0, 8).flatMap((s, k): Step[] => [
        {
          t: T.likes + 1000,
          kind: 'css',
          target: `cup:${s.id}`,
          keyframes: [{ transform: 'translateY(480px)' }, { transform: 'translateY(0)' }],
          ms: T.rise(s.likes),
          easing: 'linear',
          on: STAGE,
        },
        anim(
          T.likes + 1000 + T.rise(s.likes),
          `cup:${s.id}/arm`,
          k % 2 ? 'catThumb.Up' : 'thumb.Up',
          {
            on: STAGE,
          },
        ),
        sfx(T.likes + 1000 + T.rise(s.likes), 'likes.thumb'),
      ]),
      sfx(T.risen, 'likes.cutoff'),
      text(T.crown, 'likes.name', liked.map((id) => `{p:${id}}`).join(' & '), { on: FULL }),
      sfx(T.crown, 'likes.crownIn'),
      anim(T.crown, 'crown', 'crown.Appear', { on: FULL }),
      ...swapSteps(ctx, 'crown', 'Appear', T.crown, 'crown', FULL),
      anim(T.crown + 300, 'crown', 'crown.Glow', { on: FULL }),
      ...swapSteps(ctx, 'crown', 'Glow', T.crown + 300, 'crown', FULL),
      sfx(T.crown + 100, 'likes.crown'),
      sfx(T.crown + 600, 'likes.clap'),
      ...liked.map((id): Step => ({
        t: T.crown,
        kind: 'haptic',
        pattern: [20, 40, 20],
        for: id,
        on: PHONES,
      })),
    );
  }
  return [{ id: `end:${key}`, at: at(ctx, key), steps }];
}

/** The part of the game a device is in, for the manifest's file groups. */
export function phaseOf(view: SketchyView): 'lobby' | 'draw' | 'turn' | 'end' {
  if (view.phase === 'lobby' || !view.game) return 'lobby';
  if (view.phase === 'over') return 'end';
  return view.game.stage === 'draw' ? 'draw' : 'turn';
}

/**
 * Every moment the view calls for, oldest first. Moments are built for every profile; `schedule`
 * plays each step only where its `on` and `for` allow.
 */
export function moments(view: SketchyView, ctx: ShowCtx): Moment[] {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return lobby(view, ctx);
  if (view.phase === 'over') return ending(view, ctx);
  const out: Moment[] = [];
  if (g.stage === 'draw') out.push(...drawing(view, ctx));
  const t = g.turn;
  if (t && g.stage === 'write') out.push(...writing(view, ctx, t));
  if (t && g.stage === 'vote') out.push(...voting(view, ctx, t));
  if (t && g.stage === 'reveal') out.push(...revealing(view, ctx, t));
  out.push(...clock(view));
  return out;
}
