/**
 * The flows and tasks of a company (S5.3a), as `GET|POST /api/companies/:companyId/flows…` and `…/tasks…` answer them,
 * for `mwc task` and `mwc flow`. The shapes mirror the server's schemas (`apps/server/src/modules/tasks/schemas/`)
 * without importing the server; only what the commands read is checked.
 */
import { type ApiResult, apiCall, apiGet, type Fetch, isObject } from './client.ts';

/** A person or an agent as flows and tasks name them. */
export interface PrincipalRef {
  readonly principalId: string;
  readonly kind: string;
  readonly name: string;
  /** An agent's slug; null for a person. */
  readonly slug: string | null;
}

/** A flow as the list shows it. */
export interface FlowSummary {
  readonly id: string;
  readonly name: string;
  readonly lead: PrincipalRef;
  readonly stepCount: number;
  readonly openTasks: number;
}

/** A step of a flow. */
export interface FlowStep {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly kind: string;
  readonly assignee: PrincipalRef;
}

/** A flow with its steps in order. */
export interface Flow {
  readonly id: string;
  readonly name: string;
  readonly lead: PrincipalRef;
  readonly steps: readonly FlowStep[];
}

/** A task as the list shows it. */
export interface TaskSummary {
  readonly id: string;
  readonly key: string;
  readonly flowId: string;
  readonly title: string;
  readonly priority: string;
  readonly state: string;
  readonly step: { readonly id: string; readonly name: string; readonly kind: string } | null;
  readonly stepState: string | null;
  readonly round: number | null;
  readonly assignee: PrincipalRef | null;
  readonly createdBy: PrincipalRef;
  readonly createdAt: string;
}

/** One move in a task's history. */
export interface TaskEvent {
  readonly kind: string;
  readonly actor: PrincipalRef | null;
  readonly from: { readonly name: string } | null;
  readonly to: { readonly name: string } | null;
  readonly round: number | null;
  readonly reason: string | null;
  readonly at: string;
}

/** A task with its description, flow, escalation, history and the caller's moves. */
export interface TaskDetail extends TaskSummary {
  readonly description: string;
  readonly flow: { readonly id: string; readonly name: string; readonly lead: PrincipalRef };
  readonly escalation: { readonly reason: string; readonly retryTo: { readonly name: string } | null } | null;
  readonly history: readonly TaskEvent[];
  readonly actions: readonly string[];
}

/** A move's outcome and the task after it. */
export interface TaskMoved {
  readonly outcome: string;
  readonly task: TaskDetail;
}

const isRef = (value: unknown): value is PrincipalRef =>
  isObject(value) && typeof value.principalId === 'string' && typeof value.name === 'string';
const isFlowSummary = (value: unknown): value is FlowSummary =>
  isObject(value) && typeof value.id === 'string' && typeof value.name === 'string' && isRef(value.lead);
const isFlow = (value: unknown): value is Flow =>
  isFlowSummary(value) &&
  isObject(value) &&
  Array.isArray(value.steps) &&
  value.steps.every((step) => isObject(step) && typeof step.name === 'string');
const isTask = (value: unknown): value is TaskSummary =>
  isObject(value) &&
  typeof value.key === 'string' &&
  typeof value.title === 'string' &&
  isRef(value.createdBy);
const isDetail = (value: unknown): value is TaskDetail =>
  isTask(value) && Array.isArray((value as { history?: unknown }).history);

const path = (companyId: string, rest: string) => `/api/companies/${encodeURIComponent(companyId)}${rest}`;

/** `GET …/flows`. */
export async function listFlows(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
): Promise<ApiResult<readonly FlowSummary[]>> {
  const accept = (body: unknown): body is { flows: FlowSummary[] } =>
    isObject(body) && Array.isArray(body.flows) && body.flows.every(isFlowSummary);
  const result = await apiGet(fetch, server, key, path(companyId, '/flows'), accept);
  return result.ok ? { ok: true, body: result.body.flows } : result;
}

/** `GET …/flows/:flowId`. */
export const getFlow = (fetch: Fetch, server: string, key: string, companyId: string, flowId: string) =>
  apiGet(fetch, server, key, path(companyId, `/flows/${encodeURIComponent(flowId)}`), isFlow);

/** `GET …/flows/:flowId/text`: the flow's written form. */
export async function getFlowText(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
  flowId: string,
): Promise<ApiResult<string>> {
  const accept = (body: unknown): body is { text: string } => isObject(body) && typeof body.text === 'string';
  const result = await apiGet(
    fetch,
    server,
    key,
    path(companyId, `/flows/${encodeURIComponent(flowId)}/text`),
    accept,
  );
  return result.ok ? { ok: true, body: result.body.text } : result;
}

/** `GET …/tasks?flowId&state`: the newest tasks first. */
export async function listTasks(
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
  filter: { readonly flowId?: string | undefined; readonly state?: string | undefined },
): Promise<ApiResult<readonly TaskSummary[]>> {
  const query = new URLSearchParams();
  if (filter.flowId !== undefined) query.set('flowId', filter.flowId);
  if (filter.state !== undefined) query.set('state', filter.state);
  const accept = (body: unknown): body is { tasks: TaskSummary[] } =>
    isObject(body) && Array.isArray(body.tasks) && body.tasks.every(isTask);
  const rest = `/tasks${query.size > 0 ? `?${query}` : ''}`;
  const result = await apiGet(fetch, server, key, path(companyId, rest), accept);
  return result.ok ? { ok: true, body: result.body.tasks } : result;
}

/** `GET …/tasks/:key`. */
export const getTask = (fetch: Fetch, server: string, key: string, companyId: string, taskKey: string) =>
  apiGet(fetch, server, key, path(companyId, `/tasks/${encodeURIComponent(taskKey)}`), isDetail);

/** `POST …/tasks`: a new task, queued or straight into a step. */
export const createTask = (fetch: Fetch, server: string, key: string, companyId: string, body: object) =>
  apiCall(fetch, server, key, path(companyId, '/tasks'), isDetail, { method: 'POST', status: 201, body });

/** `POST …/tasks/:key/actions`: one move. */
export const moveTask = (
  fetch: Fetch,
  server: string,
  key: string,
  companyId: string,
  taskKey: string,
  body: object,
) =>
  apiCall(
    fetch,
    server,
    key,
    path(companyId, `/tasks/${encodeURIComponent(taskKey)}/actions`),
    (value: unknown): value is TaskMoved =>
      isObject(value) && typeof value.outcome === 'string' && isDetail(value.task),
    { method: 'POST', body },
  );
