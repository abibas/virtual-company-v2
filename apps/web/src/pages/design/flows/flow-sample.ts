import type { FlowStepKind, StepOnReturn, TaskPriority, TaskStepState } from '@mwc/shared/enums';
import { flowText } from '@mwc/shared/flows';
import type { Board, BoardCard, BoardColumn, Flow, FlowList, PrincipalRef } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { nodeName } from '../../../components/org/chart.ts';
import { SAMPLE_CHART } from '../org-sample.ts';

/**
 * The flows of the gallery, on the sample chart: Vega's "DEVBOX delivery" (Develop by Mason, Code review by Juno, QA
 * by Pip, Approve by Ihor) with a task in every state, and Olena's "Design review"; Ihor manages without a flow yet.
 */

/** A moment `minutes` before now, so the cards read "5 min ago" whenever the gallery is opened. */
export const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

const node = (principalId: string): ChartNode => {
  const found = SAMPLE_CHART.nodes.find((n) => n.principalId === principalId);
  if (!found) throw new Error(`No sample node ${principalId}`);
  return found;
};

/** A sample principal as the flows' API names it. */
export const ref = (principalId: string): PrincipalRef => {
  const n = node(principalId);
  return { principalId, kind: n.kind, name: nodeName(n), slug: n.kind === 'agent' ? n.agent.slug : null };
};

type StepSpec = readonly [
  id: string,
  name: string,
  kind: FlowStepKind,
  who: string,
  onReturn: StepOnReturn,
  back: string | null,
  limit: number | null,
  open: number,
];

const flowOf = (id: string, name: string, lead: string, specs: readonly StepSpec[]): Flow => ({
  id,
  name,
  lead: ref(lead),
  steps: specs.map(([stepId, stepName, kind, who, onReturn, back, limit, open], index) => ({
    id: stepId,
    position: index + 1,
    name: stepName,
    kind,
    assignee: ref(who),
    starts: kind === 'work' ? 'auto' : 'manual',
    onReturn,
    sendsBackToStepId: back,
    sendsBackTo: specs.find((spec) => spec[0] === back)?.[1] ?? null,
    sendBackLimit: limit,
    openTasks: open,
  })),
  createdAt: ago(60 * 24 * 9),
  updatedAt: ago(60 * 26),
});

export const DEVBOX = flowOf('f-devbox', 'DEVBOX delivery', 'p-vega', [
  ['s-dev', 'Develop', 'work', 'p-mason', 'keep', null, null, 2],
  ['s-review', 'Code review', 'check', 'p-juno', 'keep', 's-dev', 3, 4],
  ['s-qa', 'QA', 'check', 'p-pip', 'fresh', 's-dev', 2, 1],
  ['s-approve', 'Approve', 'signoff', 'p-1', 'keep', 's-dev', null, 1],
]);

export const DESIGN = flowOf('f-design', 'Design review', 'p-2', [
  ['s-draft', 'Draft', 'work', 'p-3', 'keep', null, null, 1],
  ['s-signoff', 'Sign-off', 'signoff', 'p-2', 'keep', 's-draft', null, 0],
]);

export const SAMPLE_FLOWS: readonly Flow[] = [DEVBOX, DESIGN];

/** `GET /flows` on the samples. */
export const SAMPLE_FLOW_LIST: FlowList = {
  flows: SAMPLE_FLOWS.map((flow) => ({
    id: flow.id,
    name: flow.name,
    lead: flow.lead,
    stepCount: flow.steps.length,
    openTasks: flow.steps.reduce((sum, step) => sum + step.openTasks, 0) + (flow === DEVBOX ? 2 : 1),
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  })),
};

type CardSpec = readonly [
  n: number,
  title: string,
  priority: TaskPriority,
  state: TaskStepState | null,
  round: number | null,
  minutes: number,
];

/** Why the sample's blocked task is blocked (its card's tooltip, its page's notice). */
export const BLOCKED_REASON = "The agent's machine has no connected runner";

const card = (
  [n, title, priority, state, round, minutes]: CardSpec,
  holder: string | null,
  step: string | null,
) =>
  ({
    id: `t-${n}`,
    key: `T-${n}`,
    title,
    priority,
    round,
    stepState: state,
    blockedReason: state === 'blocked' ? BLOCKED_REASON : null,
    assignee: holder ? ref(holder) : null,
    stepId: step,
    artifacts: round === null ? 0 : round + 1,
    // The escalated and blocked samples show the "Lead notified" mark (S6c).
    leadNotifiedAt:
      state === 'blocked' || (state === null && round !== null) ? ago(Math.max(0, minutes - 1)) : null,
    updatedAt: ago(minutes),
  }) satisfies BoardCard;

const column = (
  kind: BoardColumn['kind'],
  title: string,
  cards: BoardCard[],
  total = cards.length,
): BoardColumn => ({
  kind,
  title,
  step: null,
  cards,
  total,
});

/** A step's column, its cards at it with its assignee. */
function stepColumn(flow: Flow, stepId: string, specs: readonly CardSpec[]): BoardColumn {
  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`No sample step ${stepId}`);
  const cards = specs.map((spec) => card(spec, step.assignee.principalId, step.id));
  return {
    ...column('step', step.name, cards),
    step: { id: step.id, kind: step.kind, assignee: step.assignee },
  };
}

const DEVBOX_BOARD: Board = {
  flow: { id: DEVBOX.id, name: DEVBOX.name, lead: DEVBOX.lead },
  columns: [
    column('queued', 'Queued', [
      card([21, 'Rate-limit the public API', 'high', null, null, 40], null, null),
      card([22, 'Dark mode for the billing page', 'low', null, null, 300], null, null),
    ]),
    stepColumn(DEVBOX, 's-dev', [
      [18, 'Fix the login redirect loop', 'urgent', 'working', 2, 4],
      [19, 'Add the CSV export to the members list', 'normal', 'waiting', 1, 95],
    ]),
    stepColumn(DEVBOX, 's-review', [
      [16, 'Retry failed webhooks with a backoff', 'normal', 'waiting', 1, 22],
      [17, 'Cache the org chart for a minute', 'normal', 'ended_without_handoff', 1, 70],
      [20, 'Show the runner version on the machine card', 'low', 'working', 2, 12],
    ]),
    stepColumn(DEVBOX, 's-qa', [[15, 'Send invitations through the outbox', 'high', 'blocked', 1, 180]]),
    stepColumn(DEVBOX, 's-approve', [[12, 'Fix the login on Safari', 'high', 'needs_person', 1, 9]]),
    column(
      'done',
      'Done',
      [
        card([11, 'Paginate the notifications', 'normal', null, null, 60 * 5], null, null),
        card([10, 'Rename a flow', 'low', null, null, 60 * 20], null, null),
        card([9, 'Keep the chart zoom per company', 'normal', null, null, 60 * 30], null, null),
      ],
      14,
    ),
    column('escalated', 'Escalated', [
      card([14, 'Upgrade the terminal to xterm 6', 'normal', null, 3, 33], 'p-vega', 's-review'),
    ]),
  ],
};

const DESIGN_BOARD: Board = {
  flow: { id: DESIGN.id, name: DESIGN.name, lead: DESIGN.lead },
  columns: [
    column('queued', 'Queued', [card([23, 'New empty states', 'normal', null, null, 500], null, null)]),
    stepColumn(DESIGN, 's-draft', [[24, 'The flows page in dark mode', 'normal', 'working', 1, 15]]),
    stepColumn(DESIGN, 's-signoff', []),
    column('done', 'Done', [], 3),
    column('escalated', 'Escalated', []),
  ],
};

/** A sample flow's board by its id. */
export const sampleBoard = (flowId: string): Board => (flowId === DESIGN.id ? DESIGN_BOARD : DEVBOX_BOARD);

/** A sample flow's written form, by the same `flowText` the server writes it with. */
export const sampleText = (flow: Flow): string =>
  flowText({
    name: flow.name,
    lead: flow.lead.name,
    steps: flow.steps.map((step) => ({
      name: step.name,
      kind: step.kind,
      who: step.assignee.name,
      whoKind: step.assignee.kind,
      onReturn: step.onReturn,
      sendsBackTo: step.sendsBackTo,
      sendBackLimit: step.sendBackLimit,
    })),
  });
