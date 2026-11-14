import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatListSchema } from '../schemas/activity.ts';
import { AddPeopleSchema, ChatPeopleSchema, PersonParamsSchema } from '../schemas/people.ts';
import { AgentChatsParamsSchema, ChatParamsSchema } from '../schemas.ts';
import type { ChatBus } from '../service/bus.ts';
import { addPeople, type PeopleCaller, removePerson } from '../service/people.ts';
import { listChats } from '../service.ts';
import { chatRoute } from './access.ts';

/**
 * Who is in a chat (2026-11-14, docs/harness.md "Who is in a chat"): `POST …/chats/{chatId}/people` adds members (any
 * person in the chat; a company owner who is not in it only themselves: Add me), `DELETE …/people/{personId}` takes one
 * out (the chat's creator or an owner) or leaves (anyone), and `GET …/agents/{agentId}/chats/others` lists an agent's
 * message chats the caller is not in (owners only: "Other people's chats", each opened read-only).
 */

const PEOPLE = '/api/companies/{companyId}/chats/{chatId}/people' as const;
const PERSON = '/api/companies/{companyId}/chats/{chatId}/people/{personId}' as const;
const OTHERS = '/api/companies/{companyId}/agents/{agentId}/chats/others' as const;

const NOT_CHANGEABLE =
  "The chat is archived (`chat_archived`), or a task's conversation or a team chat, which keep their own rules " +
  '(`people_unsupported`)';

const addRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: PEOPLE, access: 'read' });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Add members to a chat (anyone in it; an owner who is not in it adds only themselves)',
    description: 'Each one is audited and shows as a quiet line in the thread. The chat’s people now.',
    request: { params: ChatParamsSchema, body: jsonBody(AddPeopleSchema) },
    responses: {
      200: jsonResponse('Its people', ChatPeopleSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      403: errorResponse(
        "The caller's role is below member (`forbidden`), or an owner not in the chat adds others",
      ),
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: errorResponse(`Everyone named is in it already (\`person_in_chat\`); ${NOT_CHANGEABLE}`),
      422: errorResponse('Someone named is not an active member above a viewer (`person_not_member`)'),
    },
  });
};

const removeRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: PERSON, access: 'write' });
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Take someone out of a chat (its creator or an owner), or leave it (anyone)',
    request: { params: PersonParamsSchema },
    responses: {
      200: jsonResponse('Its people', ChatPeopleSchema),
      ...refusals,
      403: errorResponse(
        "The caller's role is below member (`forbidden`), is not in the chat (`not_in_chat`), or takes out " +
          "someone else without being the chat's creator or an owner (`remove_refused`)",
      ),
      404: errorResponse('No such chat (`chat_not_found`), or nobody of that id in it (`person_not_found`)'),
      409: errorResponse(NOT_CHANGEABLE),
    },
  });
};

const othersRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'owner', path: OTHERS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "An agent's chats you are not in (owners only: read-only), the latest first",
    request: { params: AgentChatsParamsSchema },
    responses: {
      200: jsonResponse('Its other chats', ChatListSchema),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such agent (`agent_not_found`)',
      ),
    },
  });
};

const peopleCaller = (v: {
  membership: { principalId: string; role: PeopleCaller['role'] };
  requestId: string;
}): PeopleCaller => ({
  principalId: v.membership.principalId,
  role: v.membership.role,
  requestId: v.requestId,
});

export function peopleRoutes(deps: ServerDeps & { readonly bus: ChatBus }) {
  return newRouter()
    .openapi(addRoute(deps), async (c) => {
      const { chatId } = c.req.valid('param');
      const { principalIds } = c.req.valid('json');
      const result = await addPeople(deps, c.var.tenant, peopleCaller(c.var), chatId, principalIds);
      if (!result.ok)
        return errorJson(c, result.status as 403 | 404 | 409 | 422, result.code, result.message);
      return c.json({ people: result.people }, 200);
    })
    .openapi(removeRoute(deps), async (c) => {
      const { chatId, personId } = c.req.valid('param');
      const result = await removePerson(deps, c.var.tenant, peopleCaller(c.var), chatId, personId);
      if (!result.ok) return errorJson(c, result.status as 403 | 404 | 409, result.code, result.message);
      return c.json({ people: result.people }, 200);
    })
    .openapi(othersRoute(deps), async (c) => {
      const { agentId } = c.req.valid('param');
      const result = await listChats(deps.db, c.var.tenant, agentId, c.var.membership.principalId, true);
      if (!result.ok) return errorJson(c, 404, result.code, result.message);
      return c.json({ chats: result.chats }, 200);
    });
}
