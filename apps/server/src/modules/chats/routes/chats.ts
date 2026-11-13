import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  AgentChatsParamsSchema,
  ChatDetailSchema,
  ChatListSchema,
  ChatParamsSchema,
  ChatSchema,
  CreateChatSchema,
  UpdateChatSchema,
} from '../schemas.ts';
import {
  archiveChat,
  type ChatCaller,
  type ChatDetailLive,
  createChat,
  getChat,
  listChats,
  updateChat,
} from '../service.ts';

/**
 * A chat with an agent (S5.1b): `GET|POST /api/companies/{companyId}/agents/{agentId}/chats` and
 * `GET|PATCH|DELETE /api/companies/{companyId}/chats/{chatId}`. Members and above read; admins and owners begin, change
 * and archive chats. Another company's agent or chat is the same 404 as an unknown one.
 */

const AGENT_CHATS = '/api/companies/{companyId}/agents/{agentId}/chats' as const;
const CHAT = '/api/companies/{companyId}/chats/{chatId}' as const;

const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');
const NO_CHAT = errorResponse(
  'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
);
const NO_AGENT = errorResponse(
  'No such company or not an active member (`not_found`), or no such agent (`agent_not_found`)',
);
const PROFILE_REFUSED = errorResponse(
  'Only its owner chooses an access profile for a chat, signed in, as an admin or owner (`profile_not_yours`, ' +
    '`session_required`, `forbidden`)',
);

const route = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P) =>
  companyRoute(deps, { role, path, tag: 'chats' });

/** The caller of a chat route, from the guard's variables. */
export const chatCaller = (v: {
  actor: { via: string };
  membership: { principalId: string; role: MembershipRole; userId: string };
  requestId: string;
}): ChatCaller => ({
  principalId: v.membership.principalId,
  userId: v.membership.userId,
  role: v.membership.role,
  session: v.actor.via === 'clerk',
  requestId: v.requestId,
});

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', AGENT_CHATS);
  return createRoute({
    ...base,
    method: 'get',
    summary: "An agent's chats (member and above), the latest first; archived ones are left out",
    request: { params: AgentChatsParamsSchema },
    responses: { 200: jsonResponse('Its chats', ChatListSchema), ...refusals, 404: NO_AGENT },
  });
};

const createChatRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', AGENT_CHATS);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Begin a chat with an agent (admin and above)',
    description:
      "The chat runs on the agent's harness, on its placement's machine (its session lives there), with the agent's " +
      'access profile, or with `profileId`: one of your own, chosen signed in.',
    request: { params: AgentChatsParamsSchema, body: jsonBody(CreateChatSchema) },
    responses: {
      201: jsonResponse('The chat', ChatSchema),
      400: INVALID,
      ...refusals,
      403: PROFILE_REFUSED,
      404: NO_AGENT,
      409: errorResponse(
        'The agent has no placement (`placement_missing`) or is archived (`agent_archived`)',
      ),
      422: errorResponse(
        'No such access profile (`profile_not_found`), or one of another provider than the chat’s harness runs on ' +
          '(`profile_harness_mismatch`)',
      ),
    },
  });
};

const getChatRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'member', CHAT);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'A chat with its current conversation: its latest turns and their events (member and above)',
    description:
      "`turns` is the current conversation: the turns since the chat's last Clear (that Clear's turn first, its `kind` " +
      '`clear`), the latest 30 of them. `earlier` says what is left out: `before` and `turns`, the older turns of the ' +
      'current conversation (page them with `GET …/turns?beforeSeq=`), and `conversations`, the conversations before ' +
      'each Clear, newest first, with their size and time span. `init` is the last `init` event of the current ' +
      'conversation (model, effort, folder, slash commands) and `context` how full it is (`usedTokens`, `window`, ' +
      '`model`, `at`), both read from all of it, left-out turns too; null before anything said so since the last Clear. ' +
      "`runnerUpdateFor` names the server's tools the chat's profile gives that its machine's runner is too old to " +
      'provide (its turns are told so instead of getting them).',
    request: { params: ChatParamsSchema },
    responses: { 200: jsonResponse('The chat', ChatDetailSchema), ...refusals, 404: NO_CHAT },
  });
};

const updateChatRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', CHAT);
  return createRoute({
    ...base,
    method: 'patch',
    summary:
      "Rename a chat, or choose its access profile (admin and above; only your own; null: the agent's)",
    request: { params: ChatParamsSchema, body: jsonBody(UpdateChatSchema) },
    responses: {
      200: jsonResponse('The chat', ChatSchema),
      400: INVALID,
      ...refusals,
      403: PROFILE_REFUSED,
      404: NO_CHAT,
      422: errorResponse(
        'No such access profile (`profile_not_found`), or one of another provider than the chat’s harness runs on ' +
          '(`profile_harness_mismatch`)',
      ),
    },
  });
};

const archiveRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'admin', CHAT);
  return createRoute({
    ...base,
    method: 'delete',
    summary:
      'Archive a chat (admin and above): it stays readable, takes no new turn, and a running one finishes',
    request: { params: ChatParamsSchema },
    responses: { 204: { description: 'Archived' }, ...refusals, 404: NO_CHAT },
  });
};

export function chatRoutes(deps: ServerDeps, live: ChatDetailLive = {}) {
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const result = await listChats(c.var.tenant, c.req.valid('param').agentId);
      if (!result.ok) return errorJson(c, 404, result.code, result.message);
      return c.json({ chats: result.chats }, 200);
    })
    .openapi(createChatRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await createChat(c.var.tenant, chatCaller(c.var), agentId, c.req.valid('json'));
      if (!result.ok)
        return errorJson(c, result.status as 403 | 404 | 409 | 422, result.code, result.message);
      return c.json(result.chat, 201);
    })
    .openapi(getChatRoute(deps), async (c) => {
      const result = await getChat(c.var.tenant, c.req.valid('param').chatId, live);
      if (!result.ok) return errorJson(c, 404, result.code, result.message);
      return c.json(result.chat, 200);
    })
    .openapi(updateChatRoute(deps), async (c) => {
      const { chatId } = c.req.valid('param');
      const result = await updateChat(c.var.tenant, chatCaller(c.var), chatId, c.req.valid('json'));
      if (!result.ok) return errorJson(c, result.status as 403 | 404 | 422, result.code, result.message);
      return c.json(result.chat, 200);
    })
    .openapi(archiveRoute(deps), async (c) => {
      const { chatId } = c.req.valid('param');
      const result = await archiveChat(c.var.tenant, chatCaller(c.var), chatId, c.var.clock());
      if (!result.ok) return errorJson(c, 404, result.code, result.message);
      return c.body(null, 204);
    });
}
