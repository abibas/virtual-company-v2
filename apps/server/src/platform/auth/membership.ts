import { type DbHandle, memberships, tenant } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { roleAtLeast } from '@mwc/shared/roles';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { COMPANY_NOT_FOUND, errorJson } from '../http/errors.ts';
import type { AuthEnv, MemberEnv } from './actor.ts';
import { type AuthDeps, authn } from './authn.ts';

/**
 * Guards a route under `/api/companies/:companyId/...` (after `authn()`): the caller must have an active
 * membership in that company (our `memberships`, read through `tenant()`; never the identity provider's
 * claims) with `required` or a higher role (owner > admin > member > viewer). A missing or deleted company,
 * and a company the caller is not an active member of, are the same 404, so nobody learns which companies
 * exist; a member below the role gets 403. A credential bound to another company (an API key) is a non-member.
 * Sets `c.var.tenant` (the company's `TenantDb`) and `c.var.membership`.
 */
export function requireMembership(
  deps: { readonly db: DbHandle },
  required: MembershipRole,
): MiddlewareHandler<MemberEnv> {
  return async (c, next) => {
    const actor = c.var.actor;
    if (actor === undefined) throw new Error('requireMembership() runs after authn()');
    // Throws CompanyNotFoundError for a malformed, missing or deleted company: the error handler's 404.
    const scoped = await tenant(deps.db, c.req.param('companyId') ?? '');
    const bound = actor.companyId === undefined || actor.companyId === scoped.companyId;
    const [row] =
      actor.userId === undefined || !bound
        ? []
        : await scoped.select(memberships, eq(memberships.userId, actor.userId));
    if (row === undefined || row.status !== 'active')
      return errorJson(c, 404, 'not_found', COMPANY_NOT_FOUND);
    if (!roleAtLeast(row.role, required)) {
      return errorJson(c, 403, 'forbidden', `This needs the ${required} role or a higher one`);
    }
    c.set('tenant', scoped);
    c.set('membership', {
      id: row.id,
      companyId: row.companyId,
      principalId: row.principalId,
      userId: row.userId,
      role: row.role,
    });
    await next();
  };
}

/**
 * `authn()` then `requireMembership(role)`, as a zod-openapi route's `middleware`. It is a tuple, so the route's
 * handler is typed with `c.var.actor`, `c.var.tenant` and `c.var.membership` (an array literal would lose them).
 */
export function companyMember(
  deps: AuthDeps,
  role: MembershipRole,
): [MiddlewareHandler<AuthEnv>, MiddlewareHandler<MemberEnv>] {
  return [authn(deps), requireMembership(deps, role)];
}
