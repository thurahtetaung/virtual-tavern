import type { Moment, Profile, Step } from './show.ts';

// The shared reveal of write-a-lie, pick-the-truth games: every picked answer turns over one at a
// time on the server clock (the truth last), and each turn is the same beat, in the order the
// originals' own code runs it: the card shakes to a drumroll, slides into place (the drumroll is
// cut just after), each chooser's name slams on, the card flips to show whose lie it was (or the
// truth), the narrator grunts, the points rack up to the author or the finders, and a lie's card
// flies off. The originals give a step 6 to 7 s; here every beat is fitted inside `stepMs`, with
// the flip at `flipMs`. This turns a reveal into moments; the art (a rig's card, chooser and
// author parts) and the sound files stay each game's own.
//
// Targets, which the game's page registers (`RevealCard` and `Choosers` in `@vt/ui/show` do):
//   card/<part> · card.text · card.authors · chip:<k>/<part> · chip:<k>.name · chip:<k>.points
//   author/<part> · author.name · author.points · artist/<part> · board.now (a quiet phone's own
//   answer in the spotlight) · subtitle (a phone's personal line)
// Names are `{p:id}` placeholders the page fills. Sound steps play on every profile (the game's
// sound routing decides which device makes the room's sound) and name generic clips:
//   reveal.drumroll · reveal.slide · reveal.hit · reveal.balloon#<i> · reveal.truth ·
//   reveal.truthNobody · reveal.decoy · reveal.pencil · reveal.mood.bad|okay|great ·
//   reveal.woohoo · reveal.toPoints · reveal.move · reveal.tally · reveal.decoyOff ·
//   reveal.fly · sting#<i> (the author's or artist's own), voice:reveal.no / voice:reveal.yes
// and personal ones prefixed `me:`; a game maps them to its own files.

/** The original's labels the reveal plays. */
export const REVEAL_LABELS = {
  appear: 'Appear',
  hit: 'PlayerHit',
  anticipate: 'AnticipateReveal',
  stop: 'AnticipateStop',
  lie: 'RevealLie',
  truth: 'RevealTruth',
  lieOut: 'DisappearLie',
  decoy: 'Decoy',
  bank: 'Bank',
  points: 'TransitionToPoints',
  bump: 'MoneyBump',
  revealPoints: 'RevealPoints',
} as const;

/** One answer on the board, as the reveal needs it (all of it public by the reveal). */
export interface RevealAnswer {
  index: number;
  /** The answer's words, as on the board. */
  text: string;
  truth: boolean;
  /** A house answer (padding): nobody's lie. */
  house: boolean;
  authors: readonly string[];
  voters: readonly string[];
  /** Points this answer gives, by player: each author for a lie, each finder for the truth. */
  points: Readonly<Record<string, number>>;
}

export interface RevealInput {
  /** Names this reveal (a drawing, a question): moment ids are `<key>:step<i>`. */
  key: string;
  /** When the one-by-one reveal began, on the server clock. */
  at: number;
  /** Board indexes in reveal order (the truth last). */
  order: readonly number[];
  answers: readonly RevealAnswer[];
  stepMs: number;
  flipMs: number;
  /**
   * The rig's parts for each block (`card-bubble`, `chooser-playerName`…): steps are made only
   * for parts named here, so a game without a rig (or a part) gets only the words and sounds.
   */
  parts: {
    card: readonly string[];
    chooser: readonly string[];
    author: readonly string[];
    artist?: readonly string[];
  };
  /** Everyone in the round (the truth's mood is judged against it); default: voters + 1. */
  players?: number;
  /** Each player's own sound slot (their sting), when the game has them. */
  slotOf?: (id: string) => number;
  /** The truth's artist, whose sting plays with it. */
  artist?: string | null;
}

const FULL: Profile[] = ['stage', 'phone-full'];
const STAGE: Profile[] = ['stage'];
const PHONES: Profile[] = ['phone-quiet', 'phone-full'];
const QUIET: Profile[] = ['phone-quiet'];

/** At most this many chooser chips on a card (the original's row holds seven). */
export const MAX_CHIPS = 7;

/**
 * The beats inside a step, as the originals space them (in ms after the step starts, or after
 * the flip): the shake, the slide, the names, the grunt, the rack-up and the lie's exit. They are
 * squeezed to fit the step; their order is the original's.
 */
export const REVEAL_BEATS = {
  /** The card shakes to the drumroll (the original: 1.1 s), then slides into place. */
  slide: 550,
  /** The drumroll stops this long after the slide starts (the original's 0.15 s). */
  rollCut: 150,
  /** The first name slams on. */
  names: 650,
  /** Names slam on this far apart at most (the original: 500 ms). */
  nameGap: 500,
  /** The names are all on this long before the flip. */
  namesEnd: 150,
  /** After the flip: the author's or artist's sting (truth 300, lie 400 in the original). */
  stingTruth: 300,
  stingLie: 400,
  /** The truth's pencil and the table's mood (the original's 260 and 600 ms). */
  pencil: 260,
  mood: 600,
  /** The narrator's grunt (the original: 0.7 s after the flip). */
  grunt: 700,
  /** The points rack up (the original: half a second after the grunt). */
  rackUp: 900,
  /** Chips turn into points this far apart at most (the original: 250 ms). */
  chipGap: 250,
  /** A lie's card flies off this long before the step ends. */
  lieOut: 400,
} as const;

/**
 * How the table took the truth, as the original judges it: nobody found it, some did, or (with
 * more than three players) at least half of them.
 */
export function revealMood(found: number, players: number): 'bad' | 'okay' | 'great' {
  if (found === 0) return 'bad';
  return players > 3 && found >= Math.ceil(players / 2) ? 'great' : 'okay';
}

const p = (id: string) => `{p:${id}}`;
const list = (ids: readonly string[]) => ids.map(p).join(' & ');
const plus = (n: number) => `+${n.toLocaleString('en-US')}`;

/**
 * One moment per answer turned over. Every step is timed inside its own `stepMs`, so a step's
 * sounds never spill into the next: the drumroll stops at the slide, as the original cuts it.
 */
export function revealMoments(input: RevealInput): Moment[] {
  const { stepMs, flipMs, parts } = input;
  const B = REVEAL_BEATS;
  const byIndex = new Map(input.answers.map((a) => [a.index, a]));
  const voters = input.answers.reduce((n, a) => n + a.voters.length, 0);
  const players = input.players ?? voters + 1;
  const slot = (id: string | null | undefined) => (id && input.slotOf ? input.slotOf(id) : null);
  const anim = (target: string, part: string, t: number, label: string): Step => ({
    t,
    kind: 'anim',
    target: `${target}/${part}`,
    track: `${part}.${label}`,
    on: FULL,
  });
  const card = (t: number, label: string, on: Profile[] = FULL): Step[] =>
    parts.card.map((part) => ({ ...anim('card', part, t, label), on }));
  const block = (prefix: string, names: readonly string[], t: number, label: string): Step[] =>
    names.map((part) => anim(prefix, part, t, label));
  const text = (t: number, target: string, words: string, on: Profile[] = FULL): Step => ({
    t,
    kind: 'text',
    target,
    text: words,
    on,
  });
  /** A personal line on the player's own phone (its `subtitle`), gone after a moment. */
  const toast = (t: number, words: string, id: string): Step => ({
    t,
    kind: 'subtitle',
    text: words,
    ms: 2600,
    for: id,
    on: PHONES,
  });
  const sfx = (t: number, clip: string, more: Partial<Step> = {}): Step =>
    ({ t, kind: 'sfx', clip, ...more }) as Step;
  const out: Moment[] = [];
  input.order.forEach((index, i) => {
    const a = byIndex.get(index);
    if (!a) return;
    const at = input.at + i * stepMs;
    const choosers = a.voters.slice(0, MAX_CHIPS);
    const face = a.truth ? 'truth' : a.house ? 'house' : 'lie';
    const found = a.truth ? a.voters.length : 0;
    const steps: Step[] = [
      { t: 0, kind: 'set', target: 'card', attr: 'data-face', value: 'up' },
      { t: 0, kind: 'set', target: 'card', attr: 'data-answer', value: String(index) },
      text(0, 'card.text', a.text),
      text(0, 'card.authors', ''),
      text(0, 'author.name', ''),
      text(0, 'author.points', ''),
      ...Array.from({ length: MAX_CHIPS }, (_, k): Step[] => [
        text(0, `chip:${k}.name`, choosers[k] ? p(choosers[k]) : ''),
        text(0, `chip:${k}.points`, ''),
        {
          t: 0,
          kind: 'set',
          target: `chip:${k}`,
          attr: 'data-player',
          value: choosers[k] ?? '',
          on: FULL,
        },
      ]).flat(),
      // 1. The card comes up and shakes to the drumroll, then slides into place.
      ...card(0, REVEAL_LABELS.appear),
      ...card(0, REVEAL_LABELS.anticipate),
      sfx(0, 'reveal.drumroll', { ms: B.slide + B.rollCut }),
      ...card(B.slide, REVEAL_LABELS.stop),
      sfx(B.slide, 'reveal.slide'),
    ];
    // 2. Each chooser's name slams on, one after another, before the flip.
    const room = flipMs - B.namesEnd - B.names;
    const gap = choosers.length > 1 ? Math.min(B.nameGap, room / (choosers.length - 1)) : 0;
    choosers.forEach((_, k) => {
      const t = Math.round(B.names + k * gap);
      steps.push(
        ...block(`chip:${k}`, parts.chooser, t, REVEAL_LABELS.appear),
        sfx(t, 'reveal.hit'),
        // The card jolts with each name on the table screen (a phone keeps to the names).
        ...card(t, REVEAL_LABELS.hit, STAGE),
      );
    });
    // 3. The flip.
    const f = flipMs;
    const balloon = a.truth
      ? found
        ? 'reveal.truth'
        : 'reveal.truthNobody'
      : a.house
        ? 'reveal.decoy'
        : `reveal.balloon#${i}`;
    steps.push(
      { t: f, kind: 'set', target: 'card', attr: 'data-face', value: face },
      ...card(f, a.truth ? REVEAL_LABELS.truth : REVEAL_LABELS.lie),
      sfx(f, balloon),
      // A quiet phone's own list: the answer pulses as it turns.
      {
        t: f,
        kind: 'css',
        target: 'board.now',
        keyframes: [
          { transform: 'scale(1)' },
          { transform: 'scale(1.06)' },
          { transform: 'scale(1)' },
        ],
        ms: 400,
        on: QUIET,
      },
    );
    // 4. The grunt, then the points rack up.
    const rack = f + B.rackUp;
    const chipGap = choosers.length > 1 ? Math.min(B.chipGap, 400 / (choosers.length - 1)) : 0;
    if (a.truth) {
      const artistSlot = slot(input.artist);
      steps.push(
        sfx(f + B.pencil, 'reveal.pencil'),
        sfx(f + B.mood, `reveal.mood.${revealMood(found, players)}`),
        ...(artistSlot !== null ? [sfx(f + B.stingTruth, `sting#${artistSlot}`)] : []),
        ...block('artist', parts.artist ?? [], f, REVEAL_LABELS.appear),
        sfx(f + B.grunt, found ? 'reveal.woohoo' : `voice:reveal.yes#${i}`),
        ...block('artist', parts.artist ?? [], rack, REVEAL_LABELS.revealPoints),
      );
      // The finders' names turn into their points.
      choosers.forEach((id, k) => {
        const t = Math.round(rack + k * chipGap);
        steps.push(
          text(t, `chip:${k}.points`, plus(a.points[id] ?? 0)),
          ...block(`chip:${k}`, parts.chooser, t, REVEAL_LABELS.points),
          ...block(`chip:${k}`, parts.chooser, t + 400, REVEAL_LABELS.bump),
          sfx(t, 'reveal.toPoints'),
        );
      });
      if (choosers.length)
        steps.push(sfx(rack + 400, 'reveal.move'), sfx(rack + 600, 'reveal.tally'));
    } else {
      // Whose lie: the author's name; the choosers' chips are thrown away and the points go to
      // the author (a house answer's to nobody).
      steps.push(
        sfx(f + B.grunt, `voice:reveal.no#${i}`),
        text(f, 'card.authors', a.house ? '' : list(a.authors), [
          'stage',
          'phone-full',
          'phone-quiet',
        ]),
        ...choosers.flatMap((_, k) =>
          block(`chip:${k}`, parts.chooser, Math.round(rack + k * chipGap), REVEAL_LABELS.decoy),
        ),
      );
      if (!a.house) {
        const each = a.points[a.authors[0] ?? ''] ?? 0;
        const authorSlot = slot(a.authors[0]);
        steps.push(
          text(f, 'author.name', list(a.authors)),
          ...block('author', parts.author, f, REVEAL_LABELS.appear),
          ...(authorSlot !== null ? [sfx(f + B.stingLie, `sting#${authorSlot}`)] : []),
          text(rack, 'author.points', each > 0 ? plus(each) : ''),
          ...block('author', parts.author, rack, REVEAL_LABELS.bank),
          ...(each > 0 ? [sfx(rack, 'reveal.move'), sfx(rack + 300, 'reveal.tally')] : []),
        );
      } else {
        steps.push(sfx(rack, 'reveal.decoyOff'));
      }
      steps.push(
        ...card(stepMs - B.lieOut, REVEAL_LABELS.lieOut),
        sfx(stepMs - B.lieOut, 'reveal.fly'),
      );
    }
    // Personal cues: you fell for it, your lie fooled someone, you found the truth.
    for (const id of a.voters) {
      steps.push(
        { t: f, kind: 'flash', colour: a.truth ? 'success' : 'danger', for: id, on: PHONES },
        { t: f, kind: 'haptic', pattern: a.truth ? [20] : [40, 40, 40], for: id, on: PHONES },
        toast(f, a.truth ? `You found it! ${plus(a.points[id] ?? 0)}` : 'You fell for it!', id),
        ...(a.truth ? [sfx(f, 'me:found', { for: id, on: PHONES })] : []),
      );
    }
    if (!a.truth && !a.house && a.voters.length) {
      for (const id of a.authors) {
        const each = a.points[id] ?? 0;
        steps.push(
          { t: f, kind: 'flash', colour: 'success', for: id, on: PHONES },
          { t: f, kind: 'haptic', pattern: [15, 40, 15], for: id, on: PHONES },
          sfx(f, 'me:fooled', { for: id, on: PHONES }),
          toast(f, `You fooled ${a.voters.length}! ${each > 0 ? plus(each) : ''}`.trim(), id),
        );
      }
    }
    out.push({ id: `${input.key}:step${i}`, at, steps });
  });
  return out;
}

/**
 * The rig's parts of each reveal block (its tracks named `card-…`, `chooser-…`, `author-…`,
 * `artist-…`).
 */
export function revealParts(tracks: Readonly<Record<string, unknown>>): RevealInput['parts'] {
  const of = (block: string) =>
    Object.keys(tracks)
      .filter((k) => k.startsWith(block + '-'))
      .sort();
  return { card: of('card'), chooser: of('chooser'), author: of('author'), artist: of('artist') };
}
