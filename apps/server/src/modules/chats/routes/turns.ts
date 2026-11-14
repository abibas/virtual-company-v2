import { createRoute } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv, ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { decodeImages, MESSAGE_BODY_MAX, MESSAGE_TOO_LARGE } from '../rules/images.ts';
import { isMachineStopped } from '../rules/machine.ts';
import { MachineStoppedSchema } from '../schemas/machine.ts';
import { ChatParamsSchema, ChatTurnSchema, CreateTurnSchema, TurnParamsSchema } from '../schemas.ts';
import { type QueueDeps, sendMessage } from '../service/queue.ts';
import { stopTurn } from '../service/turns.ts';
import { writtenIn } from '../service/written.ts';
import { chatRoute } from './access.ts';

/**
 * A chat's turns (S5.1b): `POST /api/companies/{companyId}/chats/{chatId}/turns` sends a prompt to the agent on its
 * machine (202: the turn runs, or with a `delivery` waits for the running one, S5.2 step 6, or waits for its stopped
 * machine to start; its events come on the chat's stream), `POST …/turns/{turnId}/stop` stops a running one or one
 * waiting for its machine. The waiting ones are `routes/queue.ts`'s. The chat's people from the member role up (a task's conversation or a team chat: admins and owners); in a chat with
 * several people the agent gets the writer's name first (2026-11-14). A message may carry images (T-18, base64, checked
 * here before anything is written; the body is limited before it is read).
 */

const TURNS = '/api/companies/{companyId}/chats/{chatId}/turns' as const;
const STOP = '/api/companies/{companyId}/chats/{chatId}/turns/{turnId}/stop' as const;

export const TURN_REFUSALS = {
  409:
    'The chat is archived (`chat_archived`), a turn of it runs (`turn_running`), the agent has no placement ' +
    '(`placement_missing`), runs in a container (`container_runs_later`), moved to another machine ' +
    '(`machine_changed`: start a new chat) or changed harness (`harness_changed`), its machine is stopped and its ' +
    'start on a message is off (`machine_stopped`, with the `machine`: send again with `startMachine`), its ' +
    "machine's runner is not connected and nothing here can start it (`machine_offline`, why in words), is older " +
    'than chats or, for a branch not forked yet, than branching ' +
    '(`runner_outdated`; also for a message with images to a runner older than them) or has no such CLI ' +
    "(`harness_missing`), or a branch's reply can no longer be reached in its " +
    'parent (`branch_latest_only`); ' +
    'with a `delivery`: ten messages wait already (`queue_full`), or the running turn takes no message now ' +
    '(`now_unsupported`: Codex, or a compaction)',
  422:
    'No access profile (`profile_missing`), one of another provider than the harness runs on ' +
    '(`profile_harness_mismatch`), one without a subscription (`profile_empty`), a subscription that is gone, ' +
    'revoked, signed out or of the wrong kind (`credential_not_found`, `credential_revoked`, ' +
    "`credential_needs_sign_in`, `credential_unusable`), or the agent's settings cannot start one (`invalid_spec`); " +
    'in a chat with several people, a message that no longer fits once your name goes first (`prompt_too_long`)',
  503: "The provider did not refresh the login's token (`provider_unavailable`)",
} as const;

/** Refuses a message body over `MESSAGE_BODY_MAX` before it is read: 413 `message_too_large`. */
const messageBodyLimit: MiddlewareHandler<AppEnv> = bodyLimit({
  maxSize: MESSAGE_BODY_MAX,
  onError: (c) => errorJson(c, 413, MESSAGE_TOO_LARGE.code, MESSAGE_TOO_LARGE.message),
});

const startRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: TURNS, access: 'write', team: 'admin' });
  // After the guards (nothing is read for a caller they refuse), before the body is parsed.
  const middleware: [...typeof base.middleware, MiddlewareHandler<AppEnv>] = [
    ...base.middleware,
    messageBodyLimit,
  ];
  return createRoute({
    ...base,
    middleware,
    method: 'post',
    summary:
      'Send a prompt: a turn of the agent on its machine (member and above in a chat of yours; admin and above in a task’s conversation or a team chat)',
    description:
      "The turn runs on the chat's profile (else the agent's), of the provider the harness runs on: its subscription, " +
      "refreshed when due, handed to the runner for this turn only, with the profile's gateway. Its events, " +
      "and its end, come on the chat's stream.",
    request: { params: ChatParamsSchema, body: jsonBody(CreateTurnSchema) },
    responses: {
      202: jsonResponse(
        'The turn: running, or waiting (`queued`) with its delivery, or for its machine (`machineWaitAt`)',
        ChatTurnSchema,
      ),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): a prompt of 1–20 000 characters, a known ' +
          'delivery, at most 6 images; or an image is not base64 (`image_invalid`)',
      ),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: jsonResponse(TURN_REFUSALS[409], MachineStoppedSchema),
      413: errorResponse(
        'An image is over 3 MB (`image_too_large`), or the whole body is too large (`message_too_large`)',
      ),
      415: errorResponse('An image is not a PNG, JPEG, WebP or GIF image (`image_type_unsupported`)'),
      422: errorResponse(TURN_REFUSALS[422]),
      503: errorResponse(TURN_REFUSALS[503]),
    },
  });
};

const stopRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: STOP, access: 'write', team: 'admin' });
  return createRoute({
    ...base,
    method: 'post',
    summary:
      'Stop a running turn, or one waiting for its machine (member and above in a chat of yours; admin and above in a task’s conversation or a team chat); its end comes on the stream as `stopped`',
    request: { params: TurnParamsSchema },
    responses: {
      202: jsonResponse('The turn, stopping', ChatTurnSchema),
      ...refusals,
      404: errorResponse('No such chat (`chat_not_found`) or turn (`turn_not_found`)'),
      409: errorResponse('The turn is neither running nor waiting for its machine (`turn_not_running`)'),
    },
  });
};

export function turnRoutes(deps: ServerDeps & QueueDeps) {
  return newRouter()
    .openapi(startRoute(deps), async (c) => {
      const { chatId } = c.req.valid('param');
      const { principalId, userId, role } = c.var.membership;
      const { prompt, delivery, startMachine, images: sent } = c.req.valid('json');
      const decoded = decodeImages(sent ?? []);
      if (!decoded.ok) return errorJson(c, decoded.status, decoded.code, decoded.message);
      const wake = { trigger: 'message' as const, person: { userId, role }, asked: startMachine === true };
      const written = await writtenIn(deps.db, c.var.tenant, chatId, principalId, prompt);
      if (!written.ok) return errorJson(c, 422, written.code, written.message);
      const caller = { principalId, wake, shown: written.shown, images: decoded.images };
      const result = await sendMessage(deps, c.var.tenant, caller, chatId, written.prompt, delivery);
      if (result.ok) return c.json(result.turn, 202);
      if (isMachineStopped(result)) {
        const error = { code: result.code, message: result.message, requestId: c.var.requestId };
        return c.json({ error: { ...error, machine: result.machine } }, 409);
      }
      return errorJson(c, result.status as 404 | 409 | 422 | 503, result.code, result.message);
    })
    .openapi(stopRoute(deps), async (c) => {
      const { chatId, turnId } = c.req.valid('param');
      const result = await stopTurn(deps, c.var.tenant, chatId, turnId);
      if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
      return c.json(result.turn, 202);
    });
}
