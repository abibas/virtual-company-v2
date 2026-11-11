import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { TaskActionSchema, TaskMovedSchema } from '../schemas/tasks.ts';
import { TaskParamsSchema } from '../schemas.ts';
import { callerOf, type TasksService } from '../service.ts';
import { INVALID, route } from './flows.ts';
import { NO_TASK } from './tasks.ts';

/** A task's moves (S5.3a): `POST /api/companies/{companyId}/tasks/{taskId}/actions`, one endpoint for every move. */

const actRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', '/api/companies/{companyId}/tasks/{taskId}/actions');
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'post',
    summary: 'Move a task (member and above): start it, its step’s outcome, or a Lead’s move',
    description:
      '`start`; `hand_on` (Work), `pass` (Check), `approve` (Sign-off): to the next step, or done after the last; ' +
      '`send_back` (Check, Sign-off; `reason` required): to the step it names, or, over its limit, escalated to the ' +
      'Lead (`outcome: escalated`, not a refusal); and the Lead’s people’s and admins’ `route` (`toStepId`: a queued, ' +
      'active or escalated task into that step), `retry` (an escalated task back into the send-back it stopped, ' +
      'with a fresh count) and `cancel`. A step’s assignee, when a person, makes the moves at their step. A move that ' +
      'starts the task at an agent’s step (an entry into a step that starts by itself, or `start`) starts its turn ' +
      '(S5.3b); a start that cannot run leaves the task `blocked` with why. While the step’s turn runs, a move needs ' +
      '`force`, which stops the turn.',
    request: { params: TaskParamsSchema, body: jsonBody(TaskActionSchema) },
    responses: {
      200: jsonResponse('The outcome and the task after it', TaskMovedSchema),
      400: INVALID,
      401: refusals[401],
      403: errorResponse(
        'Below member (`forbidden`), not the step’s (`not_your_step`), not leading (`not_lead`)',
      ),
      404: NO_TASK,
      409: errorResponse(
        'The task moved since `fromStepId` (`task_moved`), has no such move as it stands (`wrong_state`), is ' +
          'at that step already (`already_at_step`), or its step’s turn runs and `force` is not set (`step_running`)',
      ),
      422: errorResponse(
        'Not a move of its step’s kind (`wrong_kind`), a send-back without a target (`no_send_back_target`) or a ' +
          'reason (`reason_required`), a route without a step (`step_required`) or to no step of its flow ' +
          '(`unknown_step`)',
      ),
    },
  });
};

export function actionRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter().openapi(actRoute(deps), async (c) => {
    const { taskId } = c.req.valid('param');
    const result = await tasks.act(c.var.tenant, callerOf(c.var), taskId, c.req.valid('json'), c.var.clock());
    if (!result.ok) return errorJson(c, result.status, result.code, result.message);
    return c.json({ outcome: result.outcome, task: result.task }, 200);
  });
}
