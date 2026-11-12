import { leadCheckInMessage, leadWakeMessage, stepEndText } from '@mwc/shared/flows';
import type { Room, RoomMember, RoomMessage } from '../../api/room.ts';
import { ago } from './flows/flow-sample.ts';

/**
 * A team room in the gallery (docs/processes.md "The team room"): Vega's DEVBOX delivery with Mason and Pip, Ihor and
 * Olena. Most Wanted's wake-up about a blocked task and Vega's reply, Mason's line when Develop ended, Olena asking the
 * team and two answers (Pip stayed silent), Ihor naming Mason, a check-in, and Pip answering now.
 */

const agent = (slug: string, name: string): RoomMember => ({
  principalId: `p-${slug}`,
  kind: 'agent',
  name,
  slug,
});
const person = (n: number, name: string): RoomMember => ({
  principalId: `p-${n}`,
  kind: 'person',
  name,
  slug: null,
});

const VEGA = agent('vega', 'Vega');
const MASON = agent('mason', 'Mason');
const PIP = agent('pip', 'Pip');
const IHOR = person(1, 'Ihor Herasko');
const OLENA = person(2, 'Olena Marsh');

let seq = 0;
const message = (
  kind: RoomMessage['kind'],
  author: RoomMember | null,
  body: string,
  minutes: number,
  more: Partial<RoomMessage> = {},
): RoomMessage => ({
  id: `rm-${++seq}`,
  kind,
  author,
  body,
  at: ago(minutes),
  task: null,
  step: null,
  to: [],
  asked: null,
  chatId: null,
  turnId: null,
  ...more,
});

const WAKE = leadWakeMessage({
  flow: 'DEVBOX delivery',
  person: 'Ihor Herasko',
  events: [
    {
      kind: 'blocked',
      task: { key: 'T-12', title: 'Fix the login on Safari' },
      step: 'Code review',
      reason: 'The Safari test needs a signed-in session cookie that the review machine does not have.',
    },
  ],
});

const CHECK_IN = leadCheckInMessage({
  flow: 'DEVBOX delivery',
  tasks: [
    {
      task: { key: 'T-12', title: 'Fix the login on Safari' },
      state: 'active',
      step: 'QA',
      stepState: 'working',
      minutes: 4,
      turn: 'live',
      reason: null,
    },
  ],
});

const STEP = { action: 'hand_on', from: 'Develop', to: 'Code review', round: 2 } as const;
const WORDS = 'fixture session added; the Safari test passes on the review machine';
const T12 = { id: 't-12', key: 'T-12', title: 'Fix the login on Safari' };

export const SAMPLE_ROOM: Room = {
  flow: { id: 'f-vega', name: 'DEVBOX delivery', leadPrincipalId: VEGA.principalId },
  members: { agents: [VEGA, MASON, PIP], people: [IHOR, OLENA] },
  mayWrite: true,
  messages: [
    message('notice', null, WAKE, 52),
    message(
      'reply',
      VEGA,
      'Asked Mason for a fixture session on the review machine; T-12 goes back to Code review once it lands.',
      51,
    ),
    message('step_end', MASON, stepEndText('T-12', STEP, WORDS), 34, {
      task: T12,
      step: { ...STEP, words: WORDS },
    }),
    message('message', OLENA, 'Can T-12 make today’s release?', 30, { asked: 3 }),
    message('reply', VEGA, 'Yes if QA passes within the hour; it is in QA now.', 29),
    message('reply', MASON, 'The fix is small: one fixture and a test. Low risk.', 29),
    message('message', IHOR, '@Mason add a note on the fixture to the PR description.', 12, {
      to: [MASON.principalId],
      asked: 1,
    }),
    message('reply', MASON, 'Added under **Testing** in the description.', 11),
    message('notice', null, CHECK_IN, 5),
    message('reply', VEGA, 'On track.', 5),
  ],
  nextBefore: null,
  replying: [{ principalId: PIP.principalId, status: 'running', machineWait: null }],
  cap: { maxPerHour: 30, askedLastHour: 4 },
};
