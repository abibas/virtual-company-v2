import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  CreateTaskSchema,
  EditTaskSchema,
  TaskDetailSchema,
  TaskListQuerySchema,
  TaskListSchema,
} from '../schemas/tasks.ts';
import { CompanyParamsSchema, TaskParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';
import { INVALID, route } from './flows.ts';

/**
 * The tasks (S5.3a): `GET|POST /api/companies/{companyId}/tasks` and `GET|PATCH …/tasks/{taskId}` (`taskId`: the key,
 * `T-12`, or the id). Everyone of the company reads; members and above create (straight into a step: the Lead's
 * people and admins); a task's creator, its team's Lead people and admins edit it. Its moves are `routes/actions.ts`.
 */

const TASKS = '/api/companies/{companyId}/tasks' as const;
export const NO_TASK = errorResponse(
  'No such company or not an active member (`not_found`), or no such task (`task_not_found`)',
);

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', TASKS);
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'get',
    summary:
      "The company's tasks (viewer and above), newest first, by flow, state, step or assignee, a page at a time",
    request: { params: CompanyParamsSchema, query: TaskListQuerySchema },
    responses: {
      200: jsonResponse('A page of tasks', TaskListSchema),
      400: INVALID,
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const createTaskRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', TASKS);
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'post',
    summary:
      'Make a task in a flow (member and above): queued, or straight into a step (the Lead’s people, admins)',
    request: { params: CompanyParamsSchema, body: jsonBody(CreateTaskSchema) },
    responses: {
      201: jsonResponse('The task', TaskDetailSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse('Below member (`forbidden`), or a step without leading the team (`not_lead`)'),
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such flow (`flow_not_found`)',
      ),
      422: errorResponse('The step is not one of the flow’s (`unknown_step`)'),
    },
  });
};

const getTaskRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${TASKS}/{taskId}`);
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'get',
    summary: 'A task with its history and the moves the caller may make (viewer and above)',
    request: { params: TaskParamsSchema },
    responses: { 200: jsonResponse('The task', TaskDetailSchema), 401: refusals[401], 404: NO_TASK },
  });
};

const editTaskRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', `${TASKS}/{taskId}`);
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'patch',
    summary: "Edit a task's title, description or priority (its creator, its team's Lead people, admins)",
    request: { params: TaskParamsSchema, body: jsonBody(EditTaskSchema) },
    responses: {
      200: jsonResponse('The task', TaskDetailSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse('Below member (`forbidden`), or not its creator nor leading its team (`not_yours`)'),
      404: NO_TASK,
    },
  });
};

export function taskRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(listRoute(deps), async (c) =>
      c.json(await tasks.listTasks(c.var.tenant, c.req.valid('query')), 200),
    )
    .openapi(createTaskRoute(deps), async (c) => {
      const body = c.req.valid('json');
      const result = await tasks.createTask(c.var.tenant, callerOf(c.var), body, c.var.clock());
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.task, 201);
    })
    .openapi(getTaskRoute(deps), async (c) => {
      const result = await tasks.getTask(c.var.tenant, callerOf(c.var), c.req.valid('param').taskId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.task, 200);
    })
    .openapi(editTaskRoute(deps), async (c) => {
      const { taskId } = c.req.valid('param');
      const result = await tasks.editTask(c.var.tenant, callerOf(c.var), taskId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.task, 200);
    });
}
