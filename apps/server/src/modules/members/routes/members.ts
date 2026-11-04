import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import {
  MemberListSchema,
  MemberParamsSchema,
  MemberSchema,
  MembersParamsSchema,
  UpdateMemberSchema,
} from '../schemas.ts';
import { membersService } from '../service.ts';

/**
 * `/api/companies/{companyId}/members`: the member list (viewer and above), a member's role (admin and above, with
 * the owner rules) and removing a member or leaving (anyone may leave; removing someone else is for admins and
 * owners). Changes are local first, then an outbox call to the identity provider.
 */

const memberRoute = <P extends CompanyPath>(deps: ServerDeps, role: MembershipRole, path: P) =>
  companyRoute(deps, { role, path, tag: 'members' });

const NO_MEMBER = errorResponse(
  'No such company, a deleted one, or one the caller is not an active member of (`not_found`), or no such member ' +
    'in it (`member_not_found`)',
);
const LAST_OWNER = errorResponse('The change would leave the company with no active owner (`last_owner`)');

const listMembersRoute = (deps: ServerDeps) => {
  const { base, refusals } = memberRoute(deps, 'viewer', '/api/companies/{companyId}/members');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'The members of a company (viewer and above), in the order they joined',
    request: { params: MembersParamsSchema },
    responses: { 200: jsonResponse('The members', MemberListSchema), 401: refusals[401], 404: refusals[404] },
  });
};

const updateMemberRoute = (deps: ServerDeps) => {
  const { base, refusals } = memberRoute(deps, 'admin', '/api/companies/{companyId}/members/{membershipId}');
  return createRoute({
    ...base,
    method: 'patch',
    summary: "Change a member's role (admin and above)",
    description:
      'An owner may give any role; an admin may move people among admin, member and viewer, but not change an ' +
      "owner's role or make someone an owner. The role that the member has already changes nothing. The identity " +
      'provider follows through the outbox (`update_role`).',
    request: { params: MemberParamsSchema, body: jsonBody(UpdateMemberSchema) },
    responses: {
      200: jsonResponse('The member after the change', MemberSchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      401: refusals[401],
      403: errorResponse(
        "The caller's role is below admin, or the owner rules refuse the change (`forbidden`)",
      ),
      404: NO_MEMBER,
      409: LAST_OWNER,
    },
  });
};

const removeMemberRoute = (deps: ServerDeps) => {
  const { base, refusals } = memberRoute(deps, 'viewer', '/api/companies/{companyId}/members/{membershipId}');
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Remove a member, or leave the company (your own membership)',
    description:
      "Access ends at once: the membership turns `removed` and the person's API keys in this company are revoked. " +
      'Anyone may leave; an owner may remove anyone, an admin anyone but an owner. The identity provider follows ' +
      'through the outbox (`remove_member`).',
    request: { params: MemberParamsSchema },
    responses: {
      204: { description: 'Removed' },
      401: refusals[401],
      403: errorResponse(
        'A member or viewer removing someone else, or an admin removing an owner (`forbidden`)',
      ),
      404: NO_MEMBER,
      409: LAST_OWNER,
    },
  });
};

export function memberRoutes(deps: ServerDeps) {
  const members = membersService(deps);
  return newRouter()
    .openapi(listMembersRoute(deps), async (c) => c.json({ members: await members.list(c.var.tenant) }, 200))
    .openapi(updateMemberRoute(deps), async (c) => {
      const { tenant, membership, requestId } = c.var;
      const result = await members.changeRole(tenant, {
        actorId: membership.id,
        membershipId: c.req.valid('param').membershipId,
        role: c.req.valid('json').role,
        requestId,
      });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json(result.member, 200);
    })
    .openapi(removeMemberRoute(deps), async (c) => {
      const { tenant, membership, requestId, clock } = c.var;
      const result = await members.remove(tenant, {
        actorId: membership.id,
        membershipId: c.req.valid('param').membershipId,
        requestId,
        now: clock(),
      });
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.body(null, 204);
    });
}
