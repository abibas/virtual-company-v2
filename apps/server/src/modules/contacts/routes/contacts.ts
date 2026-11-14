import { createRoute } from '@hono/zod-openapi';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  ContactChangeSchema,
  ContactDetailSchema,
  ContactListSchema,
  ContactParamsSchema,
  ContactSchema,
  ContactsParamsSchema,
  ContactsQuerySchema,
} from '../schemas.ts';
import { contactDetail, listContacts } from '../service/read.ts';
import { changeContact } from '../service/update.ts';

/**
 * A company's contacts (2026-11-14, docs/subscriptions.md "Contacts"): `GET /api/companies/{companyId}/contacts` (the
 * list), `GET …/contacts/{contactId}` (a contact's page: their conversations with the agents and the counts per agent),
 * members and above; `PATCH …/contacts/{contactId}` (the note, archived), admins and owners.
 */

const CONTACTS = '/api/companies/{companyId}/contacts' as const;
const CONTACT = '/api/companies/{companyId}/contacts/{contactId}' as const;
const NOT_FOUND = errorResponse(
  'No such company or not an active member (`not_found`), or no such contact (`contact_not_found`)',
);

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: CONTACTS, tag: 'contacts' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "The company's contacts: the people outside it who talked to its agents (member and above)",
    description:
      'The latest seen first, each with the agents they talked to (the latest first) and how many conversations. ' +
      'Archived contacts only with `archived=true`.',
    request: { params: ContactsParamsSchema, query: ContactsQuerySchema },
    responses: { 200: jsonResponse('The contacts', ContactListSchema), ...refusals },
  });
};

const detailRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'member', path: CONTACT, tag: 'contacts' });
  return createRoute({
    ...base,
    method: 'get',
    summary: "A contact's page: their conversations with the company's agents (member and above)",
    description:
      'Each Slack chat they started or wrote in, the latest first, with its agent, its last message and whether a turn ' +
      'waits or runs there; and per agent how many conversations and messages.',
    request: { params: ContactParamsSchema },
    responses: { 200: jsonResponse('The contact', ContactDetailSchema), ...refusals, 404: NOT_FOUND },
  });
};

const changeRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, { role: 'admin', path: CONTACT, tag: 'contacts' });
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Change a contact's note, or archive or bring back one (admin and above)",
    description:
      'A blank or null note removes it. An archived contact is left out of the list and the interactions; its ' +
      'conversations stay, and their messages still wake agents. Audited.',
    request: { params: ContactParamsSchema, body: jsonBody(ContactChangeSchema) },
    responses: {
      200: jsonResponse('The contact as it is now', ContactSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`): a note or archived'),
      ...refusals,
      404: NOT_FOUND,
    },
  });
};

export function contactRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const contacts = await listContacts(c.var.tenant, c.req.valid('query').archived === 'true');
      return c.json({ contacts }, 200);
    })
    .openapi(detailRoute(deps), async (c) => {
      const found = await contactDetail(c.var.tenant, c.req.valid('param').contactId);
      if (!found.ok) return errorJson(c, found.status, found.code, found.message);
      return c.json(found.detail, 200);
    })
    .openapi(changeRoute(deps), async (c) => {
      const caller = { principalId: c.var.membership.principalId, requestId: c.var.requestId };
      const { contactId } = c.req.valid('param');
      const changed = await changeContact(
        c.var.tenant,
        caller,
        contactId,
        c.req.valid('json'),
        c.var.clock(),
      );
      if (!changed.ok) return errorJson(c, changed.status, changed.code, changed.message);
      return c.json(changed.contact, 200);
    });
}
