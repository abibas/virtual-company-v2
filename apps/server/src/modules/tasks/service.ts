import type { Flow, TenantDb } from '@mwc/db';
import { tasksRepo } from './repo.ts';
import type { StepInput } from './rules/steps.ts';
import { FLOW_NOT_FOUND, taskRef } from './rules.ts';
import type { CreateFlow, PatchFlow } from './schemas/flows.ts';
import type { RoomQuery } from './schemas/room.ts';
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
  patchFlow,
  putSteps,
  shownFlow,
  writtenFlow,
} from './service/flows.ts';
import { roomFeed } from './service/room/feed.ts';
import type { RoomDeps } from './service/room/members.ts';
import { sayInRoom } from './service/room/say.ts';
import { putRoomCap } from './service/room/settings.ts';
import type { RunDeps } from './service/runs.ts';
import { getSprint, listSprints, newSprint } from './service/sprints.ts';
import { editTask } from './service/edit.ts';
import { createTask, getTask, listTasks } from './service/tasks.ts';
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
 * written by the moves and the runs, and the tick that tells them (`leadWakes`, started by `createApp`). Each flow has a
 * team room (`service/room/`): its feed, a person's message that asks the team's agents through the chats module's
 * `team`, and its cap. Each flow runs in sprints (T-37, `service/sprints.ts`).
 */
export function tasksService(deps: RunDeps & Pick<RoomDeps, 'team'>) {
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
    /** A flow's sprints (T-37): the list, one with its report, and the next one started. */
    sprints: (t: TenantDb, flowId: string) => listSprints(deps, repo, t, flowId),
    sprint: (t: TenantDb, ref: { readonly flowId: string; readonly sprintId: string }) =>
      getSprint(deps, repo, t, ref),
    newSprint: (t: TenantDb, caller: Caller, input: { flowId: string; name?: string | undefined; now: Date }) =>
      newSprint(deps, repo, t, caller, input),
    createFlow: (t: TenantDb, caller: Caller, input: CreateFlow) => createFlow(deps, repo, t, caller, input),
    patchFlow: (t: TenantDb, caller: Caller, flowId: string, patch: PatchFlow, now: Date) =>
      patchFlow(deps, repo, t, caller, { flowId, patch, now }),
    putSteps: (t: TenantDb, caller: Caller, flowId: string, steps: readonly StepInput[]) =>
      putSteps(deps, repo, t, caller, { flowId, steps }),
    listTasks: (t: TenantDb, query: TaskListQuery) => listTasks(deps, repo, t, query),
    getTask: (t: TenantDb, caller: Caller, ref: string) => getTask(deps, repo, t, caller, taskRef(ref)),
    createTask: (t: TenantDb, caller: Caller, input: CreateTask, now: Date) =>
      createTask(deps, repo, t, caller, { ...input, now }),
    editTask: (t: TenantDb, caller: Caller, ref: string, edit: EditTask, now: Date) =>
      editTask(deps, repo, t, caller, { ref: taskRef(ref), edit, now }),
    act: (t: TenantDb, caller: Caller, ref: string, body: TaskActionRequest, now: Date) =>
      actOnTask(deps, repo, t, caller, { ref: taskRef(ref), body, now }),
    artifacts: (t: TenantDb, ref: string) => listArtifacts(deps, repo, t, taskRef(ref)),
    artifact: (t: TenantDb, ref: string, artifactId: string) =>
      artifactFile(repo, t, taskRef(ref), artifactId),
    leadWakes: (t: TenantDb, flowId: string, now: Date) => leadWakesOf(repo, t, flowId, now),
    putLeadWakes: (t: TenantDb, caller: Caller, flowId: string, settings: LeadWakeSettingsBody, now: Date) =>
      putLeadWakes(repo, t, caller, { flowId, settings, now }),
    room: (t: TenantDb, caller: Caller, read: { flowId: string; query: RoomQuery; now: Date }) =>
      roomFeed(deps, repo, t, caller, read),
    /** A person's message in the room, then the room as it stands. */
    async say(t: TenantDb, caller: Caller, said: { flowId: string; body: string; now: Date }) {
      const done = await sayInRoom(deps, repo, t, caller, said);
      return done.ok ? roomFeed(deps, repo, t, caller, { ...said, query: {} }) : done;
    },
    /** The room's cap changed, then the room as it stands. */
    async putRoomCap(t: TenantDb, caller: Caller, change: { flowId: string; maxPerHour: number; now: Date }) {
      const done = await putRoomCap(repo, t, caller, change);
      return done.ok ? roomFeed(deps, repo, t, caller, { ...change, query: {} }) : done;
    },
  };
}

export type TasksService = ReturnType<typeof tasksService>;
