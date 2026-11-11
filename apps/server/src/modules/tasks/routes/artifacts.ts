import { createRoute } from '@hono/zod-openapi';
import type { ServerDeps } from '../../../platform/env.ts';
import { jsonResponse } from '../../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { ArtifactBytesSchema, ArtifactListSchema, ArtifactParamsSchema } from '../schemas/artifacts.ts';
import { TaskParamsSchema } from '../schemas.ts';
import type { TasksService } from '../service.ts';
import { route } from './flows.ts';
import { NO_TASK } from './tasks.ts';

/**
 * A task's artifacts (S5.3b): `GET /api/companies/{companyId}/tasks/{taskId}/artifacts` lists them without their bytes,
 * `GET …/artifacts/{artifactId}/content` downloads one. Everyone of the company reads; another company's task is the
 * same 404 as none.
 */

const ARTIFACTS = '/api/companies/{companyId}/tasks/{taskId}/artifacts' as const;

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', ARTIFACTS);
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'get',
    summary: "A task's artifacts, oldest first, without their bytes (viewer and above)",
    description:
      'What its steps’ turns left, by step and round: the files the runner collected from the step’s folder, the ' +
      'files it left out (`skipped`, with why) and each round’s hand-off note (the turn’s final reply).',
    request: { params: TaskParamsSchema },
    responses: { 200: jsonResponse('Its artifacts', ArtifactListSchema), 401: refusals[401], 404: NO_TASK },
  });
};

const contentRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, 'viewer', `${ARTIFACTS}/{artifactId}/content`);
  const bytes = { schema: ArtifactBytesSchema };
  return createRoute({
    ...base,
    tags: ['tasks'],
    method: 'get',
    summary: "An artifact's bytes (viewer and above)",
    description:
      'Its stored `Content-Type` (text as UTF-8, or a PNG, JPEG, GIF or WebP image), as an attachment named after it, ' +
      'with `nosniff` and a CSP that runs nothing; `ETag` is its SHA-256.',
    request: { params: ArtifactParamsSchema },
    responses: {
      200: { description: 'The bytes', content: { 'application/octet-stream': bytes } },
      401: refusals[401],
      404: errorResponse(
        'No such company or not an active member (`not_found`), no such task (`task_not_found`), or no such ' +
          'artifact with bytes on it (`artifact_not_found`)',
      ),
    },
  });
};

/** A file name for `Content-Disposition`: the path's last part, plain ASCII, and the UTF-8 form beside it. */
function disposition(name: string): string {
  const base = name.split('/').at(-1) ?? 'artifact';
  const ascii = base.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

export function artifactRoutes(deps: ServerDeps, tasks: TasksService) {
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const result = await tasks.artifacts(c.var.tenant, c.req.valid('param').taskId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      return c.json({ artifacts: result.artifacts }, 200);
    })
    .openapi(contentRoute(deps), async (c) => {
      const { taskId, artifactId } = c.req.valid('param');
      const result = await tasks.artifact(c.var.tenant, taskId, artifactId);
      if (!result.ok) return errorJson(c, result.status, result.code, result.message);
      const { artifact } = result;
      return c.body(new Uint8Array(artifact.bytes), 200, {
        'content-type': artifact.contentType ?? 'application/octet-stream',
        'content-disposition': disposition(
          artifact.name === 'hand-off note' ? 'hand-off-note.md' : artifact.name,
        ),
        'content-security-policy': "default-src 'none'",
        'x-content-type-options': 'nosniff',
        etag: `"${artifact.sha256}"`,
      });
    });
}
