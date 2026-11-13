import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { BranchChatSchema } from '../schemas/branch.ts';
import { ChatParamsSchema, ChatSchema } from '../schemas.ts';
import { branchChat } from '../service/branch.ts';
import { type ChatChanged, chatCaller } from './chats.ts';

/**
 * Branching a conversation (docs/harness.md "Branching"): `POST /api/companies/{companyId}/chats/{chatId}/branch`
 * begins a new chat with the same agent that continues this one's conversation from one of its replies (201), without
 * changing this one. Admins and owners only.
 */

const BRANCH = '/api/companies/{companyId}/chats/{chatId}/branch' as const;

const branchRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: BRANCH, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Branch the conversation from a reply into a new chat (admin and above)',
    description:
      'The new chat, titled "<this chat\'s title> (branch)", has this chat\'s harness, machine and access profile ' +
      "choice, and the reply's session; it names this chat and the reply (`branchedFromChatId`, " +
      '`branchedFromTurnId`) and is `forkPending` until its first turn resumes that session forked: Claude Code ' +
      '`--resume <id> --fork-session`, cut after the reply (`--resume-session-at <its last message>`) when later turns ' +
      'ran on that session; Codex `codex exec fork <thread>`, which forks a whole thread, so only from the latest reply ' +
      "of a conversation. This chat's own conversation never changes.",
    request: { params: ChatParamsSchema, body: jsonBody(BranchChatSchema) },
    responses: {
      201: jsonResponse('The branch', ChatSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), no such chat (`chat_not_found`), or no such turn ' +
          'in it (`turn_not_found`)',
      ),
      409: errorResponse(
        'A turn of the chat runs or waits (`turn_running`); the turn is not a finished reply with a conversation ' +
          "(`turn_not_branchable`); the chat's harness cannot fork (`branch_unsupported`, saying why); only the " +
          'latest reply of its conversation can branch (`branch_latest_only`: Codex, a reply recorded before branching, ' +
          'or one before a compaction); or the agent is archived (`agent_archived`)',
      ),
    },
  });
};

export function branchRoutes(deps: ServerDeps, changed: ChatChanged = () => undefined) {
  return newRouter().openapi(branchRoute(deps), async (c) => {
    const { chatId } = c.req.valid('param');
    const result = await branchChat(c.var.tenant, chatCaller(c.var), chatId, c.req.valid('json').turnId);
    if (!result.ok) return errorJson(c, result.status as 404 | 409, result.code, result.message);
    changed(result.chat.id);
    return c.json(result.chat, 201);
  });
}
