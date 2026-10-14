import type { GameGuide, GuideContext, GuideOption, GuideTile, GuideTone } from '@vt/game-sdk';
import { EVENT_KINDS, EVENT_TILES, type EventKind } from './content.ts';
import { EVENT_NAMES, EVENT_TEXT } from './names.ts';
import { type InquestView, type RoleId, alliesOf, finalOf, presentationsOf } from './types.ts';

// The plain guide uses our own event names; `nameGuide` puts in the tile titles, card text and art
// from the private manifest, which is what the table sees when a tile is drawn.

export interface InquestNames {
  role?: (id: RoleId) => { name?: string; text?: string; art?: string } | undefined;
  /** An event tile's title, printed text and art. */
  event?: (kind: EventKind) => { name?: string; text?: string; art?: string } | undefined;
  /** The Location tile's title ("Location"). */
  location?: string;
  back?: string;
  art?: { causeOfDeath?: string };
}

const PRESENTATIONS: GuideOption = { key: 'presentations', label: 'Presentations' };
const FINAL: GuideOption = { key: 'final', label: 'Final accusations' };
const WITNESS: GuideOption = { key: 'witness', label: 'Witness' };
const EVENTS: GuideOption = { key: 'events', label: 'Events' };
const ALLIES: GuideOption = { key: 'allies', label: 'Allies expansion' };

const ROLE_ORDER: RoleId[] = [
  'forensic',
  'murderer',
  'accomplice',
  'witness',
  'investigator',
  'lab-technician',
  'inside-man',
  'protective-detail',
];
const TONES: Record<RoleId, GuideTone> = {
  forensic: 'good',
  investigator: 'good',
  witness: 'good',
  'lab-technician': 'good',
  'protective-detail': 'good',
  murderer: 'evil',
  accomplice: 'evil',
  'inside-man': 'evil',
};
const ALLIES_ROLES: RoleId[] = ['lab-technician', 'inside-man', 'protective-detail'];

export function makeGuide(names: InquestNames = {}): GameGuide {
  const event = (k: EventKind) => names.event?.(k)?.name ?? EVENT_NAMES[k];
  const location = names.location ?? 'Location';
  const swap = (s: string) =>
    EVENT_KINDS.reduce((t, k) => t.split(EVENT_NAMES[k]).join(event(k)), s).replace(
      /Location tile/g,
      `${location} tile`,
    );
  const roleArt = (r: RoleId) => names.role?.(r)?.art;
  const plain = base();
  const roleTiles: GuideTile[] = plain.roles!.map((r, i) => {
    const id = ROLE_ORDER[i]!;
    const art = roleArt(id);
    const allies = ALLIES_ROLES.includes(id);
    return {
      id,
      name: names.role?.(id)?.name ?? r.name,
      text: r.summary.replace(/^\([^)]*\) /, ''),
      tone: TONES[id],
      group: allies ? 'Allies roles' : 'Roles',
      icon: TONES[id] === 'evil' ? '🔪' : id === 'forensic' ? '🔬' : '🕵️',
      meta: [
        TONES[id] === 'evil' ? 'The Murderer’s side' : 'The Investigators’ side',
        /^\(([^)]*)\)/.exec(r.summary)?.[1],
      ]
        .filter(Boolean)
        .join(' · '),
      ...(art && { art }),
      ...(allies && { option: ALLIES }),
      ...((id === 'accomplice' || id === 'witness') && {
        option: id === 'witness' ? WITNESS : { key: 'accomplice', label: 'Accomplice' },
      }),
    };
  });
  const eventTiles: GuideTile[] = EVENT_KINDS.map((k) => {
    const e = names.event?.(k);
    return {
      id: `event-${k}`,
      name: event(k),
      text: e?.text ?? EVENT_TEXT[k],
      group: 'Events',
      icon: '⚡',
      meta: k === 'perfect-crime' ? 'Event tile · Allies expansion' : 'Event tile',
      option: k === 'perfect-crime' ? ALLIES : EVENTS,
      ...(e?.art && { art: e.art }),
    };
  });

  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as InquestView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const allies = alliesOf(s);
    const on = [
      ...(presentationsOf(s) ? [PRESENTATIONS.key] : []),
      ...(finalOf(s) ? [FINAL.key] : []),
      ...(s.witness ? [WITNESS.key] : []),
      ...(s.accomplice ? ['accomplice'] : []),
      ...(s.events ? [EVENTS.key] : []),
      ...(allies.on ? [ALLIES.key] : []),
    ];
    const roles: RoleId[] = [
      'forensic',
      'murderer',
      'investigator',
      ...(s.accomplice ? (['accomplice'] as const) : []),
      ...(s.witness ? (['witness'] as const) : []),
      ...(allies.labTech ? (['lab-technician'] as const) : []),
      ...(allies.insideMan ? (['inside-man'] as const) : []),
      ...(allies.protective ? (['protective-detail'] as const) : []),
    ];
    const inGame: Record<string, number> = Object.fromEntries(roles.map((r) => [r, 1]));
    if (s.events)
      for (const k of EVENT_KINDS) if (k !== 'perfect-crime' || allies.on) inGame[`event-${k}`] = 1;
    const ctx: GuideContext = {
      summary: [
        `${s.hand} + ${s.hand} cards`,
        s.events ? 'events on' : 'no events',
        presentationsOf(s) ? 'presentations' : 'no presentations',
        finalOf(s) ? 'final accusations' : 'printed ending',
        ...(allies.on ? ['Allies expansion'] : []),
      ].join(' · '),
      options: on,
      inGame,
    };
    const mine = v.game?.myRole;
    if (mine && v.me?.id === you) {
      const id: RoleId = mine === 'former-forensic' ? 'forensic' : mine;
      const tile = roleTiles.find((t) => t.id === id)!;
      const stage = v.game?.stage;
      const now =
        stage === 'night'
          ? '🌙 The night: the Murderer picks the crime'
          : stage === 'collect' || stage === 'discuss' || stage === 'present'
            ? `🔎 Round ${v.game?.round}`
            : stage === 'final'
              ? '⚖️ Final accusations'
              : stage === 'reversal'
                ? '🔄 The Reversal'
                : undefined;
      ctx.you = {
        name: mine === 'former-forensic' ? `${tile.name} (handed over)` : tile.name,
        text: tile.text,
        tile: id,
        ...(tile.art && { art: tile.art }),
        ...(now && { now }),
      };
      ctx.secret = true;
    }
    return ctx;
  };

  const levels: Record<string, Partial<GameGuide['sections'][number]>> = {
    'The night': { level: 'basics' },
    'Collecting evidence': { level: 'basics' },
    'Discussion (the heart of the game)': { level: 'basics' },
    Solving: { level: 'basics' },
    'Final accusations (table rule)': { level: 'details', option: FINAL },
    'The Reversal': { level: 'details', option: WITNESS },
    Events: { level: 'details', option: EVENTS },
    'Presentations (optional)': { level: 'edge', option: PRESENTATIONS },
    'Allies expansion': { level: 'edge', option: ALLIES },
  };
  const guide: GameGuide = {
    ...plain,
    sections: plain.sections.map((s) => {
      const named = {
        ...s,
        ...levels[s.title],
        ...(s.paragraphs && { paragraphs: s.paragraphs.map(swap) }),
        ...(s.bullets && { bullets: s.bullets.map(swap) }),
      };
      return s.title === 'Events'
        ? {
            ...named,
            bullets: EVENT_KINDS.filter((k) => k !== 'perfect-crime').map(
              (k) => `${event(k)}: ${names.event?.(k)?.text ?? EVENT_TEXT[k]}`,
            ),
          }
        : named;
    }),
    quickStart: plain.quickStart!.map(swap),
    steps: [
      {
        title: 'Cards on the table',
        text: plain.quickStart![0]!,
        icon: '🃏',
        ...(names.back && { art: names.back }),
      },
      {
        title: 'The crime',
        text: plain.quickStart![1]!,
        icon: '🔪',
        ...(roleArt('murderer') && { art: roleArt('murderer') }),
      },
      {
        title: 'Bullets on the scene',
        text: plain.quickStart![2]!,
        icon: '🎯',
        ...(names.art?.causeOfDeath && { art: names.art.causeOfDeath }),
      },
      { title: 'Discuss (the heart of it)', text: plain.quickStart![3]!, icon: '🗣️' },
      {
        title: 'One badge to solve',
        text: plain.quickStart![4]!,
        icon: '🏅',
        ...(roleArt('investigator') && { art: roleArt('investigator') }),
      },
      { title: 'Three rounds, then final accusations', text: plain.quickStart![5]!, icon: '⏳' },
    ],
    setup: plain.setup.slice(0, 3),
    tiles: {
      label: 'Roles & events',
      blurb: `${roleTiles.length} roles · ${eventTiles.length} events`,
      intro: 'Who’s who at the table, and the event tiles that can turn up in rounds 2 and 3.',
      items: [...roleTiles, ...eventTiles],
    },
    reference: [
      {
        title: 'A game at a glance',
        head: ['Stage', 'What happens'],
        rows: [
          ['Night', 'The Murderer picks Clue + Means (60 s)'],
          ['Round 1', `${location} + 6 bullets, then discuss`],
          ['Rounds 2–3', 'Events, a new tile + 1 bullet, discuss'],
          ['Final accusations', 'Everyone with a badge accuses once (table rule)'],
          ['Reversal', 'With a Witness: the culprits get one guess at who it is'],
        ],
      },
    ],
    presets: [
      {
        id: 'printed',
        label: 'Printed rules',
        context: {
          summary: 'Presentations on, no final accusations: the game ends after round 3.',
          options: [PRESENTATIONS.key, WITNESS.key, 'accomplice', EVENTS.key],
          inGame: Object.fromEntries(
            [...ROLE_ORDER.slice(0, 5), ...EVENT_KINDS.slice(0, 6).map((k) => `event-${k}`)].map(
              (id) => [id, 1],
            ),
          ),
        },
      },
      {
        id: 'table',
        label: 'Our table (default)',
        context: {
          summary: 'No presentations; final accusations after round 3.',
          options: [FINAL.key, WITNESS.key, 'accomplice', EVENTS.key],
          inGame: Object.fromEntries(
            [...ROLE_ORDER.slice(0, 5), ...EVENT_KINDS.slice(0, 6).map((k) => `event-${k}`)].map(
              (id) => [id, 1],
            ),
          ),
        },
      },
      {
        id: 'allies',
        label: 'With the Allies expansion',
        context: {
          summary: 'Three more roles, one more event, more cards and tiles.',
          options: [FINAL.key, WITNESS.key, 'accomplice', EVENTS.key, ALLIES.key],
          inGame: Object.fromEntries(
            [...ROLE_ORDER, ...EVENT_KINDS.map((k) => `event-${k}`)].map((id) => [id, 1]),
          ),
        },
      },
    ],
    room,
  };
  return guide;
}

/** Inquest's own text, in our words. */
function base(): GameGuide {
  return {
    tagline:
      'A murder, a room full of suspects, and one expert who knows the answer but can only point.',
    players: '4 to 12',
    duration: '20–30 minutes',
    goal: 'The Investigators win by naming the Murderer’s exact Key Evidence (a Clue card) and Means of murder (a Means card). The Murderer, hiding among them, wins if nobody does by the end: after three rounds and, with our table rule on, one last round of final accusations.',
    quickStart: [
      'Everyone but the Forensic Scientist holds Clue and Means cards, face up for all to see. One of you is the secret Murderer.',
      'At night the Murderer picks one of their own Clue cards and one of their own Means cards: that pair is the crime.',
      'The Forensic Scientist knows the crime but may only hint with bullets on the scene tiles. Talk it over as they land: their order can be a clue.',
      'Then the heart of the game: the whole table discusses the evidence together, until the Forensic Scientist moves on to the next round.',
      'Think you know? Tap Solve and name another player’s Clue + Means. You get one attempt (your badge).',
      'Three rounds, each with a new tile and bullet. Then the final accusations: everyone with a badge left accuses, one by one. Nobody right: the Murderer wins.',
    ],
    setup: [
      'Everyone sits down (4 to 12 players). The host chooses how the Forensic Scientist is picked: the host picks, at random, at random among volunteers, or the host picks from the volunteers. Anyone can tap “I’ll be the Forensic Scientist” in the lobby.',
      'With 6 or more players the Accomplice and the Witness are in by default; the host can switch them off (the Witness needs the Accomplice).',
      'Everyone else gets 4 Clue and 4 Means cards (the host can make it 3 + 3 for an easier game or 5 + 5 for a harder one) and one badge, their one attempt to solve.',
      'The host also chooses how each round ends: Presentations (off by default) adds the printed rules’ turn-by-turn presentations after the discussion, and Final accusations (on by default) adds our table rule after the last round. For the printed rules, switch Presentations on and Final accusations off: the game then ends after round 3.',
    ],
    roles: [
      {
        name: 'Forensic Scientist',
        summary:
          'Not a secret: everyone knows who the Forensic Scientist is, and their card is shown face up. Knows the answer and guides the table only with bullets on the scene tiles: never with words, faces or gestures. Wins with the Investigators.',
      },
      {
        name: 'Murderer',
        summary:
          'Chooses the crime from their own cards, then blends in and steers the table elsewhere. Wins if the crime is never named.',
      },
      {
        name: 'Accomplice',
        summary:
          '(6+ players) Knows the Murderer and the crime, and helps them get away with it. Wins with the Murderer.',
      },
      {
        name: 'Witness',
        summary:
          '(6+ players) Knows the two culprits, but not which is which. Helps the Investigators without being spotted: if the crime is solved, the culprits get one guess at who the Witness is.',
      },
      {
        name: 'Investigator',
        summary: 'Reads the bullets, studies the suspects’ cards and names the exact pair.',
      },
      {
        name: 'Lab Technician',
        summary:
          '(Allies expansion, suggested from 7 players) In the Allies Phase, checks one card on the table and alone learns whether it is part of the crime. Wins with the Investigators.',
      },
      {
        name: 'Inside Man',
        summary:
          '(Allies expansion, suggested from 8 players) In the Allies Phase, takes one player’s badge (his own allowed). Knows nobody and nobody knows him, not even the Witness. Wins with the Murderer’s side and joins the Reversal.',
      },
      {
        name: 'Protective Detail',
        summary:
          '(Allies expansion, only with the Witness) Knows who the Witness is; the Witness doesn’t know them. Wins with the Investigators.',
      },
    ],
    sections: [
      {
        title: 'The night',
        paragraphs: [
          'The Murderer has 60 seconds to pick one of their own Clue cards (the Key Evidence) and one of their own Means cards. If time runs out, a pair is picked for them and they are told what it is. The Accomplice learns the crime too; the Witness learns who the two culprits are, in no particular order.',
        ],
      },
      {
        title: 'Collecting evidence',
        bullets: [
          'Round 1: the Forensic Scientist picks a Location tile. With the Cause of Death tile and 4 scene tiles, that makes 6 tiles, each listing 6 items.',
          'They place one bullet on each tile, one at a time, marking the item that best fits the crime. Bullets never move once placed.',
          'From the first bullet on, everyone but the Forensic Scientist talks freely, and the Forensic Scientist places the next bullets at their own pace, guided by what they hear. Everyone sees the order bullets land in: it can be a clue.',
          'Rounds 2 and 3: any events come first, then a new tile is drawn and replaces one of the scene tiles (never the Location or Cause of Death), and gets its own bullet.',
        ],
      },
      {
        title: 'Discussion (the heart of the game)',
        bullets: [
          'This is where cases are cracked: argue over what each bullet means, compare suspects’ cards, test theories out loud and watch who pushes which story. The Murderer is in the conversation too.',
          'Every round, once the last bullet is down, the table discusses the evidence. The round’s new bullets are highlighted.',
          'The host sets the discussion time in the lobby: 1, 2, 3 or 5 minutes (2 by default), or off. It is a reminder: nothing happens by itself at 0, the clock just turns red and nudges the Forensic Scientist.',
          'The Forensic Scientist moves on whenever the table is ready, early or late: Next round, Start final accusations after the last round, or Start presentations when they are on. If they are away, the host can press it.',
          'You can solve during the discussion.',
        ],
      },
      {
        title: 'Presentations (optional)',
        bullets: [
          'The printed rules have them; here they are off by default and the host can switch them on in the lobby.',
          'When on, players present in turn after each discussion, starting left of the Forensic Scientist: say which cards you suspect and why.',
          'Nobody interrupts a speaker, except to solve. Between presentations, talk as much as you like.',
          'The host picks the time per speaker and whether it is a reminder (the speaker taps Done, or the host skips) or strict (the turn passes by itself).',
          'For the printed rules, switch Presentations on and Final accusations off: the game then ends after round 3.',
        ],
      },
      {
        title: 'Solving',
        bullets: [
          'From the first bullet on, anyone but the Forensic Scientist can tap Solve: pick another player, then one of their Clue cards and one of their Means cards. You can never accuse yourself.',
          'Right: the Investigators win (unless the Reversal turns it round). Wrong: everyone sees it was wrong, and you have spent your badge. You keep presenting, but can’t solve again.',
          'The Murderer and the Accomplice may bluff with a solve of their own, but never with their own crime: the app quietly asks them for a different pair.',
          'If every badge is spent, the Murderer’s side wins at once.',
        ],
      },
      {
        title: 'Final accusations (table rule)',
        bullets: [
          'The printed rules end the game after round 3 with a win for the Murderer. Our table rule, on by default (the host can switch it off), adds one last chance.',
          'After the last round’s discussion (and presentations, if on), everyone who still has a badge must accuse, one by one and in public, in seat order starting left of the Forensic Scientist. The Murderer and the Accomplice accuse too, and must bluff with a wrong pair.',
          'Each accusation is judged at once, truthfully. The first right one wins for the Investigators (then the Reversal, if the Witness is in the game). If every accusation is wrong, the Murderer’s side wins.',
          'Players without a badge, and players who have left, are skipped. The host can skip a stuck or offline player’s turn.',
          'Each turn uses the presentation time: a reminder by default, or strict (the turn is skipped at 0) if the host chose that.',
          'After Last Call, the round it came up in is the last, so the final accusations follow it.',
        ],
      },
      {
        title: 'The Reversal',
        paragraphs: [
          'When the Witness is in the game and the crime is solved, the Murderer and the Accomplice get 60 seconds to agree on who the Witness is (they see each other’s taps). The Murderer’s confirm is final. If they find the Witness, the Murderer’s side wins after all.',
        ],
      },
      {
        title: 'Events',
        paragraphs: [
          'With events on, six event tiles are shuffled into the pile after round 1. When one is drawn, it happens straight away, then another tile is drawn.',
        ],
        bullets: EVENT_KINDS.map((k) => `${EVENT_NAMES[k]}: ${EVENT_TEXT[k]}`),
      },
      {
        title: 'Allies expansion',
        paragraphs: [
          'An optional expansion the host switches on in the lobby. It shuffles in 89 more Clue cards, 54 more Means cards, 7 more scene tiles and one more event, raises the table to 14 players, and offers three new roles, each with its own switch. “Use the suggested roles” sets the rulebook’s line-ups: the Accomplice and the Witness at 6, plus the Lab Technician at 7, plus the Inside Man at 8 or more. At least one plain Investigator must be left.',
        ],
        bullets: [
          'The Allies Phase comes once, after round 1’s discussion (and presentations, if on). Everyone waits while the Lab Technician checks one card (45 seconds; they may skip), then the Inside Man takes a badge (45 seconds; at 0 one is taken at random). The table hears who lost a badge, never who took it. Nobody can solve during it.',
          'A badge the Inside Man takes is gone: that player can’t solve, and doesn’t make a final accusation. If it was the last badge at the table, the Murderer’s side wins at once.',
          'The Murderer’s side can never name the real pair, and that includes the Inside Man, who doesn’t know it.',
          'In the Reversal the Inside Man joins the Murderer and the Accomplice: the three see each other and each other’s taps, and the Murderer decides.',
          'Change of Heart (the new event): the Forensic Scientist peeks at the next tile and sets it aside, face down. If it is an event, they now secretly win with the Murderer’s side: still truthful and silent, but free to mislead with bullets. Another tile is drawn for the round, and the set-aside tile is shown at the end. If the pile is empty, the discarded scene tiles are shuffled into a new one first.',
          'Unknown Location (a variant): its single Location tile replaces the four.',
        ],
      },
      {
        title: 'If someone drops out',
        bullets: [
          'A player who leaves keeps their cards on the table (a departed Murderer can still be caught) and their presentations are skipped.',
          'If the Forensic Scientist goes offline, the game waits and the host can hand over: a random Investigator becomes the new Forensic Scientist and sees the answer. Their cards stay on the table, but they can no longer solve or present.',
        ],
      },
    ],
    tips: [
      'Use the discussion: say your reading of every bullet out loud and challenge other people’s. A quiet table helps the Murderer.',
      'Final accusations: listen to the ones before yours. Every wrong pair rules something out for the next accuser.',
      'Long-press a card to mark it ⭐ suspicious or ✕ ruled out. Only you see your marks.',
      'The first bullets are usually the surest: a later bullet may be a compromise, after the table’s talk pulled the Forensic Scientist somewhere less clear.',
      'Murderer: present a confident theory about someone else, and don’t defend your own cards too hard.',
      'Witness: steer the table gently, or the culprits will name you in the Reversal.',
    ],
    glossary: [
      { term: 'Key Evidence', meaning: 'The Clue card the Murderer chose.' },
      { term: 'Means', meaning: 'The Means card the Murderer chose: how it was done.' },
      { term: 'Badge', meaning: 'Your one attempt to solve.' },
      { term: 'Bullet', meaning: 'The Forensic Scientist’s marker on one item of a tile.' },
      {
        term: 'Discussion',
        meaning:
          'The open talk after each round’s bullets: where the table works the case out together.',
      },
      {
        term: 'Presentations',
        meaning:
          'Optional (off by default): after each discussion, everyone in turn says which cards they suspect and why.',
      },
      {
        term: 'Allies Phase',
        meaning:
          'Allies expansion: the secret step after round 1 where the Lab Technician checks a card and the Inside Man takes a badge.',
      },
      {
        term: 'Final accusations',
        meaning:
          'Our table rule (on by default): after the last round, everyone with a badge accuses once, in turn and in public. Nobody right: the Murderer wins.',
      },
    ],
  };
}

/** The guide in the plain words, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The guide in the manifest's words and art (the plain words for anything missing). */
export function nameGuide(manifest: unknown): GameGuide {
  const m = obj(manifest);
  const version = typeof m.artVersion === 'number' ? m.artVersion : 2;
  const url = (path: string | undefined) =>
    path && `/api/backroom/assets/inquest/${path.replace(/^\/+/, '')}?v=${version}`;
  const roles = obj(m.roles);
  const tiles = obj(m.tiles);
  const tile = (n: number) => obj(tiles[String(n)]);
  const back = url(str(m.roleBack));
  const cause = url(str(tile(1).art));
  return makeGuide({
    role: (id) => {
      const r = obj(roles[id]);
      const name = str(r.name);
      const text = str(r.text);
      const art = url(str(r.art));
      return { ...(name && { name }), ...(text && { text }), ...(art && { art }) };
    },
    event: (k) => {
      const t = tile(EVENT_TILES[k]);
      const name = str(t.title);
      const text = str(t.text);
      const art = url(str(t.art));
      return { ...(name && { name }), ...(text && { text }), ...(art && { art }) };
    },
    ...(str(tile(2).title) && { location: str(tile(2).title)! }),
    ...(back && { back }),
    ...(cause && { art: { causeOfDeath: cause } }),
  });
}
