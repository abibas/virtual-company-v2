import { type DbHandle, diffFields, type Flow, type FlowStep, type Task, type TenantDb } from '@mwc/db';
import {
  artifactsFolder,
  type PromptArtifact,
  type StepPromptInput,
  stepFolder,
  stepPrompt,
  taskKey,
} from '@mwc/shared/flows';
import type { TaskTurns } from '../../chats/index.ts';
import { notify } from '../../notifications/service.ts';
import type { ArtifactRow, TasksRepo } from '../repo.ts';
import type { Transition } from '../rules/machine.ts';
import { runNotices } from '../rules/notices.ts';
import { arrivalOf, blocked, conversationTitle, previousEntryAt, type StepChange } from '../rules/runs.ts';
import { changeWake } from '../rules/wake.ts';
import { inOrder, roundsAt } from '../rules.ts';
import { eventRow } from './apply.ts';
import { AUDIT_IGNORED, type Caller } from './audit.ts';
import { writtenFlow } from './flows.ts';
import { rosterOf } from './team.ts';
import { recordWake } from './wake/record.ts';

/**
 * A step's run (S5.3b, docs/processes.md "Built in S5.3b"): once a move has started a task at an agent's step (a step
 * that starts by itself on entry, or Start), its turn starts in the step's conversation (`TaskTurns` of the chats
 * module) with the step's prompt (`stepPrompt` of `@mwc/shared/flows`), as the person whose move started it. A start
 * the chats refuse (no placement, no runner, no profile, …) blocks the task at the step with the refusal's words. Every
 * change a run makes to the task's step state is written here (`applyStepChange`), audited as the system's (or the
 * replier's) and told to the Lead's nearest person when it needs one; a block or a turn ended also wakes an agent Lead
 * (S6c), unless a person stopped the turn.
 */

export interface RunDeps {
  readonly db: DbHandle;
  /** The chats module's way to run a step; none: steps do not run (a task waits `working` at its step, as in S5.3a). */
  readonly steps?: TaskTurns | undefined;
}

/** True when a move started the task at its step (an entry that starts by itself, or Start). */
export const startedNow = (transition: Transition): boolean =>
  transition.task.stepState === 'working' && transition.events.some((event) => event.kind === 'started');

/** An artifact as a prompt lists it. */
const promptArtifact = (steps: ReadonlyMap<string, FlowStep>, row: ArtifactRow): PromptArtifact => {
  const step = steps.get(row.stepId);
  const folder = step ? stepFolder(step.position, step.name) : stepFolder(0, row.stepName);
  return { step: folder, round: row.round, name: row.name, kind: row.kind, size: row.size };
};

/** What a step's prompt says of the task at `step` now: all its artifacts, and those since the step's last round. */
export async function stepPromptInput(
  deps: RunDeps,
  repo: TasksRepo,
  t: TenantDb,
  task: Task,
  step: FlowStep,
) {
  const flow = (await repo.flows.get(t, task.flowId)) as Flow;
  const steps = inOrder(await repo.flows.steps(t, flow.id));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const history = await repo.tasks.events(t, task.id);
  const arrival = arrivalOf(history, step.id);
  const reply =
    arrival.fromStepId === null ? undefined : await repo.artifacts.lastNote(t, task.id, arrival.fromStepId);
  const kept = (await repo.artifacts.ofTask(t, task.id)).filter((row) => row.kind !== 'skipped');
  const since = previousEntryAt(history, step.id);
  const fresh = kept.filter(
    (row) => row.stepId !== step.id && (since === undefined || row.updatedAt >= since),
  );
  const round = roundsAt(task.rounds, step.id).entries;
  const flowText = await writtenFlow(deps, repo, t, flow);
  const input = (artifacts: readonly ArtifactRow[]): StepPromptInput => ({
    task: { key: taskKey(task.number), title: task.title, description: task.description },
    flowText,
    step: { name: step.name, kind: step.kind, position: step.position },
    next: steps[steps.findIndex((s) => s.id === step.id) + 1]?.name ?? null,
    sendsBackTo: step.sendsBackToStepId === null ? null : (byId.get(step.sendsBackToStepId)?.name ?? null),
    round,
    folder: artifactsFolder(task.number, step, round),
    handoff: {
      arrival: { kind: arrival.kind, from: arrival.from, reason: arrival.reason },
      reply: reply ?? null,
      artifacts: artifacts.map((row) => promptArtifact(byId, row)),
    },
  });
  return { round, all: input(kept), fresh: input(fresh) };
}

/**
 * The step's prompts: the full one for a new conversation and the delta for one that goes on, each written for a
 * runner without the agents' tools (`plain`) and for one with them (`tools`, S6a).
 */
async function prompts(deps: RunDeps, repo: TasksRepo, t: TenantDb, task: Task, step: FlowStep) {
  const { round, all, fresh } = await stepPromptInput(deps, repo, t, task, step);
  const written = (tools: boolean) => ({
    full: stepPrompt({ ...all, tools }, 'full'),
    delta: stepPrompt({ ...fresh, tools }, 'delta'),
  });
  return { round, prompt: { plain: written(false), tools: written(true) } };
}

/**
 * Runs the task's step after a move that started it (see above), outside the move's transaction: nothing unless the
 * task is still being worked on at an agent's step; a refused start blocks it.
 */
export async function runStep(deps: RunDeps, repo: TasksRepo, t: TenantDb, caller: Caller, taskId: string) {
  if (deps.steps === undefined) return;
  const task = await repo.tasks.get(t, { id: taskId });
  if (task?.state !== 'active' || task.stepState !== 'working' || task.currentStepId === null) return;
  const flow = (await repo.flows.get(t, task.flowId)) as Flow;
  const step = (await repo.flows.steps(t, flow.id)).find((s) => s.id === task.currentStepId) as FlowStep;
  if ((await repo.names.agentsOf(t, [step.assigneePrincipalId])).length === 0) return;
  const { round, prompt } = await prompts(deps, repo, t, task, step);
  const started = await deps.steps.start(t, {
    by: caller.principalId,
    requestId: caller.requestId,
    agentPrincipalId: step.assigneePrincipalId,
    taskId: task.id,
    stepId: step.id,
    round,
    keep: step.onReturn === 'keep',
    title: conversationTitle(taskKey(task.number), step.name, task.title),
    prompt,
  });
  if (!started.ok) await changeStep(repo, t, task, step.id, (now, at) => blocked(now, at, started.message));
}

/**
 * Who made a run's change: the person whose message started a turn, the step's agent whose decision blocked it (S6a,
 * `agent`), or nobody (it happened by itself).
 */
export interface ChangeBy {
  readonly principalId: string;
  readonly requestId: string | null;
  readonly agent?: boolean;
}

/**
 * Under the flow's and the task's locks, applies what `decide` makes of the task as it is now at the step (nothing when
 * it moved on, or the step is gone): the step state, the blocked reason, the history row, the audit rows, and the
 * notices of a turn that ended or a block.
 */
export function changeStep(
  repo: TasksRepo,
  t: TenantDb,
  task: Pick<Task, 'id' | 'flowId'>,
  stepId: string,
  decide: (task: Task, step: FlowStep) => StepChange | undefined,
  by: ChangeBy | null = null,
): Promise<void> {
  return t.transaction(async (tx) => {
    const flow = (await repo.flows.lock(tx, task.flowId)) as Flow;
    const now = await repo.tasks.lock(tx, task.id);
    const step = (await repo.flows.steps(tx, flow.id)).find((s) => s.id === stepId);
    const change = step && decide(now, step);
    if (step === undefined || change === undefined) return;
    await applyStepChange(repo, tx, { task: now, flow, step, change, by });
  });
}

/** Writes a run's change in the caller's transaction (see `changeStep`); a decision's block too (S6a). */
export async function applyStepChange(
  repo: TasksRepo,
  tx: TenantDb,
  move: {
    readonly task: Task;
    readonly flow: Flow;
    readonly step: FlowStep;
    readonly change: StepChange;
    readonly by: ChangeBy | null;
  },
): Promise<void> {
  const { task, flow, step, change, by } = move;
  const after = await repo.tasks.update(tx, task.id, {
    stepState: change.stepState,
    blockedReason: change.blockedReason,
    // The turn's decision (S6a) goes with any change of its step state: applied, dropped or past.
    decision: null,
  });
  await repo.tasks.insertEvents(tx, [eventRow(task.id, by, change.event)]);
  await repo.audit(tx, {
    actorKind: by === null ? 'system' : by.agent ? 'agent' : 'user',
    actorPrincipalId: by?.principalId ?? null,
    requestId: by?.requestId ?? null,
    entityType: 'task',
    entityId: task.id,
    action: change.event.kind,
    changes: diffFields(task, after, { ignore: AUDIT_IGNORED }),
  });
  if (change.stepState === 'working') return;
  const kind = change.stepState === 'blocked' ? 'task_blocked' : 'task_turn_ended';
  const roster = await rosterOf(tx);
  const leadPerson = roster.leadPerson(flow.leadPrincipalId);
  await notify(tx, by?.principalId ?? null, runNotices({ taskId: task.id, leadPerson, step, kind }));
  const reason = change.blockedReason ?? change.event.reason ?? null;
  const wake = { flow, roster, taskId: task.id, kind: changeWake(change), step: step.name, reason };
  await recordWake(repo, tx, wake);
}
