import type { DbHandle, FlowStep, Sprint, SprintReport, Task, TenantDb } from '@mwc/db';
import { taskKey } from '@mwc/shared/flows';
import { principalNames } from '../../org/index.ts';
import type { TasksRepo } from '../repo.ts';
import { FLOW_NOT_FOUND, type Refusal, refuse } from '../rules.ts';
import type { SprintSummaryView, SprintView } from '../schemas/sprints.ts';
import { audit, type Caller } from './audit.ts';
import { lockedForLead } from './flows.ts';
import type { Names } from './team.ts';

/**
 * A flow's sprints (T-37): each flow always has one current sprint, which every open task belongs to. A new sprint
 * (those who lead the team) ends the current one under the flow's lock, writing its report, starts the next one and
 * carries every open task over into it; the closed ones stay where they closed. Running turns and Autotake go on.
 */

type Deps = { readonly db: DbHandle };

const SPRINT_NOT_FOUND = refuse(404, 'sprint_not_found', 'No such sprint in this flow');

/** "Sprint 4 · Mon 16 Nov": a new sprint's name when none is given (the web sends one in the person's own time zone). */
export const defaultSprintName = (number: number, at: Date): string =>
  `Sprint ${number} · ${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

/** Where an open task is: Queued, its step, or escalated from its step. */
function whereOf(task: Task, steps: ReadonlyMap<string, FlowStep>): string {
  if (task.state === 'queued') return 'Queued';
  const step = task.currentStepId === null ? undefined : steps.get(task.currentStepId);
  const name = step?.name ?? 'a removed step';
  return task.state === 'escalated' ? `Escalated from ${name}` : name;
}

const closedRow = (task: Task) => ({
  key: taskKey(task.number),
  title: task.title,
  priority: task.priority,
  closedAt: (task.closedAt ?? task.updatedAt).toISOString(),
});

/**
 * The sprint's report as it stands now: its done and cancelled tasks (the latest closed first), the open tasks of the
 * flow it carries over (only while it is current) and how many tasks the flow made while it ran.
 */
export async function reportNow(
  repo: TasksRepo,
  t: TenantDb,
  sprint: Sprint,
  steps: readonly FlowStep[],
): Promise<SprintReport> {
  const closed = await repo.sprints.closed(t, sprint.id);
  const open = sprint.endedAt === null ? await repo.sprints.open(t, sprint.flowId) : [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  return {
    done: closed.filter((task) => task.state === 'done').map(closedRow),
    cancelled: closed.filter((task) => task.state === 'cancelled').map(closedRow),
    carriedOver: open.map((task) => ({
      key: taskKey(task.number),
      title: task.title,
      where: whereOf(task, byId),
    })),
    created: await repo.sprints.createdBetween(t, sprint.flowId, sprint.startedAt, sprint.endedAt),
  };
}

/** The report of a sprint: the one written when it ended, or the current one's so far. */
const reportOf = async (repo: TasksRepo, t: TenantDb, sprint: Sprint, steps: readonly FlowStep[]) =>
  sprint.report ?? (await reportNow(repo, t, sprint, steps));

function summary(sprint: Sprint, report: SprintReport, names: Names): SprintSummaryView {
  return {
    id: sprint.id,
    number: sprint.number,
    name: sprint.name,
    current: sprint.endedAt === null,
    startedAt: sprint.startedAt.toISOString(),
    startedBy: names(sprint.startedBy),
    endedAt: sprint.endedAt?.toISOString() ?? null,
    endedBy: sprint.endedBy === null ? null : names(sprint.endedBy),
    done: report.done.length,
    cancelled: report.cancelled.length,
    carriedOver: report.carriedOver.length,
    created: report.created,
  };
}

const namesOf = (deps: Deps, t: TenantDb, sprints: readonly Sprint[]) =>
  principalNames(
    deps.db,
    t,
    sprints.flatMap((sprint) => [sprint.startedBy, sprint.endedBy]),
  );

/** The flow's sprints, the newest first, each with its counts (the current one's so far). */
export async function listSprints(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  flowId: string,
): Promise<{ ok: true; sprints: SprintSummaryView[] } | Refusal<404>> {
  const flow = await repo.flows.get(t, flowId);
  if (flow === undefined) return FLOW_NOT_FOUND;
  const steps = await repo.flows.steps(t, flow.id);
  await repo.sprints.ensure(t, flow);
  const rows = await repo.sprints.list(t, flow.id);
  const names = await namesOf(deps, t, rows);
  const sprints = [];
  for (const sprint of rows) sprints.push(summary(sprint, await reportOf(repo, t, sprint, steps), names));
  return { ok: true, sprints };
}

/** One of the flow's sprints with its report. */
export async function getSprint(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  ref: { readonly flowId: string; readonly sprintId: string },
): Promise<{ ok: true; sprint: SprintView } | Refusal<404>> {
  const flow = await repo.flows.get(t, ref.flowId);
  if (flow === undefined) return FLOW_NOT_FOUND;
  const sprint = await repo.sprints.get(t, flow.id, ref.sprintId);
  if (sprint === undefined) return SPRINT_NOT_FOUND;
  return { ok: true, sprint: await shownSprint(deps, repo, t, sprint) };
}

async function shownSprint(deps: Deps, repo: TasksRepo, t: TenantDb, sprint: Sprint): Promise<SprintView> {
  const report = await reportOf(repo, t, sprint, await repo.flows.steps(t, sprint.flowId));
  const names = await namesOf(deps, t, [sprint]);
  return { ...summary(sprint, report, names), report: { ...report } } as SprintView;
}

/**
 * Starts the flow's next sprint (its Lead people and admins: 403 `not_lead`), in one transaction under the flow's
 * lock: the current sprint ends (by the caller, now) with its report written, the next one starts (numbered next,
 * named `name` or "Sprint N · Mon 16 Nov"), and every open task (queued, active, escalated) moves into it; the closed
 * ones stay in the sprint they closed in. Both sprints are audited.
 */
export async function newSprint(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  input: { readonly flowId: string; readonly name?: string | undefined; readonly now: Date },
): Promise<{ ok: true; sprint: SprintView } | Refusal<403 | 404>> {
  const done = await t.transaction(async (tx): Promise<{ ok: true; sprint: Sprint } | Refusal<403 | 404>> => {
    const locked = await lockedForLead(repo, tx, caller, input.flowId);
    if (!locked.ok) return locked;
    const { flow, steps } = locked;
    const current = await repo.sprints.ensure(tx, flow, true);
    const report = await reportNow(repo, tx, current, steps);
    const ended = await repo.sprints.update(tx, current.id, {
      endedAt: input.now,
      endedBy: caller.principalId,
      report,
    });
    const number = current.number + 1;
    const next = await repo.sprints.insert(tx, {
      flowId: flow.id,
      number,
      name: input.name ?? defaultSprintName(number, input.now),
      startedAt: input.now,
      startedBy: caller.principalId,
    });
    await repo.sprints.carryOver(tx, flow.id, next.id);
    await audit(repo, tx, caller, {
      entityType: 'sprint',
      entityId: current.id,
      action: 'end',
      before: current,
      after: ended,
    });
    await audit(repo, tx, caller, { entityType: 'sprint', entityId: next.id, action: 'create', after: next });
    return { ok: true, sprint: next };
  });
  if (!done.ok) return done;
  return { ok: true, sprint: await shownSprint(deps, repo, t, done.sprint) };
}
