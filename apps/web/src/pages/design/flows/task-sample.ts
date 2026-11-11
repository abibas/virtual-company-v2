import type { TaskAction, TaskEventKind, TaskState } from '@mwc/shared/enums';
import type { BoardColumn, Flow, TaskDetail, TaskEvent } from '../../../api/flows.ts';
import { ago, DESIGN, DEVBOX, ref, sampleBoard } from './flow-sample.ts';

/**
 * The gallery's tasks, as `GET /tasks/:key` would answer them for the owner: T-12 waiting for Ihor's sign-off after a
 * send-back in Code review, T-14 escalated over Code review's limit, and every other card of the sample boards with a
 * short history of its own.
 */

const DESCRIPTION = `Safari drops the session cookie after the redirect from the sign-in page, so the person lands on
the sign-in page again.

- Set \`SameSite=Lax\` on the session cookie
- Keep the \`redirect_url\` through the round trip
- Add a test for the Safari path in \`auth.test.ts\`

Reproduce: sign out, open \`/most-wanted/flows\` in Safari 19, sign in.`;

const stepOf = (flow: Flow, id: string) => {
  const step = flow.steps.find((s) => s.id === id);
  if (!step) throw new Error(`No sample step ${id}`);
  return step;
};

type EventSpec = readonly [
  kind: TaskEventKind,
  actor: string | null,
  from: string | null,
  to: string | null,
  minutes: number,
  extra?: { readonly round?: number; readonly reason?: string },
];

const historyOf = (flow: Flow, specs: readonly EventSpec[]): TaskEvent[] =>
  specs.map(([kind, actor, from, to, minutes, extra], index) => ({
    id: `e-${index}`,
    kind,
    actor: actor ? ref(actor) : null,
    from: from ? { id: from, name: stepOf(flow, from).name } : null,
    to: to ? { id: to, name: stepOf(flow, to).name } : null,
    round: extra?.round ?? null,
    reason: extra?.reason ?? null,
    details: {},
    at: ago(minutes),
  }));

const T12_HISTORY: readonly EventSpec[] = [
  ['created', 'p-1', null, null, 60 * 26],
  ['routed', 'p-1', null, 's-dev', 60 * 26 - 1],
  ['entered', 'p-1', null, 's-dev', 60 * 26 - 1, { round: 1 }],
  ['started', null, null, 's-dev', 60 * 26 - 1],
  ['handed_on', 'p-2', 's-dev', 's-review', 60 * 20],
  ['entered', 'p-2', null, 's-review', 60 * 20, { round: 1 }],
  [
    'sent_back',
    'p-2',
    's-review',
    's-dev',
    60 * 18,
    { reason: 'No test for the Safari cookie path: add one in auth.test.ts.' },
  ],
  ['entered', 'p-2', null, 's-dev', 60 * 18, { round: 2 }],
  ['started', null, null, 's-dev', 60 * 18],
  ['handed_on', 'p-2', 's-dev', 's-review', 60 * 3],
  ['entered', 'p-2', null, 's-review', 60 * 3, { round: 2 }],
  ['passed', 'p-2', 's-review', 's-qa', 90],
  ['entered', 'p-2', null, 's-qa', 90, { round: 1 }],
  ['passed', 'p-2', 's-qa', 's-approve', 9],
  ['entered', 'p-2', null, 's-approve', 9, { round: 1 }],
];

const LIMIT_REASON = 'The resize still drops the last line of the prompt.';
const T14_HISTORY: readonly EventSpec[] = [
  ['created', 'p-2', null, null, 60 * 50],
  ['routed', 'p-1', null, 's-dev', 60 * 49, { reason: 'Mason has the terminal context.' }],
  ['entered', 'p-1', null, 's-dev', 60 * 49, { round: 1 }],
  ['handed_on', 'p-2', 's-dev', 's-review', 60 * 40],
  ['sent_back', 'p-2', 's-review', 's-dev', 60 * 30, { reason: 'The fit addon is not loaded.' }],
  ['sent_back', 'p-2', 's-review', 's-dev', 60 * 6, { reason: 'Colours are wrong in dark mode.' }],
  ['sent_back', 'p-2', 's-review', 's-dev', 60 * 2, { reason: 'Scrollback is lost on reconnect.' }],
  ['escalated', 'p-2', 's-review', 's-dev', 33, { reason: LIMIT_REASON }],
];

/** The moves the owner may make on a task as it stands (the API's `actions`). */
function actionsOf(state: TaskState, column: BoardColumn): TaskAction[] {
  if (state === 'queued') return ['route', 'cancel'];
  if (state === 'escalated') return ['route', 'retry', 'cancel'];
  if (state !== 'active' || !column.step) return [];
  const card = column.cards[0];
  const start: TaskAction[] =
    card && card.stepState !== 'working' && card.stepState !== 'needs_person' ? ['start'] : [];
  const outcome: Record<string, TaskAction[]> = {
    work: ['hand_on'],
    check: ['pass', 'send_back'],
    signoff: ['approve', 'send_back'],
  };
  return [...start, ...(outcome[column.step.kind] ?? []), 'route', 'cancel'];
}

const STATE_OF: Readonly<Record<BoardColumn['kind'], TaskState>> = {
  queued: 'queued',
  step: 'active',
  done: 'done',
  escalated: 'escalated',
};

/** A sample task by its key, from the sample boards; undefined for a key on none. */
export function sampleTask(key: string): TaskDetail | undefined {
  for (const flow of [DEVBOX, DESIGN]) {
    const columns = sampleBoard(flow.id).columns;
    const column = columns.find((c) => c.cards.some((card) => card.key === key));
    const card = column?.cards.find((c) => c.key === key);
    if (!column || !card) continue;
    const state = STATE_OF[column.kind];
    const step = card.stepId ? stepOf(flow, card.stepId) : null;
    const at = step ? flow.steps.indexOf(step) : -1;
    const specs: readonly EventSpec[] =
      key === 'T-12' ? T12_HISTORY : key === 'T-14' ? T14_HISTORY : [['created', 'p-1', null, null, 60 * 30]];
    const rounds =
      key === 'T-12'
        ? [2, 2, 1, 1].map((entries, i) => ({ step: flow.steps[i], entries, sendBacks: i === 1 ? 1 : 0 }))
        : flow.steps.slice(0, at + 1).map((s, i) => ({
            step: s,
            entries: i === at ? (card.round ?? 1) : 1,
            sendBacks: key === 'T-14' && i === 1 ? 3 : 0,
          }));
    return {
      id: card.id,
      key: card.key,
      number: Number(key.slice(2)),
      flowId: flow.id,
      title: card.title,
      priority: card.priority,
      state,
      step: step ? { id: step.id, name: step.name, kind: step.kind } : null,
      stepState: card.stepState,
      round: card.round,
      assignee: card.assignee,
      createdBy: ref(specs[0]?.[1] ?? 'p-1'),
      createdAt: ago(specs[0]?.[4] ?? 60),
      updatedAt: card.updatedAt,
      closedAt: state === 'done' ? card.updatedAt : null,
      description: key === 'T-12' ? DESCRIPTION : '',
      flow: { id: flow.id, name: flow.name, lead: flow.lead },
      rounds: rounds.flatMap((r) =>
        r.step ? [{ ...r, step: { id: r.step.id, name: r.step.name, kind: r.step.kind } }] : [],
      ),
      escalation:
        state === 'escalated'
          ? {
              reason: `Code review sent it back 3 times already, its limit; this time: ${LIMIT_REASON}`,
              retryTo: { id: 's-dev', name: 'Develop', kind: 'work' },
            }
          : null,
      history: historyOf(flow, specs),
      actions: actionsOf(state, { ...column, cards: [card] }),
    };
  }
  return undefined;
}

/** The sample flow a task is in. */
export const sampleFlowOf = (task: TaskDetail): Flow => (task.flowId === DESIGN.id ? DESIGN : DEVBOX);
