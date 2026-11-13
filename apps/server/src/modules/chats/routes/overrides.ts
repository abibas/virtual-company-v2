import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { UpdateChatOverridesSchema } from '../schemas/overrides.ts';
import { ChatParamsSchema, ChatSchema } from '../schemas.ts';
import { setOverrides } from '../service/overrides.ts';

/**
 * A chat's own mode, model and effort (2026-11-13, docs/harness.md "Modes"): `PATCH
 * /api/companies/{companyId}/chats/{chatId}/overrides` sets or clears them for its next turns. Admins and owners, as
 * sending it a message.
 */

const OVERRIDES = '/api/companies/{companyId}/chats/{chatId}/overrides' as const;

const updateRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: OVERRIDES, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Set or clear the chat's own mode, model and effort for its next turns (admin and above)",
    description:
      "Each given field is set (a value) or cleared (null: the profile's); one left out is kept. A turn already running " +
      'keeps what it started with; the next one takes them. Message chats only: a task’s conversation and a flow’s ' +
      "team chat run on their profile's (`overrides_unsupported`). A mode is one of the chat's harness's, a model one " +
      "of its provider's catalogue, an effort one that model (else the profile's) takes.",
    request: { params: ChatParamsSchema, body: jsonBody(UpdateChatOverridesSchema) },
    responses: {
      200: jsonResponse('The chat with its overrides', ChatSchema),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): at least one known field',
      ),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: errorResponse(
        "The chat is archived (`chat_archived`), or a task's or a team's conversation (`overrides_unsupported`)",
      ),
      422: errorResponse(
        "A mode of the other harness (`mode_unsupported`), a model not in its provider's catalogue " +
          '(`model_unsupported`), or an effort the model does not take (`effort_unsupported`)',
      ),
    },
  });
};

export function overrideRoutes(deps: ServerDeps) {
  return newRouter().openapi(updateRoute(deps), async (c) => {
    const caller = { principalId: c.var.membership.principalId, requestId: c.var.requestId };
    const { chatId } = c.req.valid('param');
    const result = await setOverrides(c.var.tenant, caller, chatId, c.req.valid('json'));
    if (!result.ok) return errorJson(c, result.status as 404 | 409 | 422, result.code, result.message);
    return c.json(result.chat, 200);
  });
}
