import { type GameRoomInfo, listNames, waitingFor, waitingForHost } from '@vt/game-sdk';
import { suitOf } from '../logic/cards.ts';
import { type Names, fillNames } from '../logic/manifest.ts';
import { type AttemptView, DUMMY, EPILOGUE, type MissionControlView } from '../logic/types.ts';
import { SUIT_LOOK, plainText } from './Card.tsx';

export interface Status {
  text: string;
  yourMove: boolean;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A seat's name: a player's, or the dummy's from the theme. */
export function namer(view: MissionControlView, room: GameRoomInfo, names: Names) {
  return (id: string): string => {
    if (id === DUMMY) return cap(names.dummy);
    return (
      view.seats.find((s) => s.id === id)?.name ??
      room.players.find((p) => p.id === id)?.name ??
      'Someone'
    );
  };
}

export const missionLabel = (n: number) => (n === EPILOGUE ? 'Epilogue' : `Mission ${n}`);

/** Why the host can't start yet, or null. */
export function startBlocker(view: MissionControlView): string | null {
  const seated = view.seats.filter((s) => s.playing).length;
  if (!view.voyages.length) return 'No campaign is loaded yet. Ask the admin to import it.';
  if (seated < 2) return `At least 2 players must sit down (${seated} so far).`;
  if (seated > 5) return 'At most 5 players dive at once.';
  return null;
}

export function statusFor(view: MissionControlView, room: GameRoomInfo, names: Names): Status {
  const say = (t: string) => fillNames(t, names);
  const name = namer(view, room, names);
  const me = view.me?.id ?? '';
  const a = view.attempt;
  const waiting = (ids: string[]) =>
    waitingFor(
      ids.filter((id) => id !== DUMMY),
      room.players,
      { you: me },
    ) || 'Waiting…';
  if (view.phase === 'lobby' || !a) {
    const blocker = startBlocker(view);
    if (room.isHost)
      return {
        text: blocker ?? 'Pick the mission in the logbook, then press Start.',
        yourMove: !blocker,
      };
    return { text: waitingForHost(room, 'start the mission'), yourMove: false };
  }
  const crew = a.crew.map((c) => c.id);
  const inCrew = crew.includes(me);
  const people = crew.filter((c) => c !== DUMMY);
  const mine = (seat: string | null) => !!seat && a.controls.includes(seat);
  const forDummy = (seat: string | null) => (seat === DUMMY ? say(' for {dummy}') : '');
  if (!inCrew && a.stage !== 'done')
    return {
      text: 'You’re watching this dive. You can sit down for the next mission.',
      yourMove: false,
    };

  switch (a.stage) {
    case 'briefing':
      return a.ready.includes(me)
        ? { text: `Ready. ${waiting(people.filter((p) => !a.ready.includes(p)))}`, yourMove: false }
        : { text: 'Read the briefing together, then press Ready.', yourMove: true };
    case 'pick': {
      const p = a.extras.pick;
      if (p.at < p.order.length) {
        const asked = p.order[p.at]!;
        if (mine(asked))
          return {
            text: `${a.mission.rules.pick?.question ?? 'Answer'}${forDummy(asked)}`,
            yourMove: true,
          };
        return { text: `Waiting for ${name(asked)} to answer…`, yourMove: false };
      }
      if (me === a.captain)
        return { text: 'Choose the crew member for this mission’s role.', yourMove: true };
      return { text: `${name(a.captain)} is choosing a crew member…`, yourMove: false };
    }
    case 'tokens': {
      const e = a.extras.tokenEdit;
      if (e.proposal && !e.accepted.includes(me))
        return { text: `${name(e.proposal.by)} proposes a token change. Agree?`, yourMove: true };
      if (e.ready.includes(me) || e.proposal)
        return { text: 'Waiting for the others…', yourMove: false };
      return {
        text:
          a.mission.rules.tokenEdit === 'swap'
            ? 'You may swap two tokens (decide together, never mention your cards), or keep them.'
            : 'You may move one token onto a task without one (decide together), or keep them.',
        yourMove: true,
      };
    }
    case 'handover': {
      const h = a.extras.handOver;
      if (h.proposal && !h.accepted.includes(me))
        return {
          text: `${name(h.proposal.by)} proposes handing a task over. Agree?`,
          yourMove: true,
        };
      if (h.ready.includes(me) || h.proposal)
        return { text: 'Waiting for the others…', yourMove: false };
      return {
        text: 'Five crew: one task may change hands once. Propose one, or carry on.',
        yourMove: true,
      };
    }
    case 'draft': {
      const d = a.draft;
      const sel = a.mission.selection;
      if (sel === 'roles') {
        const p = a.extras.pick;
        if (p.at < p.order.length) {
          const asked = p.order[p.at]!;
          return mine(asked)
            ? { text: `Which role would you${forDummy(asked)} like?`, yourMove: true }
            : { text: `Waiting for ${name(asked)} to answer…`, yourMove: false };
        }
        if (d.ready.includes(me)) return { text: 'Waiting for the others…', yourMove: false };
        return {
          text: 'Decide together who takes which role, claim yours, then press Ready.',
          yourMove: true,
        };
      }
      if (d.turn && mine(d.turn) && (sel === 'decision' || sel === 'distribution')) {
        if (d.turn !== a.captain)
          return {
            text:
              sel === 'decision'
                ? `Can you${forDummy(d.turn)} take them all? Answer yes or no.`
                : `Would you${forDummy(d.turn)} take this task? Answer yes or no.`,
            yourMove: true,
          };
        return {
          text:
            sel === 'decision'
              ? say('Give every task to one other crew member.')
              : say('Give this task to someone (keep the split even).'),
          yourMove: true,
        };
      }
      if (
        sel === 'free' ||
        sel === 'all-to-one' ||
        (sel === 'crew-wanted' && d.chosen.length > 1)
      ) {
        const open = a.tasks.some((t) => !t.crew && t.owner === null);
        if (d.ready.includes(me))
          return {
            text: `Ready. ${waiting(people.filter((p) => !d.ready.includes(p)))}`,
            yourMove: false,
          };
        if (sel === 'all-to-one')
          return {
            text: open
              ? 'Agree out loud who takes every task, then they press “I’ll take them all”.'
              : 'Happy with who holds them? Press Ready.',
            yourMove: true,
          };
        return {
          text: open
            ? 'Talk about the tasks (never your cards) and take the ones you want.'
            : 'Every task has a holder. Press Ready when you agree.',
          yourMove: true,
        };
      }
      if (d.turn && mine(d.turn)) {
        if (sel === 'crew-wanted' || (sel === 'captain-offers' && d.turn !== a.captain))
          return {
            text: `Will you${forDummy(d.turn)} take every task? Answer yes or no.`,
            yourMove: true,
          };
        if (sel === 'captain-offers')
          return {
            text: say('Keep every task, or give them all to someone who said yes.'),
            yourMove: true,
          };
        return {
          text: `Your pick${forDummy(d.turn)}: take a task${d.canPass ? ', or pass' : ''}.`,
          yourMove: true,
        };
      }
      return {
        text: d.turn ? `${name(d.turn)} is choosing…` : 'Sharing out the tasks…',
        yourMove: false,
      };
    }
    case 'distress': {
      const p = a.distress.proposal;
      if (p) {
        if (a.distress.accepted.includes(me))
          return {
            text: `Waiting for everyone to agree: ${waiting(people.filter((x) => !a.distress.accepted.includes(x)))}`,
            yourMove: false,
          };
        return {
          text: say(
            `${name(p.by)} proposes a {distress}: everyone passes one card to the ${p.dir}. Agree?`,
          ),
          yourMove: true,
        };
      }
      if (a.distress.dive.includes(me))
        return {
          text: `Ready to dive. ${waiting(people.filter((x) => !a.distress.dive.includes(x)))}`,
          yourMove: false,
        };
      return {
        text: say('Dive in, or propose a {distress} if the crew wants one.'),
        yourMove: true,
      };
    }
    case 'pass': {
      const todo = a.controls.filter((s) => !a.distress.passed.includes(s));
      if (todo.length)
        return {
          text: say(
            `Pick a card${forDummy(todo[0]!)} to pass to the ${a.distress.dir} (never a {trump}).`,
          ),
          yourMove: true,
        };
      return {
        text: `Card chosen. ${waiting(crew.filter((s) => !a.distress.passed.includes(s)).map((s) => (s === DUMMY ? a.captain : s)))}`,
        yourMove: false,
      };
    }
    case 'predict': {
      const t = a.tasks.find(
        (x) => x.owner && mine(x.owner) && x.check.kind === 'predict' && x.prediction === null,
      );
      if (t)
        return {
          text: `How many tricks will you${forDummy(t.owner)} win? Name it before the first trick.`,
          yourMove: true,
        };
      return { text: 'Waiting for the predictions…', yourMove: false };
    }
    case 'play': {
      if (a.holds.length && !a.current.length)
        return {
          text: `${listNames(a.holds.map(name))} asked for a moment to signal.`,
          yourMove: a.holds.includes(me),
        };
      if (mine(a.turn)) {
        const led = a.current[0] ? suitOf(a.current[0].card) : null;
        const follow = led
          ? ` Follow ${led === 't' ? names.trump : SUIT_LOOK[led].name} if you can.`
          : ' You lead.';
        return { text: `Your turn${forDummy(a.turn)}: play a card.${follow}`, yourMove: true };
      }
      return { text: `🤫 ${name(a.turn)} is playing…`, yourMove: false };
    }
    case 'done': {
      const r = a.result!;
      if (r.success) return { text: `${missionLabel(a.mission.n)} complete!`, yourMove: false };
      return {
        text: `Lost: ${plainText(r.why ?? 'a task could not be met.', name, names)}`,
        yourMove: false,
      };
    }
  }
}

/** Whether a seat's turn is up for the viewer (their own seat, or the dummy for the captain). */
export const actingNow = (a: AttemptView, me: string) =>
  a.stage === 'play' && a.controls.includes(a.turn) && !!me;
