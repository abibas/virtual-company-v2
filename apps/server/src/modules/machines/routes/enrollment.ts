import { createRoute } from '@hono/zod-openapi';
import { RUNNER_ENROLL_PATH, RunnerEnrollRequest, RunnerEnrollResponse } from '@mwc/shared/runner-protocol';
import { companyRoute } from '../../../platform/auth/membership.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { EnrollmentTokenSchema, MachinesParamsSchema } from '../schemas.ts';
import { createEnrollmentToken, enrollMachine } from '../service/enroll.ts';

/**
 * Enrolling a machine (docs/runner-protocol.md, "Enrollment"): an admin makes a one-time token
 * (`POST /api/companies/{companyId}/machines/enrollment-tokens`), and the installer on the machine trades it at
 * `POST /api/runner/enroll` for the machine's id and its runner key, both shown once.
 */

const createTokenRoute = (deps: ServerDeps) => {
  const { base, refusals } = companyRoute(deps, {
    role: 'admin',
    path: '/api/companies/{companyId}/machines/enrollment-tokens' as const,
    tag: 'machines',
  });
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Make a one-time token to enroll a machine (admin and above)',
    description:
      'The token is in this response only (only its SHA-256 is stored), good for one enrollment within the hour. ' +
      'The machine it enrolls gets a runner key owned by you.',
    request: { params: MachinesParamsSchema },
    responses: { 201: jsonResponse('The token, shown once', EnrollmentTokenSchema), ...refusals },
  });
};

const enrollRoute = createRoute({
  method: 'post',
  path: RUNNER_ENROLL_PATH,
  tags: ['runner'],
  summary: "Enroll a machine with a one-time token (the runner's installer)",
  description:
    'No session: the token is the credential. Makes the machine and its runner key (`mwc_rk_...`), which is in this ' +
    'response only. The token works once.',
  request: { body: jsonBody(RunnerEnrollRequest) },
  responses: {
    201: jsonResponse("The machine's id, its company and its runner key", RunnerEnrollResponse),
    400: errorResponse('The request does not match the schema (`invalid_request`)'),
    401: errorResponse('An unknown, used or expired enrollment token (`unauthenticated`)'),
  },
});

export function enrollmentRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(createTokenRoute(deps), async (c) => {
      const caller = {
        principalId: c.var.membership.principalId,
        requestId: c.var.requestId,
        now: c.var.clock(),
      };
      const token = await createEnrollmentToken(c.var.tenant, caller);
      c.header('cache-control', 'no-store');
      return c.json(token, 201);
    })
    .openapi(enrollRoute, async (c) => {
      const result = await enrollMachine(deps.db, c.req.valid('json'), c.var.clock(), c.var.requestId);
      if (!result.ok) {
        c.header('www-authenticate', 'Bearer');
        return errorJson(c, result.status as 401, result.code, result.message);
      }
      c.header('cache-control', 'no-store');
      return c.json(result.enrolled, 201);
    });
}
