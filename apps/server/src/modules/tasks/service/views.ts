import type { Flow, FlowStep, Task, TaskEvent } from '@mwc/db';
import type { TaskAction } from '@mwc/shared/enums';
import { taskKey } from '@mwc/shared/flows';
import type { ConversationRow, ConversationTurnRow } from '../repo.ts';
import { inOrder, roundsAt } from '../rules.ts';
import type { BoardCardView } from '../schemas/board.ts';
import type { FlowSummaryView, FlowView, StepView } from '../schemas/flows.ts';
import type {
  TaskConversationView,
  TaskDecisionView,
  TaskDetailView,
  TaskEventView,
  TaskSummaryView,
} from '../schemas/tasks.ts';
import type { StepRef } from '../schemas.ts';
import type { Names } from './team.ts';

/** Rows as the API shows them (S5.3a); names come from the org module's `principalNames`, read before. */

export const stepRef = (step: Pick<FlowStep, 'id' | 'name' | 'kind'>): StepRef => ({
  id: step.id,
  name: step.name,
  kind: step.kind,
});

/** The principals a flow's view names: its Lead and its steps' assignees. */
export const flowPrincipals = (flow: Flow, steps: readonly FlowStep[]) => [
  flow.leadPrincipalId,
  ...steps.map((step) => step.assigneePrincipalId),
];

/** A flow with its steps in order, each with how many open tasks are at it. */
export function flowView(
  flow: Flow,
  steps: readonly FlowStep[],
  names: Names,
  open: ReadonlyMap<string, number>,
): FlowView {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const stepView = (step: FlowStep): StepView => ({
    id: step.id,
    position: step.position,
    name: step.name,
    kind: step.kind,
    assignee: names(step.assigneePrincipalId),
    starts: step.starts,
    onReturn: step.onReturn,
    sendsBackToStepId: step.sendsBackToStepId,
    sendsBackTo: step.sendsBackToStepId === null ? null : (byId.get(step.sendsBackToStepId)?.name ?? null),
    sendBackLimit: step.sendBackLimit,
    openTasks: open.get(step.id) ?? 0,
  });
  return {
    id: flow.id,
    name: flow.name,
    lead: names(flow.leadPrincipalId),
    steps: inOrder(steps).map(stepView),
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

export function flowSummary(flow: Flow, stepCount: number, openTasks: number, names: Names): FlowSummaryView {
  return {
    id: flow.id,
    name: flow.name,
    lead: names(flow.leadPrincipalId),
    stepCount,
    openTasks,
    createdAt: flow.createdAt.toISOString(),
    updatedAt: flow.updatedAt.toISOString(),
  };
}

/** Who has the task: its step's assignee, the Lead while escalated, nobody while queued or closed. */
export function holderOf(task: Task, step: FlowStep | undefined, leadPrincipalId: string): string | null {
  if (task.state === 'escalated') return leadPrincipalId;
  return task.state === 'active' && step ? step.assigneePrincipalId : null;
}

/** The principals a task's views name: its holder and its creator. */
export const taskPrincipals = (task: Task, step: FlowStep | undefined, leadPrincipalId: string) => [
  holderOf(task, step, leadPrincipalId),
  task.createdBy,
];

/** A task as lists show it; `steps` are its flow's, by id. */
export function taskSummary(
  task: Task,
  steps: ReadonlyMap<string, FlowStep>,
  leadPrincipalId: string,
  names: Names,
): TaskSummaryView {
  const step = task.currentStepId === null ? undefined : steps.get(task.currentStepId);
  const holder = holderOf(task, step, leadPrincipalId);
  return {
    id: task.id,
    key: taskKey(task.number),
    number: task.number,
    flowId: task.flowId,
    title: task.title,
    priority: task.priority,
    state: task.state,
    step: step ? stepRef(step) : null,
    stepState: task.stepState,
    blockedReason: task.blockedReason,
    round: step ? roundsAt(task.rounds, step.id).entries || null : null,
    assignee: holder === null ? null : names(holder),
    createdBy: names(task.createdBy),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    closedAt: task.closedAt?.toISOString() ?? null,
  };
}

export function eventView(event: TaskEvent, names: Names): TaskEventView {
  const named = (id: string | null, name: string | null) =>
    id === null ? null : { id, name: name ?? 'a removed step' };
  return {
    id: event.id,
    kind: event.kind,
    actor: event.actorPrincipalId === null ? null : names(event.actorPrincipalId),
    from: named(event.fromStepId, event.fromStepName),
    to: named(event.toStepId, event.toStepName),
    round: event.round,
    reason: event.reason,
    details: event.details,
    at: event.createdAt.toISOString(),
  };
}

/** A task with its description, flow, rounds, escalation, history and the caller's moves. */
export function taskDetail(
  task: Task,
  context: {
    readonly flow: Flow;
    readonly steps: readonly FlowStep[];
    readonly events: readonly TaskEvent[];
    readonly names: Names;
    readonly actions: readonly TaskAction[];
    /** Its steps' conversations (S5.3b), and how many artifacts it has. */
    readonly conversations: readonly TaskConversationView[];
    readonly artifacts: number;
  },
): TaskDetailView {
  const { flow, steps, names } = context;
  const byId = new Map(steps.map((step) => [step.id, step]));
  const rounds = inOrder(steps)
    .filter((step) => roundsAt(task.rounds, step.id).entries > 0)
    .map((step) => ({ step: stepRef(step), ...roundsAt(task.rounds, step.id) }));
  const retryTo = task.escalationTargetStepId ?? task.currentStepId;
  const retryStep = retryTo === null ? undefined : byId.get(retryTo);
  return {
    ...taskSummary(task, byId, flow.leadPrincipalId, names),
    description: task.description,
    flow: { id: flow.id, name: flow.name, lead: names(flow.leadPrincipalId) },
    rounds,
    escalation:
      task.escalationReason === null
        ? null
        : { reason: task.escalationReason, retryTo: retryStep ? stepRef(retryStep) : null },
    history: context.events.map((event) => eventView(event, names)),
    actions: [...context.actions],
    conversations: [...context.conversations],
    artifacts: context.artifacts,
    decision: decisionView(task, names),
  };
}

/** The decision its step's running turn recorded (S6a), as the task shows it; null for none. */
export function decisionView(task: Pick<Task, 'decision'>, names: Names): TaskDecisionView | null {
  const decision = task.decision;
  if (decision === null) return null;
  const to = decision.toStepId === null ? null : { id: decision.toStepId, name: decision.toStepName ?? '' };
  const { action, outcome, reason, at } = decision;
  return { action, outcome, to, reason, by: names(decision.by), at };
}

/** A task as the board shows it. */
export function boardCard(
  task: Task,
  steps: ReadonlyMap<string, FlowStep>,
  leadPrincipalId: string,
  names: Names,
  artifacts = 0,
  leadNotifiedAt: Date | null = null,
): BoardCardView {
  const summary = taskSummary(task, steps, leadPrincipalId, names);
  return {
    id: task.id,
    key: summary.key,
    title: task.title,
    priority: task.priority,
    round: summary.round,
    stepState: task.stepState,
    blockedReason: summary.blockedReason,
    assignee: summary.assignee,
    stepId: task.currentStepId,
    artifacts,
    leadNotifiedAt: leadNotifiedAt?.toISOString() ?? null,
    updatedAt: summary.updatedAt,
  };
}

/**
 * Where a conversation's turns stand: the running one's status, else the latest's, whether it waits for its stopped
 * machine to start, and whether a running one waits for its machine's runner to come back (`away`, S5.4); and its last
 * start or end.
 */
export function lastTurnOf(
  turns: readonly ConversationTurnRow[],
  away: (turnId: string) => boolean = () => false,
): TaskConversationView['lastTurn'] {
  if (turns.length === 0) return null;
  const latest = turns.reduce((a, b) => (b.seq > a.seq ? b : a));
  const shown = turns.find((turn) => turn.status === 'running') ?? latest;
  const at = Math.max(...turns.map((turn) => (turn.endedAt ?? turn.startedAt ?? turn.createdAt).getTime()));
  const waitsForMachine = shown.status === 'queued' && shown.machineWaitAt !== null;
  const reconnecting = shown.status === 'running' && away(shown.id);
  return { status: shown.status, at: new Date(at).toISOString(), waitsForMachine, reconnecting };
}

/** A step's conversation of the task: its chat, the step (by its name now), the round it began in, its agent. */
export function conversationView(
  row: ConversationRow,
  steps: ReadonlyMap<string, FlowStep>,
  agent: string | undefined,
  names: Names,
  turns: readonly ConversationTurnRow[] = [],
  away?: (turnId: string) => boolean,
): TaskConversationView {
  const stepId = row.taskStepId as string;
  return {
    chatId: row.id,
    step: { id: stepId, name: steps.get(stepId)?.name ?? 'a removed step' },
    round: row.taskRound as number,
    agent: agent === undefined ? null : names(agent),
    title: row.title,
    started: row.sessionId !== null,
    lastTurn: lastTurnOf(turns, away),
    createdAt: row.createdAt.toISOString(),
  };
}
