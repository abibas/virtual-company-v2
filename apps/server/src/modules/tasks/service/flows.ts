import { type DbHandle, type Flow, type FlowStep, isUuid, type TenantDb } from '@mwc/db';
import { flowText } from '@mwc/shared/flows';
import type { TasksRepo } from '../repo.ts';
import { leadRefusal } from '../rules/access.ts';
import { planSteps, type StepInput } from '../rules/steps.ts';
import { FLOW_NOT_FOUND, inOrder, type Refusal, refuse } from '../rules.ts';
import type { CreateFlow, FlowSummaryView, FlowView } from '../schemas/flows.ts';
import { audit, type Caller } from './audit.ts';
import { writeSteps } from './steps.ts';
import { namesOf, rosterOf } from './team.ts';
import { flowPrincipals, flowSummary, flowView } from './views.ts';

/** A team's flow (S5.3a): listing, reading (by id, by Lead, written), making one, renaming it and its step list. */

type Deps = { readonly db: DbHandle };
export type FlowResult<S extends 403 | 404 | 409 | 422 = 403 | 404 | 409 | 422> =
  | { readonly ok: true; readonly flow: FlowView }
  | Refusal<S>;

/** A flow as the API shows it, its names and open tasks read now (outside any transaction). */
export async function shownFlow(deps: Deps, repo: TasksRepo, t: TenantDb, flow: Flow): Promise<FlowView> {
  const steps = await repo.flows.steps(t, flow.id);
  const names = await namesOf(deps.db, repo, t, flowPrincipals(flow, steps));
  return flowView(flow, steps, names, await repo.flows.openCounts(t, flow.id));
}

/** The company's flows, oldest first, with their Lead, step count and open tasks. */
export async function listFlows(deps: Deps, repo: TasksRepo, t: TenantDb): Promise<FlowSummaryView[]> {
  const rows = await repo.flows.list(t);
  const steps = await repo.flows.allSteps(t);
  const open = await repo.tasks.openByFlow(t);
  const names = await namesOf(
    deps.db,
    repo,
    t,
    rows.map((flow) => flow.leadPrincipalId),
  );
  const count = (flowId: string) => steps.filter((step) => step.flowId === flowId).length;
  return rows.map((flow) => flowSummary(flow, count(flow.id), open.get(flow.id) ?? 0, names));
}

/** The flow of this id, or of the Lead this principal id or agent slug names. */
export async function findFlow(
  repo: TasksRepo,
  t: TenantDb,
  ref: { readonly id: string } | { readonly lead: string },
): Promise<Flow | undefined> {
  if ('id' in ref) return repo.flows.get(t, ref.id);
  const lead = isUuid(ref.lead) ? ref.lead : await repo.names.agentBySlug(t, ref.lead);
  return lead === undefined ? undefined : repo.flows.byLead(t, lead);
}

/** The flow's written form (docs/processes.md), with its Lead's and assignees' names as they are now. */
export async function writtenFlow(deps: Deps, repo: TasksRepo, t: TenantDb, flow: Flow): Promise<string> {
  const steps = inOrder(await repo.flows.steps(t, flow.id));
  const names = await namesOf(deps.db, repo, t, flowPrincipals(flow, steps));
  const byId = new Map(steps.map((step) => [step.id, step]));
  return flowText({
    name: flow.name,
    lead: names(flow.leadPrincipalId).name,
    steps: steps.map((step) => ({
      name: step.name,
      kind: step.kind,
      who: names(step.assigneePrincipalId).name,
      whoKind: names(step.assigneePrincipalId).kind,
      onReturn: step.onReturn,
      sendsBackTo: step.sendsBackToStepId === null ? null : (byId.get(step.sendsBackToStepId)?.name ?? null),
      sendBackLimit: step.sendBackLimit,
    })),
  });
}

/**
 * Makes a team's flow with its steps, under the company's lock: the Lead must be on the chart (422 `lead_not_found`),
 * the caller one of its Lead people or an admin (403 `not_lead`), the Lead without a flow yet (409 `flow_exists`) and
 * the steps a valid list (422, `planSteps`). Audited.
 */
export async function createFlow(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  input: CreateFlow,
): Promise<FlowResult> {
  const made = await t.transaction(async (tx): Promise<{ ok: true; flow: Flow } | Refusal> => {
    await repo.lockCompany(tx);
    const roster = await rosterOf(tx);
    if (!roster.onChart(input.leadPrincipalId)) {
      return refuse(422, 'lead_not_found', 'The Lead must be an active person or agent on the org chart');
    }
    const denied = leadRefusal(caller, roster.team(input.leadPrincipalId));
    if (denied) return denied;
    if (await repo.flows.byLead(tx, input.leadPrincipalId)) {
      return refuse(409, 'flow_exists', 'This Lead has a flow already; change its steps instead');
    }
    const plan = planSteps(input.steps as StepInput[], { existing: new Set(), onChart: roster.onChart });
    if (!plan.ok) return plan;
    const values = {
      leadPrincipalId: input.leadPrincipalId,
      name: input.name,
      createdBy: caller.principalId,
    };
    const flow = await repo.flows.insert(tx, values);
    await audit(repo, tx, caller, { entityType: 'flow', entityId: flow.id, action: 'create', after: flow });
    await writeSteps(repo, tx, caller, { flow, before: [], plan });
    return { ok: true, flow };
  });
  return made.ok ? { ok: true, flow: await shownFlow(deps, repo, t, made.flow) } : made;
}

/** Locks the flow and checks the caller leads its team: the flow, its steps now and the roster; or the refusal. */
export async function lockedForLead(repo: TasksRepo, tx: TenantDb, caller: Caller, flowId: string) {
  const flow = await repo.flows.lock(tx, flowId);
  if (flow === undefined) return FLOW_NOT_FOUND;
  const roster = await rosterOf(tx);
  const denied = leadRefusal(caller, roster.team(flow.leadPrincipalId));
  if (denied) return denied;
  return { ok: true as const, flow, roster, steps: await repo.flows.steps(tx, flow.id) };
}

/** Renames a flow (its Lead people and admins). */
export async function renameFlow(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly flowId: string; readonly name: string },
): Promise<FlowResult<403 | 404>> {
  const done = await t.transaction(async (tx) => {
    const locked = await lockedForLead(repo, tx, caller, change.flowId);
    if (!locked.ok) return locked;
    if (locked.flow.name === change.name) return { ok: true as const, flow: locked.flow };
    const flow = await repo.flows.update(tx, locked.flow.id, { name: change.name });
    await audit(repo, tx, caller, {
      entityType: 'flow',
      entityId: flow.id,
      action: 'update',
      before: locked.flow,
      after: flow,
    });
    return { ok: true as const, flow };
  });
  return done.ok ? { ok: true, flow: await shownFlow(deps, repo, t, done.flow) } : done;
}

/** Replaces a flow's step list (its Lead people and admins): `planSteps`, then `writeSteps`. */
export async function putSteps(
  deps: Deps,
  repo: TasksRepo,
  t: TenantDb,
  caller: Caller,
  change: { readonly flowId: string; readonly steps: readonly StepInput[] },
): Promise<FlowResult> {
  const done = await t.transaction(async (tx): Promise<{ ok: true; flow: Flow } | Refusal> => {
    const locked = await lockedForLead(repo, tx, caller, change.flowId);
    if (!locked.ok) return locked;
    const existing = new Set(locked.steps.map((step: FlowStep) => step.id));
    const plan = planSteps(change.steps, { existing, onChart: locked.roster.onChart });
    if (!plan.ok) return plan;
    const written = await writeSteps(repo, tx, caller, { flow: locked.flow, before: locked.steps, plan });
    if (!written.ok) return written;
    return { ok: true, flow: await repo.flows.update(tx, locked.flow.id, { updatedAt: new Date() }) };
  });
  return done.ok ? { ok: true, flow: await shownFlow(deps, repo, t, done.flow) } : done;
}
