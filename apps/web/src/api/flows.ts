import type { InferRequestType, InferResponseType } from 'hono/client';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call, isApiError } from './errors.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A team's flow and its tasks (S5.3a, `/api/companies/:companyId/flows`, `/leads/:lead/flow` and `/tasks`): the flows,
 * one flow by its Lead, its board (read again every 30 seconds while the page is visible), its written form, a task
 * with its history and the caller's moves, and the changes. The types are inferred from the server's routes.
 */

type CompanyRoutes = Api['api']['companies'][':companyId'];
type FlowRoutes = CompanyRoutes['flows'];
type TaskRoutes = CompanyRoutes['tasks'];

export type FlowList = InferResponseType<FlowRoutes['$get'], 200>;
export type FlowSummary = FlowList['flows'][number];
export type Flow = InferResponseType<FlowRoutes[':flowId']['$get'], 200>;
export type FlowStep = Flow['steps'][number];
/** A person or an agent as flows and tasks name them (an agent's slug, for its page). */
export type PrincipalRef = Flow['lead'];
export type NewFlow = InferRequestType<FlowRoutes['$post']>['json'];
export type StepInput = NewFlow['steps'][number];
export type Board = InferResponseType<FlowRoutes[':flowId']['board']['$get'], 200>;
export type BoardColumn = Board['columns'][number];
export type BoardCard = BoardColumn['cards'][number];
export type TaskDetail = InferResponseType<TaskRoutes[':taskId']['$get'], 200>;
export type TaskEvent = TaskDetail['history'][number];
export type NewTask = InferRequestType<TaskRoutes['$post']>['json'];
export type TaskChanges = InferRequestType<TaskRoutes[':taskId']['$patch']>['json'];
export type TaskMove = InferRequestType<TaskRoutes[':taskId']['actions']['$post']>['json'];
export type TaskMoved = InferResponseType<TaskRoutes[':taskId']['actions']['$post'], 200>;

/** How often a board is read again while the page is visible. */
export const BOARD_EVERY_MS = 30_000;

const company = (api: Api) => api.api.companies[':companyId'];

/** The company's flows, oldest first. */
export function useFlows(companyId: string): Loaded<FlowList> {
  const api = useApi();
  return useLoad(`flows:${companyId}`, () => call(company(api).flows.$get({ param: { companyId } })));
}

/** A Lead's flow, by the Lead's principal id or an agent Lead's slug; null when the Lead has none yet. */
export function useLeadFlow(companyId: string, lead: string): Loaded<Flow | null> {
  const api = useApi();
  return useLoad(`lead-flow:${companyId}:${lead}`, () =>
    call(company(api).leads[':lead'].flow.$get({ param: { companyId, lead } })).catch((error: unknown) => {
      if (isApiError(error, 'flow_not_found')) return null;
      throw error;
    }),
  );
}

/** A flow by its id (a task's page draws it). */
export function useFlow(companyId: string, flowId: string | undefined): Loaded<Flow | null> {
  const api = useApi();
  return useLoad(`flow:${companyId}:${flowId ?? ''}`, async () =>
    flowId === undefined ? null : call(company(api).flows[':flowId'].$get({ param: { companyId, flowId } })),
  );
}

/**
 * A flow's board: Queued, each step, the latest `done` done tasks and Escalated; read again every 30 seconds while
 * the page is visible, and at once when it comes back into view.
 */
export function useFlowBoard(companyId: string, flowId: string, done?: number): Loaded<Board> {
  const api = useApi();
  const loaded = useLoad(`board:${companyId}:${flowId}:${done ?? ''}`, () =>
    call(
      company(api).flows[':flowId'].board.$get({
        param: { companyId, flowId },
        query: done === undefined ? {} : { done: String(done) },
      }),
    ),
  );
  useEvery(BOARD_EVERY_MS, loaded.reload);
  return loaded;
}

/** A flow's board without its done cards: the counts of its columns, for its card on the Flows page. */
export function useFlowCounts(companyId: string, flowId: string): Loaded<Board> {
  return useFlowBoard(companyId, flowId, 0);
}

/** A flow's written form; `version` (its last change) reads it again after an edit. */
export function useFlowText(companyId: string, flowId: string, version: string): Loaded<string> {
  const api = useApi();
  return useLoad(`flow-text:${companyId}:${flowId}:${version}`, async () => {
    const { text } = await call(company(api).flows[':flowId'].text.$get({ param: { companyId, flowId } }));
    return text;
  });
}

/** A task by its key (`T-12`) or id, with its history and the moves the caller may make. */
export function useTask(companyId: string, taskId: string): Loaded<TaskDetail> {
  const api = useApi();
  return useLoad(`task:${companyId}:${taskId}`, () =>
    call(company(api).tasks[':taskId'].$get({ param: { companyId, taskId } })),
  );
}

/** The flows' and tasks' changes in one company. */
export function flowCalls(api: Api, companyId: string) {
  const flows = company(api).flows;
  const tasks = company(api).tasks;
  return {
    createFlow: (flow: NewFlow) => call(flows.$post({ param: { companyId }, json: flow })),
    renameFlow: (flowId: string, name: string) =>
      call(flows[':flowId'].$patch({ param: { companyId, flowId }, json: { name } })),
    putSteps: (flowId: string, steps: StepInput[]) =>
      call(flows[':flowId'].steps.$put({ param: { companyId, flowId }, json: { steps } })),
    createTask: (task: NewTask) => call(tasks.$post({ param: { companyId }, json: task })),
    editTask: (taskId: string, changes: TaskChanges) =>
      call(tasks[':taskId'].$patch({ param: { companyId, taskId }, json: changes })),
    act: (taskId: string, move: TaskMove) =>
      call(tasks[':taskId'].actions.$post({ param: { companyId, taskId }, json: move })),
  };
}

export type FlowCalls = ReturnType<typeof flowCalls>;
