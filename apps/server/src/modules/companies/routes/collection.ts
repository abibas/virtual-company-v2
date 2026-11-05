import { createRoute } from '@hono/zod-openapi';
import { authn } from '../../../platform/auth/authn.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { BEARER_SCHEME, jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { CompanyListSchema, CompanySchema, CreateCompanySchema } from '../schemas.ts';
import { type CompaniesService, companyView } from '../service.ts';

/** `POST /api/companies` and `GET /api/companies`: create a company, list mine. */

const UNAUTHENTICATED = errorResponse('No credential, or one that is not valid (`unauthenticated`)');

const createCompanyRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'post',
    path: '/api/companies',
    tags: ['companies'],
    security: [{ [BEARER_SCHEME]: [] }],
    summary: 'Create a company; the caller becomes its owner',
    description:
      'The company starts `provisioning` and turns `active` once the identity provider has its organization (the ' +
      'outbox `create_org` call). Who may create companies is MWC_COMPANY_CREATION (any, allowlist, none).',
    middleware: authn(deps),
    request: { body: jsonBody(CreateCompanySchema) },
    responses: {
      201: jsonResponse('The new company', CompanySchema),
      400: errorResponse('The request does not match the schema (`invalid_request`)'),
      401: UNAUTHENTICATED,
      403: errorResponse(
        'An API key (`forbidden`), a person not linked yet (`user_not_linked`), or the creation policy ' +
          '(`company_creation_disabled`, `company_creation_not_allowed`)',
      ),
      409: errorResponse('The chosen slug is taken (`slug_taken`)'),
    },
  });

const listCompaniesRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'get',
    path: '/api/companies',
    tags: ['companies'],
    security: [{ [BEARER_SCHEME]: [] }],
    summary: 'My companies, with my role in each (the companies GET /api/me lists)',
    middleware: authn(deps),
    responses: { 200: jsonResponse('My companies', CompanyListSchema), 401: UNAUTHENTICATED },
  });

export function collectionRoutes(deps: ServerDeps, companies: CompaniesService) {
  return newRouter()
    .openapi(createCompanyRoute(deps), async (c) => {
      const result = await companies.create(c.var.actor, c.req.valid('json'), c.var.requestId);
      if (!result.ok && result.status === 409) return errorJson(c, 409, result.code, result.message);
      if (!result.ok) return errorJson(c, 403, result.code, result.message);
      // A new company has no logo yet.
      return c.json(companyView(result.company, null), 201);
    })
    .openapi(listCompaniesRoute(deps), async (c) =>
      c.json({ companies: await companies.list(c.var.actor) }, 200),
    );
}
