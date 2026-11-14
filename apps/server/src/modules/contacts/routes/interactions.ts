import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ContactsParamsSchema, InteractionsQuerySchema, InteractionsSchema } from '../schemas.ts';
import { contactInteractions } from '../service/interactions.ts';

/**
 * `GET /api/companies/{companyId}/contacts/interactions?since=` (2026-11-14, docs/subscriptions.md "Contacts"): who
 * talked to which agent lately, for the org chart's Requesters to draw. Members and above. Mounted before
 * `…/contacts/{contactId}`, whose id it would otherwise be.
 */

const INTERACTIONS = '/api/companies/{companyId}/contacts/interactions' as const;

const interactionsRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: INTERACTIONS, tag: 'contacts' });
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Who talked to which agent lately, and who is being answered now (member and above)',
    description:
      'Per contact that is not archived, the agents their messages woke since `since` (7 days ago when left out; at ' +
      'most 90 days back, never ahead: `since` in the answer is the one used), with how many and the latest, and ' +
      'whether a turn of theirs waits or runs now (`live`, also per contact). The latest first. A turn that starts or ' +
      'ends is told live by `GET …/chat-activity`: its `lastTurn.from.contactId` and status.',
    request: { params: ContactsParamsSchema, query: InteractionsQuerySchema },
    responses: { 200: jsonResponse('The interactions', InteractionsSchema), ...refusals },
  });
};

export function interactionRoutes(deps: ServerDeps) {
  return newRouter().openapi(interactionsRoute(deps), async (c) =>
    c.json(await contactInteractions(c.var.tenant, c.req.valid('query').since, c.var.clock()), 200),
  );
}
