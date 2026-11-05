import { createRoute } from '@hono/zod-openapi';
import type { MembershipRole } from '@mwc/shared/enums';
import { companyRoute as sharedRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { CompanyParamsSchema, CompanySchema, DeleteCompanySchema, UpdateCompanySchema } from '../schemas.ts';
import { logoRefOf } from '../service/logo.ts';
import { type CompaniesService, companyView } from '../service.ts';

/** `GET`, `PATCH` and `DELETE /api/companies/{companyId}`: read (member), rename (admin), delete (owner). */

/** What every route here shares: the path, the bearer credential and the role guard, and the guard's refusals. */
const companyRoute = (deps: ServerDeps, role: MembershipRole) =>
  sharedRoute(deps, { role, path: '/api/companies/{companyId}', tag: 'companies' });

const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');

const getCompanyRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, 'member');
  return createRoute({
    ...base,
    method: 'get',
    summary: 'A company (member and above)',
    request: { params: CompanyParamsSchema },
    responses: { 200: jsonResponse('The company', CompanySchema), ...refusals },
  });
};

const updateCompanyRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, 'admin');
  return createRoute({
    ...base,
    method: 'patch',
    summary: 'Rename a company or change its slug (admin and above)',
    request: { params: CompanyParamsSchema, body: jsonBody(UpdateCompanySchema) },
    responses: {
      200: jsonResponse('The company after the change', CompanySchema),
      400: INVALID,
      ...refusals,
      409: errorResponse('The slug is taken (`slug_taken`)'),
    },
  });
};

const deleteCompanyRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, 'owner');
  return createRoute({
    ...base,
    method: 'delete',
    summary: 'Delete a company (owner only), confirmed by its name',
    description:
      'A soft delete: the company is a 404 for everyone from then on; the outbox `delete_org` call follows.',
    request: { params: CompanyParamsSchema, body: jsonBody(DeleteCompanySchema) },
    responses: {
      204: { description: 'Deleted' },
      400: INVALID,
      ...refusals,
      422: errorResponse('`confirmName` is not the company name (`confirmation_mismatch`)'),
    },
  });
};

export function companyRoutes(deps: ServerDeps, companies: CompaniesService) {
  return newRouter()
    .openapi(getCompanyRoute(deps), async (c) =>
      c.json(companyView(c.var.tenant.company, await logoRefOf(c.var.tenant)), 200),
    )
    .openapi(updateCompanyRoute(deps), async (c) => {
      const result = await companies.update(
        c.var.tenant,
        c.var.membership,
        c.req.valid('json'),
        c.var.requestId,
      );
      if (!result.ok) return errorJson(c, 409, result.code, result.message);
      return c.json(companyView(result.company, await logoRefOf(c.var.tenant)), 200);
    })
    .openapi(deleteCompanyRoute(deps), async (c) => {
      const { tenant, membership, requestId } = c.var;
      const result = await companies.remove(
        tenant,
        membership,
        c.req.valid('json').confirmName,
        requestId,
        c.var.clock(),
      );
      if (!result.ok) return errorJson(c, 422, result.code, result.message);
      return c.body(null, 204);
    });
}
