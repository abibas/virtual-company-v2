import type { Flow, FlowStep, Task, TenantDb } from '@mwc/db';
import { TASK_PAGE } from '@mwc/shared/flows';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { allowedActions, intoStepRefusal } from '../rules/access.ts';
import { cursorOf, cursorText, searchOf, statesOf } from '../rules/list.ts';
import { move } from '../rules/machine.ts';
import { FLOW_NOT_FOUND, type Refusal, refuse, TASK_NOT_FOUND, type TaskRef } from '../rules.ts';
import type {
  CreateTask,
  TaskDetailView,
  TaskListQuery,
  TaskSummaryView,
} from '../schemas/tasks.ts';
import { applyMove, eventRow } from './apply.ts';
import { audit, type Caller } from './audit.ts';
import { takeQueued } from './auto-take.ts';
import { flowTasks, placedPriority, placeInQueue, placeTarget, setWaits } from './queue.ts';
import { type RunDeps, runStep } from './runs.ts';
import { rosterOf } from './team.ts';
import { conversationView, taskDetail, taskPrincipals, taskSummary } from './views.ts';

/** The tasks (S5.3a): the list, one task with its history, and a new task; an edit is `edit.ts`. */

type Deps = RunDeps;
export type TaskResult<S extends 403 | 404 | 409 | 422> =
  | { readonly ok: true; readonly task: TaskDetailView }
  | Refusal<S>;

/** A page of the company's tasks (`TaskListQuery`), with the next page's `before` and `cursor`. */
export async function listTasks(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  query: TaskListQuery,
): Promise<{ tasks: TaskSummaryView[]; nextBefore: number | null; nextCursor: string | null }> {
  const limit = query.limit ?? TASK_PAGE.default;
  const flows = await repo.flows.list(t);
  const steps = await repo.flows.allSteps(t);
  const assignee =
    query.assignee === undefined
      ? undefined
      : {
          stepIds: steps.filter((step) => step.assigneePrincipalId === query.assignee).map((step) => step.id),
          flowIds: flows.filter((flow) => flow.leadPrincipalId === query.assignee).map((flow) => flow.id),
        };
  const filter = {
    flowId: query.flowId,
    states: query.state === undefined ? undefined : statesOf(query.state),
    stepId: query.stepId,
    assignee,
    before: query.before,
    search: searchOf(query.q),
    sort: query.sort,
    after: query.cursor === undefined ? undefined : cursorOf(query.cursor),
  };
  const rows = await repo.tasks.page(t, filter, limit + 1);
  const kept = rows.slice(0, limit);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const leads = new Map(flows.map((flow) => [flow.id, flow.leadPrincipalId]));
  const lead = (task: Task) => leads.get(task.flowId) as string;
  const step = (task: Task) => (task.currentStepId === null ? undefined : byId.get(task.currentStepId));
  const names = await principalNames(
    deps.db,
    t,
    kept.flatMap((task) => taskPrincipals(task, step(task), lead(task))),
  );
  const last = rows.length > limit ? kept.at(-1) : undefined;
  return {
    tasks: kept.map((task) => taskSummary(task, byId, lead(task), names)),
    nextBefore: last?.number ?? null,
    nextCursor: last === undefined ? null : cursorText(last),
  };
}

/** A task as its page shows it to the caller, read now (outside any transaction). */
export async function shownTask(deps: Deps, repo: TasksRepo, t: TenantDb, caller: Caller, task: Task) {
  const flow = (await repo.flows.get(t, task.flowId)) as Flow;
  const steps = await repo.flows.steps(t, flow.id);
  const events = await repo.tasks.events(t, task.id);
  const roster = await rosterOf(t);
  const current = steps.find((step) => step.id === task.currentStepId);
  const chats = await repo.conversations.ofTask(t, task.id);
  const agents = new Map(
    (await repo.names.agentPrincipals(t, [...new Set(chats.map((chat) => chat.agentId))])).map((a) => [
      a.id,
      a.principalId,
    ]),
  );
  const ids = [
    flow.leadPrincipalId,
    ...taskPrincipals(task, current, flow.leadPrincipalId),
    ...events.map((event) => event.actorPrincipalId),
    ...agents.values(),
    task.decision?.by,
  ];
  const names = await principalNames(deps.db, t, ids);
  const actions = allowedActions(caller, roster.team(flow.leadPrincipalId), task, current);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const turns = await repo.conversations.turnsOf(
    t,
    chats.map((chat) => chat.id),
  );
  const machines = await repo.conversations.machineNames(t, [
    ...new Set(chats.map((chat) => chat.machineId)),
  ]);
  const conversations = chats.map((chat) =>
    conversationView(
      chat,
      byId,
      agents.get(chat.agentId),
      names,
      turns.filter((turn) => turn.chatId === chat.id),
      { away: deps.steps?.away, machine: machines.get(chat.machineId) ?? null },
    ),
  );
  const artifacts = (await repo.artifacts.counts(t, [task.id])).get(task.id) ?? 0;
  const waitsFor = (await repo.waits.of(t, [task.id])).get(task.id) ?? [];
  const queued = task.state === 'queued' ? await repo.tasks.queued(t, flow.id) : [];
  const place = queued.findIndex((row) => row.id === task.id) + 1;
  const queue = place > 0 ? { place, of: queued.length } : null;
  return taskDetail(task, { flow, steps, events, names, actions, conversations, artifacts, waitsFor, queue });
}

/** One task by id or key, with its history and the caller's moves; 404 for another company's or none. */
export async function getTask(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  ref: TaskRef | undefined,
): Promise<TaskResult<404>> {
  const task = ref === undefined ? undefined : await repo.tasks.get(t, ref);
  if (task === undefined) return TASK_NOT_FOUND;
  return { ok: true, task: await shownTask(deps, repo, t, caller, task) };
}

/**
 * Makes a task in a flow, numbered next in the company (under its lock): queued, or straight into a step of that
 * flow (the Lead's people and admins: 403 `not_lead`; 422 `unknown_step`), which tells the step's assignee when a
 * person. Where it goes and whether it is Autotake, when the creator does not say, are the flow's defaults (T-38; its
 * Lead chose them, so its step applies to anyone). 404 `flow_not_found` for another company's flow. Its history starts
 * with `created`; it joins the flow's current sprint (T-37), wherever it goes. It goes to the end of its priority in
 * Queued, or right after a queued task (`after`, taking its priority unless one is given), and may wait for tasks of its
 * flow (`waitsFor`, T-39: 422 `unknown_task` for another flow's).
 */
export async function createTask(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  input: CreateTask & { readonly now: Date },
): Promise<TaskResult<403 | 404 | 422>> {
  const made = await t.transaction(
    async (tx): Promise<{ ok: true; task: Task } | Refusal<403 | 404 | 422>> => {
      await repo.lockCompany(tx);
      const flow = await repo.flows.lock(tx, input.flowId);
      if (flow === undefined) return FLOW_NOT_FOUND;
      const roster = await rosterOf(tx);
      const steps = await repo.flows.steps(tx, flow.id);
      if (input.stepId != null) {
        const denied = intoStepRefusal(caller, roster.team(flow.leadPrincipalId));
        if (denied) return denied;
        if (!steps.some((step) => step.id === input.stepId)) {
          return refuse(422, 'unknown_step', 'No such step in this flow');
        }
      }
      // Left out: the flow's defaults (T-38).
      const stepId = input.stepId === undefined ? flow.newTaskStepId : input.stepId;
      // What it waits for and where it goes in Queued (T-39), checked before anything is written.
      const waits = await flowTasks(repo, tx, flow, input.waitsFor ?? []);
      if (!waits.ok) return waits;
      const place = stepId === null ? await placeTarget(repo, tx, flow, { id: '' }, { after: input.after }) : undefined;
      if (place !== undefined && !place.ok) return place;
      // It joins the flow's current sprint (T-37).
      const sprint = await repo.sprints.ensure(tx, flow);
      const values = {
        number: await repo.tasks.nextNumber(tx),
        flowId: flow.id,
        sprintId: sprint.id,
        title: input.title,
        description: input.description ?? '',
        priority: placedPriority(input.priority, place?.target, 'normal'),
        autoTake: input.autoTake ?? flow.newTaskAutoTake,
        createdBy: caller.principalId,
      };
      let task = await repo.tasks.insert(tx, values);
      if (waits.tasks.length > 0) await setWaits(repo, tx, task.id, waits.tasks);
      if (place !== undefined) {
        await placeInQueue(repo, tx, task, place);
        task = await repo.tasks.lock(tx, task.id);
      }
      await repo.tasks.insertEvents(tx, [eventRow(task.id, caller, { kind: 'created' })]);
      await audit(repo, tx, caller, { entityType: 'task', entityId: task.id, action: 'create', after: task });
      if (stepId === null) return { ok: true, task };
      const into = { stepId, now: input.now };
      return { ok: true, task: await routeNew(repo, tx, caller, { task, flow, steps, roster, input: into }) };
    },
  );
  if (!made.ok) return made;
  // Put straight into a step that starts by itself: its run starts now, outside the transaction.
  if (made.task.state === 'active' && made.task.stepState === 'working')
    await runStep(deps, repo, t, caller, made.task.id);
  // Made in Queued: the flow takes it (or an earlier one) when it auto-takes and has room (T-25).
  if (made.task.state === 'queued') await takeQueued(deps, repo, t, made.task.flowId, input.now);
  const now = (await repo.tasks.get(t, { id: made.task.id })) as Task;
  return { ok: true, task: await shownTask(deps, repo, t, caller, now) };
}

/** A new task put straight into a step: the Lead's `route`, written as any move. */
async function routeNew(
  repo: TasksRepo,
  tx: TenantDb,
  caller: Caller,
  made: {
    readonly task: Task;
    readonly flow: Flow;
    readonly steps: readonly FlowStep[];
    readonly roster: Awaited<ReturnType<typeof rosterOf>>;
    readonly input: { readonly stepId: string; readonly now: Date };
  },
): Promise<Task> {
  const { task, flow, steps, roster } = made;
  const transition = move(task, steps, { action: 'route', toStepId: made.input.stepId }, roster.isPerson);
  if (!transition.ok) throw new Error(`a new task could not enter its step: ${transition.code}`);
  const moved = { task, flow, from: undefined, roster, transition, action: 'route', now: made.input.now };
  return applyMove(repo, tx, caller, moved);
}
