import type { Flow, FlowStep, Task, TenantDb } from '@mwc/db';
import { TASK_PAGE } from '@mwc/shared/flows';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { allowedActions, editRefusal, intoStepRefusal } from '../rules/access.ts';
import { cursorOf, cursorText, searchOf, statesOf } from '../rules/list.ts';
import { move } from '../rules/machine.ts';
import { FLOW_NOT_FOUND, type Refusal, refuse, TASK_NOT_FOUND, type TaskRef } from '../rules.ts';
import type {
  CreateTask,
  EditTask,
  TaskDetailView,
  TaskListQuery,
  TaskSummaryView,
} from '../schemas/tasks.ts';
import { applyMove, eventRow } from './apply.ts';
import { audit, type Caller } from './audit.ts';
import { type RunDeps, runStep } from './runs.ts';
import { rosterOf } from './team.ts';
import { conversationView, taskDetail, taskPrincipals, taskSummary } from './views.ts';

/** The tasks (S5.3a): the list, one task with its history, a new task, and an edit of its title, text or priority. */

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
  const conversations = chats.map((chat) =>
    conversationView(
      chat,
      byId,
      agents.get(chat.agentId),
      names,
      turns.filter((turn) => turn.chatId === chat.id),
      deps.steps?.away,
    ),
  );
  const artifacts = (await repo.artifacts.counts(t, [task.id])).get(task.id) ?? 0;
  return taskDetail(task, { flow, steps, events, names, actions, conversations, artifacts });
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
 * person. 404 `flow_not_found` for another company's flow. Its history starts with `created`.
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
      if (input.stepId !== undefined) {
        const denied = intoStepRefusal(caller, roster.team(flow.leadPrincipalId));
        if (denied) return denied;
        if (!steps.some((step) => step.id === input.stepId)) {
          return refuse(422, 'unknown_step', 'No such step in this flow');
        }
      }
      const values = {
        number: await repo.tasks.nextNumber(tx),
        flowId: flow.id,
        title: input.title,
        description: input.description ?? '',
        priority: input.priority ?? 'normal',
        createdBy: caller.principalId,
      };
      const task = await repo.tasks.insert(tx, values);
      await repo.tasks.insertEvents(tx, [eventRow(task.id, caller, { kind: 'created' })]);
      await audit(repo, tx, caller, { entityType: 'task', entityId: task.id, action: 'create', after: task });
      if (input.stepId === undefined) return { ok: true, task };
      return { ok: true, task: await routeNew(repo, tx, caller, { task, flow, steps, roster, input }) };
    },
  );
  if (!made.ok) return made;
  // Put straight into a step that starts by itself: its run starts now, outside the transaction.
  if (made.task.state === 'active' && made.task.stepState === 'working')
    await runStep(deps, repo, t, caller, made.task.id);
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
    readonly input: { readonly stepId?: string | undefined; readonly now: Date };
  },
): Promise<Task> {
  const { task, flow, steps, roster } = made;
  const transition = move(task, steps, { action: 'route', toStepId: made.input.stepId }, roster.isPerson);
  if (!transition.ok) throw new Error(`a new task could not enter its step: ${transition.code}`);
  const moved = { task, flow, from: undefined, roster, transition, action: 'route', now: made.input.now };
  return applyMove(repo, tx, caller, moved);
}

/**
 * Edits a task's title, description or priority (its creator, its team's Lead people, admins: 403 `not_yours`). Only
 * what differs is written, with an `edited` history row naming the fields and their audit rows.
 */
export async function editTask(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly ref: TaskRef | undefined; readonly edit: EditTask },
): Promise<TaskResult<403 | 404>> {
  const found = change.ref === undefined ? undefined : await repo.tasks.get(t, change.ref);
  if (found === undefined) return TASK_NOT_FOUND;
  const done = await t.transaction(async (tx): Promise<{ ok: true; task: Task } | Refusal<403>> => {
    const flow = (await repo.flows.lock(tx, found.flowId)) as Flow;
    const task = await repo.tasks.lock(tx, found.id);
    const denied = editRefusal(caller, (await rosterOf(tx)).team(flow.leadPrincipalId), task.createdBy);
    if (denied) return denied;
    const set = Object.fromEntries(
      Object.entries(change.edit).filter(
        ([field, value]) => value !== undefined && task[field as keyof Task] !== value,
      ),
    ) as Partial<Pick<Task, 'title' | 'description' | 'priority'>>;
    const fields = Object.keys(set);
    if (fields.length === 0) return { ok: true, task };
    const after = await repo.tasks.update(tx, task.id, set);
    await repo.tasks.insertEvents(tx, [eventRow(task.id, caller, { kind: 'edited', details: { fields } })]);
    await audit(repo, tx, caller, {
      entityType: 'task',
      entityId: task.id,
      action: 'update',
      before: task,
      after,
    });
    return { ok: true, task: after };
  });
  return done.ok ? { ok: true, task: await shownTask(deps, repo, t, caller, done.task) } : done;
}
