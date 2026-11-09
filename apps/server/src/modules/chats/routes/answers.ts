import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { AnswerQuestionSchema, ChatParamsSchema, ChatTurnSchema } from '../schemas.ts';
import { answerQuestion } from '../service/answers.ts';
import type { TurnsDeps } from '../service/turns.ts';
import { TURN_REFUSALS } from './turns.ts';

/**
 * Answers to the agent's question (S5.2 step 4, docs/harness.md "Asking the person"): `POST
 * /api/companies/{companyId}/chats/{chatId}/answers` sends the person's picks for the chat's open question as its next
 * turn (202), and marks the question answered. Admins and owners only.
 */

const ANSWERS = '/api/companies/{companyId}/chats/{chatId}/answers' as const;

const answerRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: ANSWERS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'post',
    summary: "Answer the agent's question: the picks go as the chat's next turn (admin and above)",
    description:
      'The answers name the questions asked (each at most once; one left out is said as skipped) and pick only their ' +
      "options' labels (one for a single-choice question), with the person's own words as `other`. The next turn's " +
      'prompt says them in words ("My answers to your questions: …"); it is refused as any turn is. The question ' +
      "gets an `answered` event naming that turn, which comes on the chat's stream before it.",
    request: { params: ChatParamsSchema, body: jsonBody(AnswerQuestionSchema) },
    responses: {
      202: jsonResponse('The turn that carries the answers, running', ChatTurnSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), no such chat (`chat_not_found`), or no such ' +
          'question in it (`question_not_found`)',
      ),
      409: errorResponse(
        `The question was answered already or a newer turn closed it (\`question_closed\`); ${TURN_REFUSALS[409]}`,
      ),
      422: errorResponse(
        `The answers do not fit the question (\`invalid_answers\`, saying why); ${TURN_REFUSALS[422]}`,
      ),
      503: errorResponse(TURN_REFUSALS[503]),
    },
  });
};

export function answerRoutes(deps: ServerDeps & TurnsDeps) {
  return newRouter().openapi(answerRoute(deps), async (c) => {
    const caller = { principalId: c.var.membership.principalId };
    const { chatId } = c.req.valid('param');
    const result = await answerQuestion(deps, c.var.tenant, caller, chatId, c.req.valid('json'));
    if (!result.ok) return errorJson(c, result.status as 404 | 409 | 422 | 503, result.code, result.message);
    return c.json(result.turn, 202);
  });
}
