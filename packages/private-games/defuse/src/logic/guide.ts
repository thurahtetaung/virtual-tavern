import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { type Manifest, PLAIN_NAMES, artOf, footerOf, namesOf } from './manifest.ts';
import { missionById, missionNumber, moduleCount } from './missions.ts';
import { type Kind, NEEDY, SOLVABLE } from './types.ts';
import type { DefuseView } from './view.ts';

export { type Manifest, footerOf } from './manifest.ts';

export interface GuideArt {
  /** A picture per module (its front-on render). */
  modules?: Partial<Record<Kind, string>>;
  tagline?: string;
}

const HARDCORE: GuideOption = { key: 'hardcore', label: 'Hardcore' };
const NEEDY_ON: GuideOption = { key: 'needy', label: 'Needy modules' };
const CLOCK: GuideOption = { key: 'experts-clock', label: 'Experts see the clock and strikes' };
const TABLE_BOMB: GuideOption = { key: 'table-bomb', label: 'Table screen shows the bomb' };
const SURPRISES: GuideOption = { key: 'surprises', label: 'Room surprises' };
const MISSION: GuideOption = { key: 'mission', label: 'A bomb binder mission' };
const MANUAL: GuideOption = { key: 'different-manual', label: 'A different manual' };
const HELPERS: GuideOption = { key: 'helpers', label: 'Expert helpers' };

/** What each module looks like and how you work it (never what the manual says to do). */
const LOOKS: Record<Kind, string> = {
  wires: 'Three to six coloured wires. Tap a wire to cut it. One of them is the right one.',
  button:
    'One big coloured button with a word on it. Tap to press and let go, or hold it: a coloured strip lights up beside it while you hold.',
  keypad:
    'Four keys, each with a strange symbol. Press them in the right order; a key that stays down was right.',
  simon:
    'Four coloured pads that flash a sequence. Press pads to answer it; each round the sequence grows by one flash.',
  'whos-on-first':
    'A display with a word and six word buttons. Three stages; the buttons change after each press.',
  memory:
    'A display with a number and four numbered buttons. Five stages, and what you pressed before matters.',
  morse:
    'A light that blinks a word in dots and dashes, a frequency dial with arrows, and a send button.',
  'complicated-wires':
    'Up to six wires, some striped, each with a light above and maybe a star below. Cut every wire that should be cut.',
  'wire-sequence':
    'Four panels of numbered wires running to A, B or C. Cut what should be cut, then go down to the next panel.',
  maze: 'A six by six grid with a white light, a red triangle and two circle marks. Steer the light to the triangle through walls you can’t see.',
  password:
    'Five letter dials and a submit button. Turn the dials until they spell the one real word.',
  'venting-gas':
    'A small screen that asks a yes-or-no question, with a countdown. Answer before it reaches zero.',
  capacitor: 'A lever and a countdown. Hold the lever down to push the countdown back up.',
  knob: 'A knob, an UP label and twelve lights. When the countdown hits zero, the knob must point the right way.',
};

function base(art: GuideArt): GameGuide {
  const names = PLAIN_NAMES;
  const tile = (kind: Kind): GuideTile => {
    const needy = (NEEDY as readonly string[]).includes(kind);
    return {
      id: kind,
      name: names[kind],
      text: LOOKS[kind],
      meta: needy
        ? 'Needy module: it never needs solving, it keeps coming back'
        : 'Solve it to disarm it',
      group: needy ? 'Needy modules' : 'Modules',
      tone: needy ? 'evil' : 'neutral',
      icon: needy ? '⚠️' : '🧩',
      ...(needy && { option: NEEDY_ON }),
      ...(art.modules?.[kind] && { art: art.modules[kind] }),
    };
  };
  const tiles: GuideTile[] = [
    ...SOLVABLE.map(tile),
    ...NEEDY.map(tile),
    {
      id: 'edgework',
      name: 'The edges',
      text: 'Round the sides: a serial number, batteries, lit or unlit indicators with three-letter labels, and port plates. The manual often asks about them.',
      group: 'The bomb',
      tone: 'own',
      icon: '🔋',
    },
    {
      id: 'timer',
      name: 'Timer and strikes',
      text: 'The clock counts down; under a minute it shows seconds and hundredths. Each strike lights a lamp and makes the clock run faster.',
      group: 'The bomb',
      tone: 'own',
      icon: '⏱️',
    },
  ];
  return {
    tagline:
      art.tagline ?? 'One of you holds a ticking bomb, everyone else holds the manual. Talk fast.',
    players: '2 to 12 (one defuser, the rest experts)',
    duration: '5 minutes a bomb',
    goal: 'Defuse the bomb before the clock runs out. Only the defuser sees the bomb; only the experts see the manual. You win by talking.',
    quickStart: [
      'One player is the defuser: their phone shows the bomb and nothing else.',
      'Everyone else is an expert: their phones show the manual, never the bomb.',
      'The defuser describes what they see; the experts find the right page and say what to do.',
      'Every module disarmed and the bomb is defused. A mistake is a strike and the clock speeds up.',
      'Too many strikes or no time left, and the bomb goes off.',
      'Then the next player defuses the next bomb.',
    ],
    steps: [
      {
        title: 'Two kinds of screen',
        text: 'The defuser’s phone shows the bomb. Every other phone shows the manual. Never look at each other’s screens.',
        icon: '🙈',
      },
      {
        title: 'Describe',
        text: 'The defuser turns the bomb, opens a module and says what is there: colours, words, symbols, numbers.',
        icon: '🗣️',
      },
      {
        title: 'Read',
        text: 'Experts open that module’s page, ask questions and say exactly what to cut, press or turn. Claim a page so you don’t all read the same one.',
        icon: '📖',
      },
      {
        title: 'Strikes',
        text: 'A wrong move is a strike: a lamp lights, a buzz sounds and the clock runs faster. Three strikes and it goes off (one in Hardcore).',
        icon: '❌',
      },
      {
        title: 'Needy modules',
        text: 'Some modules never stay solved: they wake up with a countdown and need looking after until the bomb is done.',
        icon: '⚠️',
      },
      {
        title: 'Next bomb',
        text: 'Defused or not, the results show how it went, and someone else takes the bomb.',
        icon: '🔁',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'The host sets the bomb: time, number of modules, needy modules, Hardcore, kinds to leave out.',
      'The host picks how the defuser is chosen: the host picks then it rotates, at random, or by volunteers.',
      'Everyone else is an expert with the manual on their phone.',
      'Start: the lights come on, the modules wake, and the clock starts.',
    ],
    setupLevel: 'basics',
    sections: [
      {
        title: 'The defuser',
        level: 'basics',
        bullets: [
          'Sees the whole bomb: two faces with up to 11 modules and the timer, and four edges.',
          'The bomb is in 3D, full screen, on a desk in a dark room: pick it up, turn it in your hands to read the edges, and zoom in on a module to use it.',
          'Before the bomb, the next defuser sits at the desk with the Free Play briefcase: it shows the host’s settings (a host at the desk can change them on its keys and switches, as in the lobby), and its START button starts the bomb (the host can start it from the lobby too).',
          'Under a mission the desk holds the bomb binder instead, open at that mission’s page (its time, modules and strikes), and the page’s START starts it.',
          'Never sees the manual, and never shows the bomb to the experts.',
        ],
      },
      {
        title: 'Controls',
        level: 'basics',
        bullets: [
          'Phone: tap the bomb to pick it up; drag to turn it (it settles square when you let go) or use the ▴ ▾ ◂ ▸ arrows; pinch to zoom in on any side, the edges too (move both fingers to look around); tap a module to look closer, then tap its parts; drag outside the bomb on the desk to look around the room. The phone buzzes as you touch things (switch it off under ?).',
          'Phone: ‹, a two-finger tap or a tap off the bomb steps back (module, then bomb, then the desk).',
          'Computer: click to pick up, look closer and use parts (hold for the big button); right-drag or Ctrl+drag turns it; the wheel zooms toward the cursor; hold the button at the screen’s edge to look around the room; right-click or Esc steps back.',
          'Keyboard: arrows or WASD turn a quarter, F turns it over, Tab and Enter pick a module, 1–9 use its parts.',
          'The ? corner shows the controls and holds the sound volumes, the rules, lighter graphics for slow phones and the flat 2D view.',
          'Prefer the flat 2D bomb? Each player picks it for themselves in the lobby (“When you defuse”) or from the ? corner while defusing.',
        ],
      },
      {
        title: 'The experts',
        level: 'basics',
        bullets: [
          'See the manual: an index of module pages, search, and the edges appendix.',
          'Claim a page (“Kim: Wires”) so the work gets shared out; anyone can still open any page.',
          'Notes under each page are shared with the other experts, and cleared for each bomb.',
          'See nothing of the bomb: ask the defuser.',
        ],
      },
      {
        title: 'Strikes and the clock',
        level: 'basics',
        bullets: [
          'Every wrong move is a strike. After the first the clock runs at 1.25 ×, then 1.5 ×.',
          'The strike that reaches the limit sets the bomb off: the third, or the first in Hardcore.',
          'Strikes from needy modules count too.',
        ],
      },
      {
        title: 'Needy modules',
        level: 'details',
        option: NEEDY_ON,
        bullets: [
          'They wake after 90 seconds of bomb time, or (most of the time) when another module is solved or gets a strike.',
          'A countdown runs; deal with it before zero or it is a strike. Then it sleeps 10 to 40 seconds and wakes again.',
          'They never need solving: the bomb is defused once every other module is.',
        ],
      },
      {
        title: 'Hardcore',
        level: 'details',
        option: HARDCORE,
        bullets: ['One strike and the bomb goes off. There are no strike lamps.'],
      },
      {
        title: 'The lights',
        level: 'details',
        bullets: [
          'A bomb starts in the dark: the timer lights after 2 seconds, the modules wake and the room’s light clunks on 4 seconds later, and the clock starts 2 seconds after that.',
          'In the last minute the room’s red emergency light flashes.',
        ],
      },
      {
        title: 'Room surprises',
        level: 'details',
        option: SURPRISES,
        bullets: [
          'While the bomb is going well (modules solved, few strikes, time left), the room plays tricks, each at most once a bomb, checked every 20 to 60 seconds.',
          'Lights out: the lamp buzzes and goes dark for 10 seconds. Only the timer and the lights on the bomb glow; keep talking.',
          'The alarm clock on the desk rings for up to 20 seconds. Put the bomb down, pick up the clock and press its snooze button (pressing it while it is quiet sets it ringing).',
          'The host can switch them off in the lobby (“Room surprises”). The flat 2D view has no room.',
        ],
      },
      {
        title: 'The end',
        level: 'details',
        bullets: [
          'An explosion goes black on every screen, then the results page of the binder: EXPLODED, the time left and what set it off. A defused bomb stays in view a moment, then DEFUSED is stamped on the page.',
          'Back (or Continue) shows the bomb’s results; the host’s Retry starts the next bomb with the same settings.',
        ],
      },
      {
        title: 'Missions',
        level: 'details',
        option: MISSION,
        bullets: [
          'Instead of Free Play the host can pick any mission of the bomb binder, from the first bomb to the hardest ones; every mission is open from the start.',
          'A mission fixes its own bomb: the time, how many strikes it allows, which modules can turn up (some missions only use the front face), when its needy modules wake and whether the room plays its surprises.',
          'The results page names the mission. Free Play’s own settings come back when the host picks Free Play again.',
        ],
      },
      {
        title: 'A different manual',
        level: 'details',
        option: MANUAL,
        bullets: [
          'With this host option every module follows different rules: other wires to cut, other keypad columns, other mazes, other words and frequencies. The experts’ pages show the rules in play, so nobody can defuse from memory.',
          '“New manual each bomb” brings a new one with every bomb; “Same manual all night” keeps one until the host changes the option.',
          'The manual’s index says when it is a different manual. Pages whose rules never change (the password words, the needy gas and capacitor, the edges) keep the standard manual’s pictures.',
        ],
      },
      {
        title: 'Expert helpers',
        level: 'details',
        option: HELPERS,
        bullets: [
          'With this host option some pages get a helper under them, following whichever manual is in play.',
          'Maze tracer: tap a circle cell to find the maze, then the white light and the red triangle; it draws the way and says each step.',
          'Wire table lookup (Wires): set the wires from the top and the serial; it says which wire to cut.',
          'Wire lookup (Complicated Wires): mark what one wire has; it says what to do and which question to ask.',
        ],
      },
      {
        title: 'Experts see the clock',
        level: 'details',
        option: CLOCK,
        bullets: [
          'With this host option the experts’ screens show the clock and the strikes, nothing else.',
        ],
      },
      {
        title: 'The table screen',
        level: 'details',
        bullets: [
          'A paired table screen shows the manual for the experts by default.',
          'With “Table screen shows: Bomb” it shows the defuser’s bomb instead, as the defuser sees it (3D, turning as they turn it, or flat): then the experts must not look.',
        ],
      },
      {
        title: 'Choosing the defuser',
        level: 'details',
        bullets: [
          'Host picks, then rotate: the host picks the first defuser, then it goes round the table.',
          'Random each bomb: drawn at random when the bomb starts.',
          'Volunteer each bomb: anyone taps “I’ll defuse”; with several volunteers the host picks.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          'The bomb’s clock runs on the server and never pauses.',
          'If the defuser leaves, the clock runs on; the host can hand the bomb to any expert.',
          'A timed press (the big button, the lever, the knob) counts when it was made, up to half a second before it arrived.',
        ],
      },
      {
        title: 'Table rulings',
        level: 'edge',
        bullets: [
          'Everything works as in the original: cutting a second wire after a wires module is solved is still a strike, a capacitor that goes off never comes back, and the big button reads the hundredths under a minute.',
        ],
      },
    ],
    tiles: {
      label: 'Modules',
      blurb: 'The eleven modules, the three needy ones and the bomb itself',
      intro: 'What is on the bomb. The manual says what to do with each one.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Strikes',
        head: ['Strikes', 'Clock speed'],
        rows: [
          ['0', '1 ×'],
          ['1', '1.25 ×'],
          ['2', '1.5 ×'],
          ['3 (Hardcore: 1)', 'Boom'],
        ],
      },
      {
        title: 'The edges',
        head: ['Thing', 'What to say'],
        rows: [
          ['Serial number', 'Every character; is the last digit odd; is there a vowel'],
          ['Batteries', 'How many in all (AA holders hold two, D holders one)'],
          ['Indicators', 'Each label and whether its light is on'],
          ['Ports', 'Which ports there are (Parallel, Serial, DVI-D, PS/2, RJ-45, Stereo RCA)'],
        ],
      },
    ],
    tips: [
      'Defuser: say the edges first (serial, batteries, indicators, ports); experts write them in a note.',
      'Name a module before describing it so the right expert opens the page.',
      'Experts: ask yes-or-no questions; they are quicker than descriptions.',
      'Under a minute the clock shows hundredths: the big button counts those digits too.',
    ],
    glossary: [
      { term: 'Defuser', meaning: 'The one player who sees and touches the bomb.' },
      { term: 'Expert', meaning: 'Everyone else: they read the manual.' },
      {
        term: 'Module',
        meaning: 'One puzzle on the bomb; its light turns green when it is disarmed.',
      },
      { term: 'Strike', meaning: 'A mistake. It speeds up the clock; too many set the bomb off.' },
      {
        term: 'Edgework',
        meaning: 'The serial number, batteries, indicators and ports round the sides.',
      },
    ],
  };
}

const optionsOf = (s: DefuseView['settings']): string[] => [
  ...(s.hardcore ? [HARDCORE.key] : []),
  ...(s.needy ? [NEEDY_ON.key] : []),
  ...(s.expertsSeeClock ? [CLOCK.key] : []),
  ...(s.table === 'bomb' ? [TABLE_BOMB.key] : []),
  ...(s.surprises !== false ? [SURPRISES.key] : []),
  ...(s.mission ? [MISSION.key] : []),
  ...(s.manual && s.manual !== 'printed' ? [MANUAL.key] : []),
  ...(s.helpers ? [HELPERS.key] : []),
];

export function makeGuide(
  art: GuideArt = {},
  footer?: GuideFooter,
  names?: Record<Kind, string>,
): GameGuide {
  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as DefuseView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const defuser = v.seats.find((p) => p.id === v.defuser)?.name;
    const mission = missionById(s.mission);
    const manual =
      s.manual === 'each'
        ? ' A new manual each bomb.'
        : s.manual === 'night'
          ? ' A different manual all night.'
          : '';
    const summary = mission
      ? `Bomb binder mission ${missionNumber(mission)}: ${moduleCount(mission)} modules, ${Math.floor(mission.time / 60)}:${String(mission.time % 60).padStart(2, '0')} on the clock.${manual}`
      : `${s.modules} modules, ${Math.floor(s.time / 60)}:${String(s.time % 60).padStart(2, '0')} on the clock${s.hardcore ? ', Hardcore' : ''}${s.needy ? ', a needy module' : ''}.${manual}`;
    return {
      summary,
      options: optionsOf(s),
      ...(v.stage === 'bomb' && {
        you:
          v.defuser === you
            ? {
                name: 'Defuser',
                text: 'You hold the bomb. Describe it; never look at the manual.',
                icon: '💣',
              }
            : {
                name: 'Expert',
                text: `${defuser ?? 'The defuser'} holds the bomb. Read the manual to them.`,
                icon: '📖',
              },
        secret: true,
      }),
    };
  };
  const g = base(art);
  if (names && g.tiles)
    g.tiles.items = g.tiles.items.map((t) =>
      t.id in names ? { ...t, name: names[t.id as Kind] } : t,
    );
  return { ...g, ...(footer && { footer }), room };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/defuse/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's names, art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const art: GuideArt = {};
  const modules: Partial<Record<Kind, string>> = {};
  for (const k of [...SOLVABLE, ...NEEDY]) {
    const p = artOf(m?.modules?.[k]?.base);
    if (p) modules[k] = url(p);
  }
  if (Object.keys(modules).length) art.modules = modules;
  const tagline = typeof m?.guide?.tagline === 'string' ? m.guide.tagline.trim().slice(0, 200) : '';
  if (tagline) art.tagline = tagline;
  return makeGuide(art, footerOf(m), namesOf(m));
}
