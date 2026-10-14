import type {
  GameGuide,
  GuideContext,
  GuideListItem,
  GuideOption,
  GuidePreset,
  GuideTile,
  GuideTone,
} from '@vt/game-sdk';
import { escapeRegExp } from '@vt/game-sdk';
import { STEPS, type StepDef, buildNightPlan, epicPossible, publicPlan, stepDef } from './plan.ts';
import { recommended } from './presets.ts';
import {
  ARTIFACTS,
  ARTIFACT_IDS,
  type ArtifactId,
  ENABLED_SETS,
  MARKS,
  MARK_IDS,
  type MarkId,
  ROLES,
  ROLE_IDS,
  type RoleId,
  SET_LABELS,
  type SetId,
  marksInPlay,
  marksInUse,
  markLabel,
  roleLabel,
} from './roles.ts';
import type { NightfallView } from './types.ts';

// Built from the role registry, so the guide always matches the engine. The plain guide uses the
// plain role words; `nameGuide` fills in each card's real name, printed text and art from the
// private manifest, for the browsers that can see them.

/** A card's words and art from the manifest (art as URLs). */
export interface CardNames {
  name?: string;
  text?: string;
  art?: string;
  card?: string;
}

/** Where the guide's names and art come from: the manifest, or the plain words without one. */
export interface NightfallNames {
  role?: (id: RoleId) => CardNames | undefined;
  set?: (id: SetId) => string | undefined;
  mark?: (id: MarkId) => CardNames | undefined;
  artifact?: (id: ArtifactId) => CardNames | undefined;
  /** The card back, for the stepper. */
  back?: string;
}

const playable = ROLE_IDS.filter((r) => ENABLED_SETS.includes(ROLES[r].set));
/** Team words, which the rules use as words rather than as card names. */
const GENERIC = new Set<RoleId>(['werewolf', 'vampire', 'alien']);

/** Whether a role is ever woken at night (its own step, or with its team). */
const wakes = (r: RoleId) =>
  STEPS.some((s) => s.role === r && !s.doppel) ||
  !!(ROLES[r].wakesWithWerewolves || ROLES[r].wakesWithVampires || ROLES[r].wakesWithAliens);

const TONE: Partial<Record<string, GuideTone>> = {
  village: 'good',
  werewolf: 'evil',
  vampire: 'evil',
  alien: 'alien',
  synthetic: 'alien',
};
const TEAM_GROUP: Record<GuideTone, string> = {
  good: 'Village',
  evil: 'Werewolves & vampires',
  alien: 'Aliens',
  own: 'Own goal',
  neutral: 'Own goal',
};

const SET: Record<'vampire' | 'alien', GuideOption> = {
  vampire: { key: 'set:vampire', label: 'Vampire set' },
  alien: { key: 'set:alien', label: 'Alien set' },
};
const MARKS_ON: GuideOption = { key: 'marks', label: 'Vampire set' };
const EPIC: GuideOption = { key: 'epic', label: 'Two evil teams' };

/** The options a selection of cards turns on (sections and tiles say which they need). */
function optionsFor(roles: readonly RoleId[]): string[] {
  const sets = [...new Set(roles.map((r) => ROLES[r].set))].map((s) => `set:${s}`);
  return [
    ...sets,
    ...new Set(roles.map((r) => `role:${r}`)),
    ...(marksInUse(roles) ? [MARKS_ON.key] : []),
    ...(epicPossible(roles) ? [EPIC.key] : []),
  ];
}

export function makeGuide(names: NightfallNames = {}): GameGuide {
  const role = (r: RoleId) => names.role?.(r);
  const roleName = (r: RoleId) => role(r)?.name ?? roleLabel(r);
  const setName = (s: SetId) => names.set?.(s) ?? SET_LABELS[s];
  const markName = (m: MarkId) => names.mark?.(m)?.name ?? markLabel(m);
  const artifactName = (a: ArtifactId) => names.artifact?.(a)?.name ?? roleLabel(a);
  const CURATOR: GuideOption = { key: 'role:curator', label: roleName('curator') };
  /** The registry's plain text (summaries, win lines) with every card and Mark named. */
  const LABELS = new Map<string, string>([
    ...MARK_IDS.map((m) => [markLabel(m), markName(m)] as const),
    ...playable.filter((r) => !GENERIC.has(r)).map((r) => [roleLabel(r), roleName(r)] as const),
  ]);
  const LABEL_RE = new RegExp(
    `(?<![\\w-])(${[...LABELS.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})(?![\\w-])`,
    'g',
  );
  const named = (text: string) => text.replace(LABEL_RE, (l) => LABELS.get(l) ?? l);

  /** A night step as the narrator says it. */
  const stepLabel = (s: StepDef) =>
    s.id === 'werewolves'
      ? 'Werewolves (together)'
      : s.id === 'vampires'
        ? `Vampires (together: ${['vampire', 'the-master', 'the-count'].map((r) => roleName(r as RoleId)).join(', ')})`
        : s.id === 'dusk'
          ? 'Everyone looks at their own Mark (the end of the dusk)'
          : s.id === 'lovers'
            ? 'The lovers wake and see each other'
            : s.id === 'aliens'
              ? `Aliens (together: ${(['alien', 'synthetic-alien', 'groob', 'zerb', 'body-snatcher'] as RoleId[]).map(roleName).join(', ')}; the ${roleName('cow')} puts out a fist)`
              : s.id === 'groob-zerb'
                ? `${roleName('groob')} and ${roleName('zerb')}, together`
                : s.id === 'blob'
                  ? `The ${roleName('blob')}’s members are announced (nobody wakes)`
                  : s.id === 'ripple'
                    ? 'A ripple, perhaps (announced to everyone)'
                    : s.doppel
                      ? `${roleName('doppelganger')}, if she copied the ${roleName(s.role)}`
                      : roleName(s.role);
  const stepItem = (s: StepDef, mine = false): GuideListItem => {
    const art = ['dusk', 'lovers', 'ripple'].includes(s.id) ? undefined : role(s.role)?.art;
    return { label: stepLabel(s), ...(art && { art }), ...(mine && { you: true }) };
  };
  const fullOrder = STEPS.filter((s) => playable.includes(s.role));

  const tone = (r: RoleId): GuideTone => TONE[ROLES[r].team] ?? 'own';
  const roleTiles: GuideTile[] = playable.map((r) => {
    const t = tone(r);
    const c = role(r);
    const set = ROLES[r].set;
    return {
      id: r,
      name: roleName(r),
      text: c?.text ?? named(ROLES[r].summary),
      win: named(ROLES[r].win),
      group: TEAM_GROUP[t],
      tone: t,
      icon: t === 'evil' ? '🐺' : t === 'alien' ? '👽' : t === 'good' ? '🏡' : '🎭',
      meta: `${TEAM_GROUP[t]} · ${setName(set)} · ${wakes(r) ? 'wakes at night' : 'doesn’t wake'}`,
      ...(c?.art && { art: c.art }),
      ...(c?.card && { card: c.card }),
      ...(set !== 'base' && { option: { key: `set:${set}`, label: setName(set) } }),
    };
  });
  const markTiles: GuideTile[] = MARK_IDS.map((m) => {
    const c = names.mark?.(m);
    return {
      id: `mark-${m}`,
      name: markName(m),
      text: c?.text ?? named(MARKS[m]),
      group: 'Marks',
      icon: '🔖',
      meta: `A Mark (${setName('vampire')})`,
      option: MARKS_ON,
      ...(c?.art && { art: c.art }),
    };
  });
  const artifactTiles: GuideTile[] = ARTIFACT_IDS.map((a) => {
    const c = names.artifact?.(a);
    return {
      id: `artifact-${a}`,
      name: artifactName(a),
      text: c?.text ?? named(ARTIFACTS[a].summary),
      group: 'Artifacts',
      icon: '🏺',
      meta: `An artifact (the ${roleName('curator')} places it)`,
      option: CURATOR,
      ...(c?.art && { art: c.art }),
    };
  });

  /** The tiles a selection of cards puts in the game, with copies. */
  const inGameOf = (roles: readonly RoleId[], artifacts: readonly ArtifactId[] = []) => {
    const counts: Record<string, number> = {};
    for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;
    for (const m of marksInPlay(roles)) counts[`mark-${m}`] = 1;
    if (roles.includes('curator'))
      for (const a of artifacts.length ? artifacts : ARTIFACT_IDS) counts[`artifact-${a}`] = 1;
    return counts;
  };

  const presets: GuidePreset[] = (
    [
      ['beginner', 'Beginner (6 players)', recommended(6)],
      ...(['base', 'daybreak', 'vampire', 'alien'] as const).map(
        (s) => [s, setName(s), playable.filter((r) => ROLES[r].set === s)] as const,
      ),
      [
        'bonus',
        'Bonus packs',
        playable.filter((r) => ['bonus1', 'bonus2', 'bonus3'].includes(ROLES[r].set)),
      ],
    ] as const
  ).map(([id, label, roles]) => ({
    id,
    label,
    context: {
      summary:
        id === 'beginner'
          ? `The recommended cards for 6 players: ${roles.map(roleName).join(', ')}.`
          : `The ${roles.length} roles of ${label}.`,
      options: optionsFor(roles),
      inGame: inGameOf(roles),
      lists: {
        'The night': {
          title: `Wake order with these cards`,
          items: buildNightPlan(roles).map((id) => stepItem(stepDef(id))),
        },
      },
    },
  }));

  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as NightfallView;
    if (!v?.settings?.roles) return undefined;
    const roles = v.settings.roles;
    const sets = [...new Set(roles.map((r) => ROLES[r].set))].map(setName);
    const narration = {
      off: 'no narration',
      host: 'narration on the host’s device',
      all: 'narration on every device',
    }[v.settings.narration];
    const plan = v.phase === 'lobby' ? buildNightPlan(roles) : publicPlan(roles, v.announcements);
    const mine = v.myRole;
    const myStep = mine
      ? plan.findIndex((id) => stepDef(id).role === mine && !stepDef(id).doppel)
      : -1;
    const ctx: GuideContext = {
      summary: `${roles.length} cards · ${sets.join(', ')} · ${narration}`,
      options: optionsFor(roles),
      inGame: inGameOf(roles, v.settings.artifacts),
      lists: {
        'The night': {
          title: 'Wake order in this game',
          items: buildNightPlan(roles).map((id, i) => stepItem(stepDef(id), i === myStep)),
        },
      },
    };
    const seated = v.me?.playing && v.me.id === you;
    if (mine && seated) {
      const c = role(mine);
      const now =
        v.phase === 'ready'
          ? '🃏 Look at your card, then press Ready'
          : v.phase === 'night' && v.night
            ? `🌙 Night · step ${Math.max(1, v.night.index + 1)} of ${v.night.count}${
                v.night.acting
                  ? ' · your turn now'
                  : myStep > v.night.index
                    ? ` · you wake at step ${myStep + 1}`
                    : ''
              }`
            : v.phase === 'day'
              ? '☀️ Day: talk it over, then press Ready to vote'
              : v.phase === 'vote'
                ? '🗳️ Vote now'
                : v.phase === 'reveal'
                  ? '🏁 The reveal'
                  : undefined;
      ctx.you = {
        name: roleName(mine),
        text: c?.text ?? named(ROLES[mine].summary),
        tile: mine,
        ...(c?.art && { art: c.art }),
        ...(now && { now }),
      };
      ctx.secret = true;
      ctx.stepNotes = {
        0: `You were dealt the ${roleName(mine)}. Tap Ready once you’ve looked.`,
        1:
          myStep >= 0
            ? `You wake at step ${myStep + 1} of ${plan.length}. Until then, eyes closed.`
            : wakes(mine)
              ? 'You wake with your team when it’s called.'
              : 'Your role doesn’t wake: keep your eyes closed all night.',
      };
    }
    return ctx;
  };

  const art = (r: RoleId) => role(r)?.art;
  const text: GameGuide = {
    tagline: 'One night, hidden roles, one vote: find a werewolf before sunrise, or be one.',
    players: '3 to 10',
    duration: '10 minutes a game',
    goal: 'Everyone gets a secret role. One night of sneaky moves, then one vote: the village wins if a Werewolf dies; the Werewolves win if none does. A few roles have goals of their own.',
    quickStart: [
      'Everyone gets one secret role card: look at it, then press Ready.',
      'At night, keep your eyes closed until your role is called. When you wake, follow the prompt on your screen.',
      'Cards can be swapped in the night, so the role you end with may not be the one you were dealt.',
      'At daybreak, talk it over: claim, bluff and work out who the werewolves are.',
      'Then everyone votes at once. The player with the most votes dies.',
      'Usually the village wins if a werewolf dies and the werewolves win if none does; some roles bring goals of their own.',
    ],
    steps: [
      {
        title: 'Peek at your role',
        text: 'Everyone gets one secret role card: look at it, then press Ready.',
        icon: '🃏',
        ...(names.back && { art: names.back }),
      },
      {
        title: 'Night: wake when called',
        text: 'Keep your eyes closed until your role is called. When you wake, follow the prompt on your screen.',
        icon: '🌙',
        ...(art('werewolf') && { art: art('werewolf') }),
      },
      {
        title: 'Cards move in the dark',
        text: 'Cards can be swapped in the night, so the role you end with may not be the one you were dealt.',
        icon: '🔀',
        ...(art('robber') && { art: art('robber') }),
      },
      {
        title: 'Day: talk, claim, bluff',
        text: 'At daybreak, talk it over: claim, bluff and work out who the werewolves are.',
        icon: '☀️',
      },
      {
        title: 'Everyone votes at once',
        text: 'The player with the most votes dies. On a tie, everyone tied dies; if nobody gets two votes, nobody does.',
        icon: '🗳️',
      },
      {
        title: 'Who wins',
        text: 'Usually the village wins if a werewolf dies and the werewolves win if none does; some roles bring goals of their own.',
        icon: '🏆',
        ...(art('tanner') && { art: art('tanner') }),
      },
    ],
    stepsDone:
      'That’s it: the app calls every role and tells you exactly what to tap. Read your own role card; the rest can wait until it comes up.',
    setup: [
      'The host picks the cards: one per player plus three for the centre (plus one when the Alpha Wolf is in). The recommended cards for your table size are picked to start with, and follow the table as people join until the host changes them. Ready-made setups are tagged Beginner, Advanced or Chaos.',
      'Everyone gets one card. Cover your screen and peek at your role; Ready unlocks once you have looked.',
      'Night falls once everyone is ready (the host can start it early if someone dropped out). The app calls each role in turn.',
      'Narration: with Host’s device, only the host’s phone speaks, so put it in the middle of the table; with Every device, every phone speaks, which suits players who are apart. Every screen shows the narration as text either way.',
    ],
    sections: [
      {
        title: 'The night',
        level: 'basics',
        paragraphs: [
          'Every role in the game is called in a fixed order, even when its card is in the centre, and every call lasts the same time, so the clock never tells anyone which roles are really at the table.',
          'When your role is called, your screen lights up: tap players or centre cards to act, and see what you learn. Everyone else just sees which role is awake. If you don’t choose in time, optional actions are skipped and required ones are made for you at random.',
          'Left and right follow the seat order in the app, not where you sit, so the buttons name the player on each side.',
          'You always act as the role you were dealt, even if your card has been swapped since. At the end of the night you are whatever card is in front of you, and you don’t get to look again.',
        ],
        list: {
          title: `Full wake order (${fullOrder.length} steps): the lobby shows yours`,
          folded: true,
          items: fullOrder.map((s) => stepItem(s)),
        },
      },
      {
        title: 'The day and the vote',
        level: 'basics',
        bullets: [
          'Talk it over. Say anything you like (lies included), but never show your screen.',
          'Press Ready to vote when you’re done; the vote opens when everyone is ready or the clock runs out. The host can open it early (when someone has dropped out, say).',
          'Everyone secretly votes for another player, then all votes show at once.',
          'The player with the most votes dies; on a tie, everyone tied dies. If nobody gets more than one vote, nobody dies.',
          `Votes for a ${roleName('prince')} don’t count, and the ${roleName('bodyguard')}’s pick protects instead of voting: a ${roleName('bodyguard')}’s buttons read Protect.`,
          'You can’t vote for a player who has left the game.',
        ],
      },
      {
        title: 'Who wins',
        level: 'basics',
        bullets: [
          'The village wins if at least one Werewolf dies (with vampires instead of werewolves, a Vampire; with both, either), or if no player is a Werewolf or Vampire and nobody dies. In an epic battle the village needs one of each to die.',
          'The werewolves win if at least one player is a Werewolf and no Werewolf dies.',
          `If a ${roleName('tanner')} dies, no evil team can win (neither the werewolves nor the vampires); the ${roleName('tanner')} wins. With no ${roleName('tanner')} among the players, an ${roleName('apprentice-tanner')} counts as one.`,
          `The ${roleName('cursed')} joins the werewolves if a Werewolf votes for him; with vampires in the game, a Vampire’s vote turns him too, and he joins the side that cast more of those votes (a tie makes him a Werewolf).`,
          'Then everything is revealed: who started as what, where the cards and Marks ended up (with each Mark a player held along the way), who was protected and why, and a step-by-step replay of the night.',
        ],
      },
      {
        title: 'During the day',
        level: 'basics',
        bullets: [
          'The Learned tab starts with where you stand now: what you started as, your card and Mark as far as you know, and what that means for your side. Someone may still have moved them without you knowing.',
          `The Roles tab lists the cards in play in wake order (with copies, like ×2), the roles the ${roleName('doppelganger')} wakes again for, and the Marks and artifacts that can turn up.`,
        ],
      },
      {
        title: 'Epic battles',
        option: EPIC,
        paragraphs: [
          `When the players include werewolves, vampires and villagers all at once (a ${markName('vampire')} counts), it’s an epic battle, and the vote changes.`,
        ],
        bullets: [
          'Protected players are left out, then the most voted player dies, as long as they have at least two votes, and so does the second most voted, even with one vote. Everyone tied for second dies. Most Votes tokens #1 and #2 mark them.',
          'If several players tie for the most votes, only they die: nobody dies in second place.',
          'If nobody has two votes, nobody dies.',
          'Each evil team wins only if none of its members dies and a member of another evil team does. The village needs members of two different evil teams to die.',
        ],
      },
      {
        title: 'Vampires and Marks',
        option: SET.vampire,
        paragraphs: [
          `With roles from the vampire set, every player starts with a face-down ${markName('clarity')} in front of them. At dusk, before the night proper, some roles give, take or swap Marks; then everyone wakes to look at their own Mark (never anyone else’s), and the lovers wake to see each other.`,
          `A Mark belongs to the player, not the card: swapping cards leaves the Marks where they are. A player only ever holds one Mark; giving a new one sends the old one back unseen. A shield protects a card, never its Mark. An artifact that changes your role beats your card and the ${markName('vampire')}.`,
        ],
        bullets: [
          ...MARK_IDS.map((m) => `${markName(m)}: ${named(MARKS[m])}`),
          `The vampires win if at least one player is a Vampire (by card or by Mark) and no Vampire dies. ${roleName('renfield')} wins with them, even if he dies. A ${markName('vampire')} keeps its holder a Vampire whatever card they end with, the Assassins’ cards included.`,
          `If another Vampire votes for ${roleName('the-master')}, he can’t die in the vote; the next most voted (with more than one vote) dies instead.`,
          `When a player with a ${markName('love')} dies, every other lover dies too, even a protected one.`,
          `Anyone who votes for the player with the ${markName('disease')}, or for the ${roleName('diseased')}, can’t win.`,
          `The ${roleName('assassin')} wins if a player with the ${markName('assassin')} dies, alongside any team. The ${roleName('apprentice-assassin')} wins if an ${roleName('assassin')} dies; if she found no ${roleName('assassin')} and placed the Mark herself, she wins when its holder dies, even if her card moves later.`,
          `A player with the ${markName('traitor')} wins only if someone else on their team dies, even when their team loses; their team’s result doesn’t count for them.`,
          `A player held by the ${markName('fear')} sleeps through their turn, and learns at daybreak that they did.`,
        ],
      },
      {
        title: 'Artifacts',
        option: CURATOR,
        paragraphs: [
          `The ${roleName('curator')} places a random artifact on a card. Whoever ends up with it sees it at daybreak, and must follow it.`,
        ],
        bullets: ARTIFACT_IDS.map((a) => `${artifactName(a)}: ${named(ARTIFACTS[a].summary)}`),
      },
      {
        title: 'Aliens',
        option: SET.alien,
        paragraphs: [
          'With roles from the alien set, every player has a number: their seat, counting up to the left (the table shows each number as a token). The narrator uses the numbers: “any even player”, “a player with a number higher than yours”, “players 2, 5 or 7”. When nobody fits, the action can’t be done.',
          'Many alien roles get their instruction at random when they wake, like the narrator choosing a card from a deck: the aliens might look at a card, show each other their cards, pass their cards round, shorten the day or tap a fist to recruit a New Alien. Only the players woken (or named) are told. In the lobby, the host can see and change how likely each instruction is under Alien options, and reset them.',
          `An Alien is anyone holding an alien card (${(['alien', 'synthetic-alien', 'groob', 'zerb', 'body-snatcher'] as RoleId[]).map(roleName).join(', ')}, or a card the ${roleName('body-snatcher')} took), a New Alien the aliens tapped (whatever card they hold), or anyone with the ${artifactName('alien-artifact')}. If any alien dies, the aliens lose.`,
        ],
        bullets: [
          'The aliens win if at least one player is an Alien and none of them dies. The village wins if an alien (or a werewolf, or a vampire) dies.',
          `If the ${roleName('synthetic-alien')} dies, he wins, and the aliens and the village both lose.`,
          `With ${roleName('groob')} and ${roleName('zerb')} both among the players, they are rivals: each wins only if the other dies and they live (the village wins too, and the other aliens lose). The ${roleName('leader')} then wins only if both live.`,
          `If every player on the aliens’ side votes for the ${roleName('leader')}, the aliens win and the village loses, even if an alien dies.`,
          `The ${roleName('blob')} doesn’t wake: the narrator announces how many neighbours are part of it (1 with 3–4 players, 2 with 5–6, 3 with 7–8, 4 with 9 or more), counted from wherever the ${roleName('blob')} card ends up. The ${roleName('blob')} wins if none of them dies, alongside any other team.`,
          `The ${roleName('mortician')} wins if a neighbour of the ${roleName('mortician')} card dies, alongside any other team.`,
          `The ${roleName('oracle')} answers one question at the very start. Joining a team changes her side, but she doesn’t wake with it. If she fails the number question, she wins only by surviving, and everyone else only if she dies; with her card in the centre, everyone must survive to win.`,
          `${roleName('nostradamus')} may look at up to three players’ cards, stopping at one that isn’t village; that card’s team is announced as his. He wins only if he lives and that team wins.`,
          `The ${roleName('empath')} watches while the players the narrator names point, eyes closed, at someone who fits its question.`,
          'With aliens in the game, aliens, werewolves and vampires make an epic battle together: the village then needs players from two different evil sides to die.',
        ],
      },
      {
        title: 'Ripples',
        option: SET.alien,
        paragraphs: [
          'When the aliens’ own cards are in the game, the night may end with a ripple in the space-time continuum, announced to everyone. Each kind has its own odds (the host can change them); about one night in five has none.',
        ],
        bullets: [
          'A shorter day (one minute), voting for the app instead of a player (if the app gets the most votes, nobody dies), or voting with both hands.',
          'Some players may only say “I am an alien”, must face away from the table, or may not speak until the vote.',
          `A named player may look at cards, look at their own card, swap two players’ cards, rob, swap blindly, play the ${roleName('witch')} or turn a card face up; two named players may show each other their cards and have them shuffled between them.`,
          `A time loop: the whole night runs again on the board as it is (Marks are given again, shields placed again), everyone waking as their original role; the ${roleName('oracle')}, the ${roleName('blob')} and the ripple don’t come round again. Sometimes one player keeps their eyes open throughout and sees who wakes and what they touch.`,
          'A repeat: one role in the game does its night action again, with fresh choices.',
        ],
      },
    ],
    tiles: {
      label: 'Roles',
      blurb: `${roleTiles.length} roles · ${markTiles.length} Marks · ${artifactTiles.length} artifacts`,
      intro: `${roleTiles.length} roles, ${markTiles.length} Marks and ${artifactTiles.length} artifacts. Tap one to read its card; filter by team.`,
      items: [...roleTiles, ...markTiles, ...artifactTiles],
    },
    reference: [
      {
        title: 'Who wins (the usual game)',
        head: ['If…', 'Winner'],
        rows: [
          ['a Werewolf dies', 'the village'],
          ['no Werewolf dies (and one is playing)', 'the werewolves'],
          ['no Werewolf is playing and nobody dies', 'the village'],
          [`the ${roleName('tanner')} dies`, `the ${roleName('tanner')} (and no evil team)`],
        ],
      },
    ],
    presets,
    room,
    tips: [
      'Claim a role, or don’t: the werewolves will be claiming too.',
      'Roles that swap cards make everyone unsure what they are now. Use that.',
      `Listen to who knows what: the ${roleName('seer')}, ${roleName('robber')} and ${roleName('insomniac')} learned real cards.`,
      `Your Mark may have moved since you saw it at dusk: the ${roleName('pickpocket')} and the ${roleName('gremlin')} work in the dark.`,
    ],
  };
  // Plain card names written into the rules (the setup's Alpha Wolf…) take the manifest's names.
  const list = (l: string[] | undefined) => l?.map(named);
  return {
    ...text,
    setup: text.setup.map(named),
    tips: text.tips.map(named),
    sections: text.sections.map((sec) => ({
      ...sec,
      ...(sec.paragraphs && { paragraphs: list(sec.paragraphs)! }),
      ...(sec.bullets && { bullets: list(sec.bullets)! }),
    })),
  };
}

/** The guide in the plain words, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const assetUrl = (path: string) => `/api/backroom/assets/nightfall/${path.replace(/^\/+/, '')}`;

/** A manifest entry's words, with its art paths as URLs. */
function card(v: unknown): CardNames | undefined {
  const o = obj(v);
  const name = str(o.name);
  const text = str(o.text);
  const art = str(o.art);
  const face = str(o.card);
  if (!name && !text && !art) return undefined;
  return {
    ...(name && { name }),
    ...(text && { text }),
    ...(art && { art: assetUrl(art) }),
    ...(face && { card: assetUrl(face) }),
  };
}

/** The guide in the manifest's words and art (the plain guide's words for anything missing). */
export function nameGuide(manifest: unknown): GameGuide {
  const m = obj(manifest);
  const roles = obj(m.roles);
  const sets = obj(m.sets);
  const marks = obj(m.marks);
  const artifacts = obj(m.artifacts);
  const back = str(obj(m.backs).werewolf);
  return makeGuide({
    role: (id) => card(roles[id]),
    set: (id) => str(obj(sets[id]).name),
    mark: (id) => card(marks[id]),
    artifact: (id) => card(artifacts[id]),
    ...(back && { back: assetUrl(back) }),
  });
}
