/**
 * Every line of table talk the game shows (status lines, prompts, waiting text, moment captions,
 * banners, notices and tips), keyed so a themed edition can reword any of them from its private
 * manifest (`copy: { <key>: string }`). The defaults are Hydra's own wording, written with name
 * tokens (`{president}`, `{policy}`, `{blues}`…) and variables (`{P}` the President or "you",
 * `{C}` the Chancellor or "you", `{player}`, `{target}`, `{n}`…). `**bold**` marks a stressed word.
 * Unknown keys in a manifest are ignored, and a missing key falls back to the default.
 */
export const COPY = {
  // The status line under the header, one per stage.
  'status.dead':
    'You’ve been executed: you can watch, but you can’t talk, vote or give anything away.',
  'status.reveal.you':
    'Read your secret role (slide the card up, or hold it), then tap Ready. Keep it hidden from your neighbours.',
  'status.reveal.waiting': 'Waiting for everyone to read their role ({ready} of {total}).',
  'status.nominate.you':
    'You’re the {candidate}: nominate a {chancellor}. Greyed seats can’t be picked (tap one to see why).',
  'status.nominate.other': '{P} is choosing a {chancellor}. Say out loud who you’d trust!',
  'status.vote.you':
    'Vote {yes} or {no} on {president} {P} with {chancellor} {C}. {voted} of {alive} voted.',
  'status.vote.voted':
    'You voted {ballot}: you can change it until the last vote is in. {voted} of {alive} voted.',
  'status.vote.other':
    'Everyone votes on {president} {P} with {chancellor} {C}. {voted} of {alive} voted.',
  'status.leaderCheck': 'The moment of truth: is {C} {leader}?',
  'status.legislate.president.you':
    'You’re the {president}: discard one of your three {policies}. No talking until it’s done!',
  'status.legislate.president.other':
    'The government is in session: {P} is discarding a {policy}. Silence, please.',
  'status.legislate.chancellor.you':
    'You’re the {chancellor}: enact one {policy}. The other is discarded.',
  'status.legislate.chancellor.veto.you':
    'You’re the {chancellor}: enact one {policy}, or ask the {president} for a {veto}.',
  'status.legislate.chancellor.other':
    'The government is in session: {C} is choosing which {policy} to enact.',
  'status.veto.you': '{C} asks to {veto} this agenda. Agree (both cards are discarded) or refuse?',
  'status.veto.other': '{C} asked for a {veto}; {P} is deciding.',
  'status.claim.president.you':
    'Claim the three cards you drew and the one you discarded. Claims are final, and you may lie.',
  'status.claim.chancellor.you': 'Claim the two cards you got. Claims are final, and you may lie.',
  'status.claim.investigate.you':
    'Tell the table what you saw on {target}’s {party} card. Claims are final, and you may lie.',
  'status.claim.peek.you':
    'Tell the table the top three cards you saw. Claims are final, and you may lie.',
  'status.claim.other': 'Claims are coming in. Question them out loud before the next nomination!',
  'status.power.investigate.you': 'Use your power: {power}. Talk it over first if you like.',
  'status.power.special.you': 'Use your power: {power}. Talk it over first if you like.',
  'status.power.peek.you': 'Use your power: {power}. Talk it over first if you like.',
  'status.power.execute.you': 'Use your power: {power}. Talk it over first if you like.',
  'status.power.other': '{P} must use a power: {power}.',
  'status.chaos': 'Three failed governments: the people take over and enact the top {policy}!',
  'status.over.blue': 'The {blues} win!',
  'status.over.red': 'The {reds} win!',

  // Banners above the table.
  'talk.vote':
    'Discuss this government out loud. Votes stay hidden, and can change, until the last one is in.',
  'talk.claims': 'Question the government out loud before the next nomination.',
  nudged: 'The table is waiting for you!',
  spectator: 'You’re watching this game. You can play in the next one.',

  // Why a seat can't be picked ("Ben was the last elected Chancellor…").
  'why.self': 'That’s you.',
  'why.dead': 'executed',
  'why.term-limit-chancellor': 'was the last elected {chancellor} (term-limited)',
  'why.term-limit-president': 'was the last elected {president} (term-limited)',
  'why.investigated': 'has already been investigated',

  // The action dock's prompts.
  'dock.nominate': '👆 Tap a seat to nominate your {chancellor}',
  'dock.pick': '👆 Tap a seat to choose',

  // The secret sheets.
  'sheet.president.title': 'You’re the {president}',
  'sheet.president.text':
    'Discard one. The other two are **shuffled** and handed to {C}. No talking until the {policy} is out!',
  'sheet.chancellor.title': 'You’re the {chancellor}',
  'sheet.chancellor.text': 'Enact one {policy}; the other is discarded face down.',
  'sheet.chancellor.refused': '{P} refused the {veto}: you must enact one.',
  'sheet.veto.title': 'A {veto} request',
  'sheet.veto.text':
    '{C} wants to {veto} this agenda. If you agree, both cards are discarded and the election tracker moves on ({from} → {to}). If you refuse, {C} must enact one.',
  'sheet.veto.textChaos':
    '{C} wants to {veto} this agenda. If you agree, both cards are discarded and the election tracker moves on ({from} → {to}: the people will enact the top {policy}). If you refuse, {C} must enact one.',
  'sheet.peek.text': 'The top three cards of the deck, top first. They stay in this order.',
  'hand.shuffled': '🔀 Shuffled: the order says nothing about what the {president} did.',

  // The big moments.
  'moment.vote.title': '{president} {P} with {chancellor} {C}',
  'moment.vote.elected': 'Elected',
  'moment.vote.rejected': 'Rejected',
  'moment.vote.lastChance': 'One more failed government and the people take over!',
  'moment.vote.missing': '{n} vote(s) not counted',
  'moment.enact.heading': 'A {policy} is enacted',
  'moment.enact.chaos.heading': 'The people have spoken',
  'moment.enact.blue': 'A {bluePolicy} {policy}',
  'moment.enact.red': 'A {redPolicy} {policy}',
  'moment.enact.chaos.from': 'from the top of the deck',
  'moment.enact.chaos.note':
    'Any power is ignored, the tracker resets and term limits are forgotten.',
  'moment.enact.powerUnlocked': 'Power unlocked',
  'moment.execute.title': '{player} has been executed',
  'moment.execute.note':
    'They can no longer speak, vote or run for office. Their role stays secret.',
  'moment.cleared.stamp': 'Not {leaderName} ✓',
  'moment.cleared.note': 'The government stands. The session begins.',
  'moment.leaderCheck.kicker': 'The danger zone',
  'moment.leaderCheck.question': 'Is the new {chancellor} {leader}?',
  'moment.chaos.title': 'Chaos!',
  'moment.chaos.note':
    'Three failed governments in a row: the people enact the top {policy} themselves.',

  // Your role, once you look at it.
  'me.youAre.blue': 'You are a {blue}',
  'me.youAre.red': 'You are a {red}',
  'me.youAre.leader': 'You are {leader}',
  'me.goal.blue':
    'Pass 5 {bluePolicy} {policies}, or find {leader} and execute them. Trust carefully: watch the votes and the claims.',
  'me.goal.red':
    'Pass 6 {redPolicy} {policies}, or get {leader} elected {chancellor} once 3 {redPolicy} {policies} are down. Blend in and protect {leader}.',
  'me.goal.leader':
    'Get elected {chancellor} once 3 {redPolicy} {policies} are down, or let your team pass 6. Look like the most trustworthy {blue} at the table.',

  // The end screen.
  'end.win.blue': 'The {blues} win!',
  'end.win.red': 'The {reds} win!',
  'end.reason.blue-policies': 'Five {bluePolicy} {policies} passed.',
  'end.reason.red-policies': 'Six {redPolicy} {policies} passed.',
  'end.reason.leader-executed': '{Leader} was executed.',
  'end.reason.leader-elected': '{Leader} was elected {chancellor} in the danger zone.',
  'end.leaderWas': '{Leader} was **{player}**.',
  'end.won': 'Your team won. 🎉',
  'end.lost': 'Your team lost this one.',
  'end.playAgain': 'Play again keeps the seats and settings, with a new first {president}.',

  // Notices: what just happened, for everyone.
  'notice.reshuffled': 'The discard pile was shuffled back into the deck.',
  'notice.vetoRefused': 'The {president} refused the {veto}.',
  'notice.vetoed': 'The agenda was vetoed: both {policies} were discarded.',
  'notice.special': '{P} called a special election: {player} is the next {candidate}.',
  'notice.executed': '{player} has been executed and can no longer speak or vote.',
  'notice.skipped': 'The host skipped {player}’s claim.',
  'notice.auto': '{timeout}{what} for {player} by {by}.',

  // First-time tips.
  'tip.marks':
    'Tap the ☆ on a seat to mark ⭐ trust or ✕ suspect, and tap a name for their voting record and your notes. Only you see these.',
  'tip.term':
    'Greyed seats are term-limited: the last elected {president} and {chancellor} can’t be the next {chancellor}. Tap one to see why.',
  'tip.tracker':
    'The election tracker (the dots up top) moves on every failed vote. On the third, the people enact the top {policy}.',
  'tip.claims':
    'Claims are how this game is played: compare them with the votes and the deck chip. The log flags claims that can’t all be true.',
  'tip.danger':
    'Danger zone: with 3 {redPolicy} {policies} down, electing {leader} as {chancellor} wins it for the {reds}.',

  // The timeline.
  'log.vetoed': '✂️ Vetoed: both {policies} discarded',
  'log.vetoedShort': 'vetoed',

  // The board.
  'ribbon.veto': '{Veto} unlocked',
} as const;

export type CopyKey = keyof typeof COPY;
export type CopyVars = Record<string, string | number>;

/** The manifest's override for `key` if it has a usable one, else the default. */
export function copyLine(overrides: unknown, key: CopyKey): string {
  const o =
    overrides && typeof overrides === 'object' ? (overrides as Record<string, unknown>)[key] : null;
  return typeof o === 'string' && o.trim() ? o : COPY[key];
}

/** Fills `{var}` placeholders; unknown ones are left as they are. */
export function fillVars(text: string, vars: CopyVars): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (m, k: string) =>
    Object.hasOwn(vars, k) ? String(vars[k]) : m,
  );
}
