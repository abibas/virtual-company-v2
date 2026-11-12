import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ReportChatsParamsSchema, ReportChatsSchema } from '../schemas/reports.ts';
import { reportChats } from '../service/reports.ts';

/**
 * `GET /api/companies/{companyId}/me/report-chats` (docs/harness.md "Your direct reports in the rail"): the agents that
 * report to you on the chart with their main chat with you and where it stands, for the right rail. Members and above,
 * as the chats themselves; the rest goes through the chats' own routes.
 */

const REPORT_CHATS = '/api/companies/{companyId}/me/report-chats' as const;

const reportChatsRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: REPORT_CHATS, tag: 'chats' });
  return createRoute({
    ...base,
    method: 'get',
    summary:
      'The agents that report to you, each with its main chat with you and where it stands (member and above)',
    description:
      "An agent's main chat with you is the latest chat you began with it (by its last message), not archived, neither " +
      "a task's conversation nor a flow's team chat; null when there is none. A Lead names its flow with its team chat. " +
      'People who report to you are left out.',
    request: { params: ReportChatsParamsSchema },
    responses: { 200: jsonResponse('Your direct reports’ chats', ReportChatsSchema), ...refusals },
  });
};

export function reportChatRoutes(deps: ServerDeps) {
  return newRouter().openapi(reportChatsRoute(deps), async (c) => {
    const reports = await reportChats(c.var.tenant, c.var.membership.principalId);
    return c.json({ reports }, 200);
  });
}
