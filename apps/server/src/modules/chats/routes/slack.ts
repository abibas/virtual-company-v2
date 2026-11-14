import { createRoute, z } from '@hono/zod-openapi';
import { CHAT_PROMPT } from '@mwc/shared/chats';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ChatParamsSchema, ChatTurnSchema } from '../schemas.ts';
import { type SlackSendDeps, sendInSlack } from '../service/slack.ts';
import { chatRoute } from './access.ts';

/**
 * Send in Slack (2026-11-14, docs/subscriptions.md "Send in Slack"): `POST …/chats/{chatId}/slack-messages` posts the
 * text straight into the Slack conversation the chat is for, through the bot, as the bot, with no agent turn. Only the
 * Slack connection's owner, in the chat.
 */

const SLACK = '/api/companies/{companyId}/chats/{chatId}/slack-messages' as const;

export const SlackMessageSchema = z
  .object({ text: z.string().trim().min(CHAT_PROMPT.min).max(4000) })
  .openapi('ChatSlackMessage');

const sendRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: SLACK, access: 'write' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Send a message in the chat's Slack conversation, as the bot (the Slack connection's owner)",
    description:
      'No agent turn: the message is posted where the conversation is (its thread, or the DM), recorded so a reply to ' +
      'it comes back to this chat, audited, and kept in the thread as a turn of kind `slack` with its link.',
    request: { params: ChatParamsSchema, body: jsonBody(SlackMessageSchema) },
    responses: {
      201: jsonResponse('The message, as the thread keeps it', ChatTurnSchema),
      400: errorResponse(
        'The request does not match the schema (`invalid_request`): a text of 1–4000 characters',
      ),
      ...refusals,
      403: errorResponse(
        "Not in the chat (`not_in_chat`), or not the Slack connection's owner (`not_slack_owner`)",
      ),
      404: errorResponse(
        'No such company or not an active member (`not_found`), or no such chat (`chat_not_found`)',
      ),
      409: errorResponse(
        'The chat is archived (`chat_archived`) or not for a Slack conversation (`not_slack_chat`), its agent is ' +
          'archived (`agent_archived`), or the bot may not post there (`slack_refused`, saying why)',
      ),
      422: errorResponse("The bot's sign-in cannot be used (`credential_*`, saying why)"),
      503: errorResponse('Slack did not answer (`slack_unavailable`)'),
    },
  });
};

export function slackRoutes(deps: ServerDeps & SlackSendDeps) {
  return newRouter().openapi(sendRoute(deps), async (c) => {
    const { chatId } = c.req.valid('param');
    const { principalId, userId } = c.var.membership;
    const sender = { principalId, userId, requestId: c.var.requestId };
    const result = await sendInSlack(deps, c.var.tenant, sender, chatId, c.req.valid('json').text);
    if (!result.ok)
      return errorJson(c, result.status as 403 | 404 | 409 | 422 | 503, result.code, result.message);
    return c.json(result.turn, 201);
  });
}
