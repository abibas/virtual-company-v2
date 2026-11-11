import type { TaskEventKind } from '@mwc/shared/enums';
import { BLOCKED_REASON } from './flow-sample.ts';

/**
 * The gallery tasks' histories, oldest first, as the server writes them: T-12 in three rounds (a failed first turn, a
 * Code review and a QA send-back, then on to Ihor's Approve), T-14 escalated in its fourth round, T-15 blocked at QA,
 * T-16 waiting at Code review, T-17's turn ended there without a hand-off, T-18 working on its second round.
 */

export type EventSpec = readonly [
  kind: TaskEventKind,
  actor: string | null,
  from: string | null,
  to: string | null,
  minutes: number,
  extra?: { readonly round?: number; readonly reason?: string },
];

const H = 60;

const GATEWAY_401 =
  'The gateway refused the request: 401 Unauthorized. {"error":{"type":"authentication_error","message":"invalid ' +
  'x-api-key for the gateway at https://gateway.example.dev/v1/messages; the key was rotated on 2026-11-10 and the old ' +
  'one is no longer accepted. Ask an admin to update the access profile or pick another subscription."},' +
  '"request_id":"req_01J8"}';

const QA_REASON =
  'Safari 19 on iOS still loses the session after the redirect: the cookie has no Secure flag on the preview domain.';

export const LIMIT_REASON = 'The resize still drops the last line of the prompt.';

/** Into a step (a work step starts by itself, a check is started by Ihor). */
const into = (step: string, by: string, minutes: number, round: number): EventSpec[] => [
  ['entered', by, null, step, minutes, { round }],
  step === 's-dev' ? ['started', null, null, step, minutes] : ['started', 'p-1', null, step, minutes - 5],
];

/** Made by `by`, routed by Ihor into Develop. */
const opening = (by: string, minutes: number): EventSpec[] => [
  ['created', by, null, null, minutes],
  ['routed', 'p-1', null, 's-dev', minutes - 1],
  ...into('s-dev', 'p-1', minutes - 1, 1),
];

const T12: readonly EventSpec[] = [
  ...opening('p-1', 26 * H),
  ['blocked', null, null, 's-dev', 26 * H - 2, { round: 1, reason: GATEWAY_401 }],
  ['started', 'p-1', null, 's-dev', 25 * H],
  ['handed_on', 'p-mason', 's-dev', 's-review', 24 * H],
  ...into('s-review', 'p-mason', 24 * H, 1),
  [
    'sent_back',
    'p-juno',
    's-review',
    's-dev',
    18 * H,
    { reason: 'No test for the Safari cookie path: add one in auth.test.ts.' },
  ],
  ...into('s-dev', 'p-juno', 18 * H, 2),
  ['handed_on', 'p-mason', 's-dev', 's-review', 12 * H],
  ...into('s-review', 'p-mason', 12 * H, 2),
  ['passed', 'p-juno', 's-review', 's-qa', 10 * H],
  ...into('s-qa', 'p-juno', 10 * H, 1),
  ['sent_back', 'p-pip', 's-qa', 's-dev', 6 * H, { reason: QA_REASON }],
  ...into('s-dev', 'p-pip', 6 * H, 3),
  ['edited', 'p-1', null, null, 5 * H],
  ['handed_on', 'p-mason', 's-dev', 's-review', 3 * H],
  ...into('s-review', 'p-mason', 3 * H, 3),
  ['passed', 'p-juno', 's-review', 's-qa', 90],
  ...into('s-qa', 'p-juno', 90, 2),
  ['passed', 'p-pip', 's-qa', 's-approve', 9],
  ['entered', 'p-pip', null, 's-approve', 9, { round: 1 }],
];

/** Develop hands on, Code review sends it back with `reason`: one round of T-14. */
const reviewRound = (round: number, minutes: number, reason: string): EventSpec[] => [
  ['handed_on', 'p-mason', 's-dev', 's-review', minutes],
  ...into('s-review', 'p-mason', minutes, round),
  ['sent_back', 'p-juno', 's-review', 's-dev', minutes - 60, { reason }],
  ...into('s-dev', 'p-juno', minutes - 60, round + 1),
];

const T14: readonly EventSpec[] = [
  ['created', 'p-2', null, null, 50 * H],
  ['routed', 'p-1', null, 's-dev', 49 * H, { reason: 'Mason has the terminal context.' }],
  ...into('s-dev', 'p-1', 49 * H, 1),
  ...reviewRound(1, 40 * H, 'The fit addon is not loaded.'),
  ...reviewRound(2, 8 * H, 'Colours are wrong in dark mode.'),
  ...reviewRound(3, 3 * H, 'Scrollback is lost on reconnect.'),
  ['handed_on', 'p-mason', 's-dev', 's-review', 60],
  ...into('s-review', 'p-mason', 60, 4),
  ['escalated', 'p-juno', 's-review', 's-dev', 33, { reason: LIMIT_REASON }],
];

const T15: readonly EventSpec[] = [
  ...opening('p-2', 8 * H),
  ['handed_on', 'p-mason', 's-dev', 's-review', 6 * H],
  ...into('s-review', 'p-mason', 6 * H, 1),
  ['passed', 'p-juno', 's-review', 's-qa', 4 * H],
  ...into('s-qa', 'p-juno', 4 * H, 1),
  ['blocked', null, null, 's-qa', 3 * H, { round: 1, reason: BLOCKED_REASON }],
];

/** Through Develop to Code review, entered `minutes` ago. */
const toReview = (minutes: number): EventSpec[] => [
  ...opening('p-1', 6 * H),
  ['handed_on', 'p-mason', 's-dev', 's-review', minutes],
  ['entered', 'p-mason', null, 's-review', minutes, { round: 1 }],
];

const T18: readonly EventSpec[] = [
  ...opening('p-1', 5 * H),
  ['handed_on', 'p-mason', 's-dev', 's-review', 3 * H],
  ...into('s-review', 'p-mason', 3 * H, 1),
  [
    'sent_back',
    'p-juno',
    's-review',
    's-dev',
    20,
    { reason: 'The loop comes back when the session expires mid-redirect.' },
  ],
  ...into('s-dev', 'p-juno', 20, 2),
];

export const HISTORIES: Readonly<Record<string, readonly EventSpec[]>> = {
  'T-12': T12,
  'T-14': T14,
  'T-15': T15,
  'T-16': toReview(22),
  'T-17': [
    ...toReview(80),
    ['started', 'p-1', null, 's-review', 78],
    ['turn_ended', null, null, 's-review', 70, { round: 1 }],
  ],
  'T-18': T18,
};
