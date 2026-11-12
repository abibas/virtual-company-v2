import type { Flow, TenantDb } from '@mwc/db';
import { tasksRepo } from './repo.ts';
import type { StepInput } from './rules/steps.ts';
import { FLOW_NOT_FOUND, taskRef } from './rules.ts';
import type { CreateFlow } from './schemas/flows.ts';
import type { CreateTask, EditTask, TaskActionRequest, TaskListQuery } from './schemas/tasks.ts';
import type { LeadWakeSettingsBody } from './schemas/wakes.ts';
import { actOnTask } from './service/actions.ts';
import { artifactFile, listArtifacts } from './service/artifacts.ts';
import type { Caller } from './service/audit.ts';
import { boardOf } from './service/board.ts';
import {
  createFlow,
  findFlow,
  listFlows,
  putSteps,
  renameFlow,
  shownFlow,
  writtenFlow,
} from './service/flows.ts';
import type { RunDeps } from './service/runs.ts';
import { createTask, editTask, getTask, listTasks } from './service/tasks.ts';
import { leadWakesOf, putLeadWakes } from './service/wake/settings.ts';

export { type Caller, callerOf } from './service/audit.ts';

/**
 * The tasks module's logic (S5.3a, docs/processes.md): a team's flow and its steps (`service/flows.ts`,
 * `service/steps.ts`), its tasks (`service/tasks.ts`), their moves (`service/actions.ts`, written by
 * `service/apply.ts`) and the board (`service/board.ts`). Reads name people through the identity module's service and
 * read the chart through the org module's (`service/team.ts`); changes run in one transaction under the flow's lock.
 * A move that starts a task at an agent's step runs it through the chats module's `steps` (S5.3b, `service/runs.ts`),
 * whose turns report back through `taskTurnHook` (`service/hook.ts`); the artifacts they leave are
 * `service/artifacts.ts`'s. Since S6c an agent Lead wakes up by itself (`service/wake/`): its settings here, the events
 * written by the moves and the runs, and the tick that tells them (`leadWakes`, started by `createApp`).
 */
export function tasksService(deps: RunDeps) {
  const repo = tasksRepo;
  /** A flow by reference, or the refusal. */
  const flowOr404 = async (t: TenantDb, ref: { readonly id: string } | { readonly lead: string }) => {
    const flow = await findFlow(repo, t, ref);
    return flow === undefined ? FLOW_NOT_FOUND : { ok: true as const, flow };
  };
  const shown = (t: TenantDb, flow: Flow) => shownFlow(deps, repo, t, flow);
  return {
    listFlows: (t: TenantDb) => listFlows(deps, repo, t),
    async flow(t: TenantDb, ref: { readonly id: string } | { readonly lead: string }) {
      const found = await flowOr404(t, ref);
      return found.ok ? { ok: true as const, flow: await shown(t, found.flow) } : found;
    },
    async flowText(t: TenantDb, flowId: string) {
      const found = await flowOr404(t, { id: flowId });
      return found.ok ? { ok: true as const, text: await writtenFlow(deps, repo, t, found.flow) } : found;
    },
    async board(t: TenantDb, flowId: string, done: number | undefined) {
      const found = await flowOr404(t, { id: flowId });
      return found.ok ? { ok: true as const, board: await boardOf(deps, repo, t, found.flow, done) } : found;
    },
    createFlow: (t: TenantDb, caller: Caller, input: CreateFlow) => createFlow(deps, repo, t, caller, input),
    renameFlow: (t: TenantDb, caller: Caller, flowId: string, name: string) =>
      renameFlow(deps, repo, t, caller, { flowId, name }),
    putSteps: (t: TenantDb, caller: Caller, flowId: string, steps: readonly StepInput[]) =>
      putSteps(deps, repo, t, caller, { flowId, steps }),
    listTasks: (t: TenantDb, query: TaskListQuery) => listTasks(deps, repo, t, query),
    getTask: (t: TenantDb, caller: Caller, ref: string) => getTask(deps, repo, t, caller, taskRef(ref)),
    createTask: (t: TenantDb, caller: Caller, input: CreateTask, now: Date) =>
      createTask(deps, repo, t, caller, { ...input, now }),
    editTask: (t: TenantDb, caller: Caller, ref: string, edit: EditTask) =>
      editTask(deps, repo, t, caller, { ref: taskRef(ref), edit }),
    act: (t: TenantDb, caller: Caller, ref: string, body: TaskActionRequest, now: Date) =>
      actOnTask(deps, repo, t, caller, { ref: taskRef(ref), body, now }),
    artifacts: (t: TenantDb, ref: string) => listArtifacts(deps, repo, t, taskRef(ref)),
    artifact: (t: TenantDb, ref: string, artifactId: string) =>
      artifactFile(repo, t, taskRef(ref), artifactId),
    leadWakes: (t: TenantDb, flowId: string, now: Date) => leadWakesOf(repo, t, flowId, now),
    putLeadWakes: (t: TenantDb, caller: Caller, flowId: string, settings: LeadWakeSettingsBody, now: Date) =>
      putLeadWakes(repo, t, caller, { flowId, settings, now }),
  };
}

export type TasksService = ReturnType<typeof tasksService>;
