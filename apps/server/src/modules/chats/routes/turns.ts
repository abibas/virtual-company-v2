import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatParamsSchema, ChatTurnSchema, CreateTurnSchema, TurnParamsSchema } from '../schemas.ts';
import { type QueueDeps, sendMessage } from '../service/queue.ts';
import { stopTurn } from '../service/turns.ts';

/**
 * A chat's turns (S5.1b): `POST /api/companies/{companyId}/chats/{chatId}/turns` sends a prompt to the agent on its
 * machine (202: the turn runs, or with a `delivery` waits for the running one, S5.2 step 6; its events come on the
 * chat's stream), `POST …/turns/{turnId}/stop` stops a running one. The waiting ones are `routes/queue.ts`'s. Admins
 * and owners only.
 */

const TURNS = '/api/companies/{companyId}/chats/{chatId}/turns' as const;
const STOP = '/api/companies/{companyId}/chats/{chatId}/turns/{turnId}/stop' as const;

export const TURN_REFUSALS = {
  409:
    'The chat is archived (`chat_archived`), a turn of it runs (`turn_running`), the agent has no placement ' +
    '(`placement_missing`), runs in a container (`container_runs_later`), moved to another machine ' +
    "(`machine_changed`: start a new chat) or changed harness (`harness_changed`), its machine's runner is not " +
    'connected (`machine_offline`), is older than chats (`runner_outdated`) or has no such CLI (`harness_missing`); ' +
    'with a `delivery`: ten messages wait already (`queue_full`), or the running turn takes no message now ' +
    '(`now_unsupported`: Codex, or a compaction)',
  422:
    'No access profile (`profile_missing`), one of another provider than the harness runs on ' +
    '(`profile_harness_mismatch`), one without a subscription (`profile_empty`), a subscription that is gone, ' +
    'revoked, signed out or of the wrong kind (`credential_not_found`, `credential_revoked`, ' +
    "`credential_needs_sign_in`, `credential_unusable`), or the agent's settings cannot start one (`invalid_spec`)",
  503: "The provider did not refresh the login's token (`provider_unavailable`)",
} as const;

const startRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: TURNS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Send a prompt: a turn of the agent on its machine (admin and above)',
    description:
      "The turn runs on the chat's profile (else the agent's), of the provider the harness runs on: its subscription, " +
      "refreshed when due, handed to the runner for this turn only, with a Claude profile's gateway. Its events, " +
      "and its end, come on the chat's stream.",
    request: { params: ChatParamsSchema, body: jsonBody(CreateTurnSchema) },
    responses: {
      202: jsonResponse('The turn: running, or waiting (`queued`) with its delivery', ChatTurnSchema),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): a prompt of 1–20 000 characters, a known delivery',
      ),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: errorResponse(TURN_REFUSALS[409]),
      422: errorResponse(TURN_REFUSALS[422]),
      503: errorResponse(TURN_REFUSALS[503]),
    },
  });
};

const stopRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: STOP, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Stop a running turn (admin and above); its end comes on the stream as `stopped`',
    request: { params: TurnParamsSchema },
    responses: {
      202: jsonResponse('The turn, stopping', ChatTurnSchema),
      ...refusals,
      404: errorResponse('No such chat (`chat_not_found`) or turn (`turn_not_found`)'),
      409: errorResponse('The turn is not running (`turn_not_running`)'),
    },
  });
};

export function turnRoutes(deps: ServerDeps & QueueDeps) {
  return newRouter()
    .openapi(startRoute(deps), async (c) => {
      const { chatId } = c.req.valid('param');
      const caller = { principalId: c.var.membership.principalId };
      const { prompt, delivery } = c.req.valid('json');
      const result = await sendMessage(deps, c.var.tenant, caller, chatId, prompt, delivery);
      if (!result.ok)
        return errorJson(c, result.status as 404 | 409 | 422 | 503, result.code, result.message);
      return c.json(result.turn, 202);
    })
    .openapi(stopRoute(deps), async (c) => {
      const { chatId, turnId } = c.req.valid('param');
      const result = await stopTurn(deps, c.var.tenant, chatId, turnId);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.json(result.turn, 202);
    });
}
