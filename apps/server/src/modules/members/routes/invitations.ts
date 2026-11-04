import { createRoute } from '@hono/zod-openapi';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  CreateInvitationSchema,
  InvitationListQuerySchema,
  InvitationListSchema,
  InvitationParamsSchema,
  InvitationSchema,
  MembersParamsSchema,
} from '../schemas.ts';
import { invitationsService } from '../service.ts';

/**
 * `/api/companies/{companyId}/invitations` (admin and above): invite an email with a role, list the invitations,
 * resend or revoke one. Changes are local first, then an outbox call to the identity provider, which sends the email.
 */

const COLLECTION = '/api/companies/{companyId}/invitations' as const;
const ONE = '/api/companies/{companyId}/invitations/{invitationId}' as const;

const adminRoute = <P extends CompanyPath>(deps: ServerDeps, path: P) =>
  companyRoute(deps, { role: 'admin', path, tag: 'invitations' });

const FORBIDDEN = errorResponse(
  "The caller's role is below admin, or an admin acting on an owner's invitation (`forbidden`)",
);
const NO_INVITATION = errorResponse(
  'No such company, a deleted one, or one the caller is not an active member of (`not_found`), or no such ' +
    'invitation in it (`invitation_not_found`)',
);
const NOT_PENDING = errorResponse(
  'The invitation is accepted, revoked, expired or failed (`invitation_not_pending`)',
);

const createInvitationRoute = (deps: ServerDeps) => {
  const { base, refusals } = adminRoute(deps, COLLECTION);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Invite someone by email (admin and above)',
    description:
      'An owner may invite with any role, an admin with any role but owner. The invitation expires in 14 days; ' +
      'the identity provider emails it through the outbox (`invite`), with a link to `/accept-invitation`.',
    request: { params: MembersParamsSchema, body: jsonBody(CreateInvitationSchema) },
    responses: {
      201: jsonResponse('The invitation, pending', InvitationSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      401: refusals[401],
      403: FORBIDDEN,
      404: refusals[404],
      409: errorResponse(
        'The email belongs to a member (`already_member`) or has a pending invitation (`invitation_pending`)',
      ),
    },
  });
};

const listInvitationsRoute = (deps: ServerDeps) => {
  const { base, refusals } = adminRoute(deps, COLLECTION);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The invitations of a company (admin and above), newest first',
    description: 'Pending ones by default; `status` lists another status (as of now) or `all`.',
    request: { params: MembersParamsSchema, query: InvitationListQuerySchema },
    responses: {
      200: jsonResponse('The invitations', InvitationListSchema),
      400: errorResponse('An unknown `status` (`invalid_request`)'),
      401: refusals[401],
      403: refusals[403],
      404: refusals[404],
    },
  });
};

const resendInvitationRoute = (deps: ServerDeps) => {
  const { base, refusals } = adminRoute(deps, '/api/companies/{companyId}/invitations/{invitationId}/resend');
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Send a pending invitation again (admin and above)',
    description:
      'It expires 14 days from now again. Through the outbox, the provider revokes the invitation it sent and ' +
      'sends a new one that links back to this same invitation.',
    request: { params: InvitationParamsSchema },
    responses: {
      200: jsonResponse('The invitation after the resend', InvitationSchema),
      401: refusals[401],
      403: FORBIDDEN,
      404: NO_INVITATION,
      409: NOT_PENDING,
    },
  });
};

const revokeInvitationRoute = (deps: ServerDeps) => {
  const { base, refusals } = adminRoute(deps, ONE);
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Revoke a pending invitation (admin and above)',
    description:
      'Local first: an acceptance from now on is refused, and undone at the provider. The provider revokes its ' +
      'invitation through the outbox (`revoke_invite`). Revoking a revoked invitation changes nothing.',
    request: { params: InvitationParamsSchema },
    responses: {
      204: { description: 'Revoked' },
      401: refusals[401],
      403: FORBIDDEN,
      404: NO_INVITATION,
      409: NOT_PENDING,
    },
  });
};

export function invitationRoutes(deps: ServerDeps) {
  const invitations = invitationsService(deps);
  return newRouter()
    .openapi(createInvitationRoute(deps), async (c) => {
      const { tenant, membership, requestId, clock } = c.var;
      const { email, role } = c.req.valid('json');
      const call = { actorId: membership.id, email, role, requestId, now: clock() };
      const result = await invitations.create(tenant, call);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.invitation, 201);
    })
    .openapi(listInvitationsRoute(deps), async (c) => {
      const filter = c.req.valid('query').status;
      return c.json({ invitations: await invitations.list(c.var.tenant, filter, c.var.clock()) }, 200);
    })
    .openapi(resendInvitationRoute(deps), async (c) => {
      const { tenant, membership, requestId, clock } = c.var;
      const { invitationId } = c.req.valid('param');
      const result = await invitations.resend(tenant, {
        actorId: membership.id,
        invitationId,
        requestId,
        now: clock(),
      });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.invitation, 200);
    })
    .openapi(revokeInvitationRoute(deps), async (c) => {
      const { tenant, membership, requestId, clock } = c.var;
      const { invitationId } = c.req.valid('param');
      const result = await invitations.revoke(tenant, {
        actorId: membership.id,
        invitationId,
        requestId,
        now: clock(),
      });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
