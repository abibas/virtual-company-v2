import { createRoute } from '@hono/zod-openapi';
import { logoVersion } from '@mwc/shared/logos';
import { RUNNER_SHA256_HEADER, RUNNER_TURN_IMAGES_PATH } from '@mwc/shared/runner-protocol';
import { authnRunner } from '../../../platform/auth/runner.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { sendLogo } from '../../companies/routes/logo.ts';
import { ImageBytesSchema, ImageParamsSchema } from '../schemas/images.ts';
import { chatImage, runnerImage } from '../service/images.ts';
import { chatRoute } from './access.ts';

/**
 * A chat message's images (T-18, docs/harness.md "Images in a message"). `GET /api/companies/{companyId}/chats/{chatId}/
 * images/{imageId}`: one image for the chat's people, as reading the chat allows (members and above; an owner who is
 * not in it too), answered as a logo is (`sendLogo`: its ETag, cached for good since an image never changes, `nosniff`,
 * a CSP that runs nothing). `GET /api/runner/turns/{turnId}/images/{imageId}`: the same bytes for the runner of the
 * chat's machine, with its runner key, so it hands them to the harness before the turn starts (their SHA-256 in
 * `RUNNER_SHA256_HEADER`); another machine's runner gets a 404. The runner's route is not in the OpenAPI document.
 */

const IMAGE = '/api/companies/{companyId}/chats/{chatId}/images/{imageId}' as const;
const IMAGE_NOT_FOUND = { code: 'image_not_found', message: 'No such image in this chat' } as const;

const imageRoute = (deps: ServerDeps) => {
  const { base, refusals } = chatRoute(deps, { role: 'member', path: IMAGE, access: 'read' });
  const image = { schema: ImageBytesSchema };
  return createRoute({
    ...base,
    method: 'get',
    summary: "One image of a chat's messages (member and above)",
    description:
      'The image as it was sent: its stored `Content-Type`, `ETag: "<sha256>"`, cached for good (it never changes); a ' +
      'matching `If-None-Match` is a 304.',
    request: { params: ImageParamsSchema },
    responses: {
      200: {
        description: 'The image',
        content: { 'image/png': image, 'image/jpeg': image, 'image/webp': image, 'image/gif': image },
      },
      304: { description: 'Not modified: `If-None-Match` names it' },
      ...refusals,
      404: errorResponse(
        'No such company or not an active member (`not_found`), no such chat (`chat_not_found`), or no such image ' +
          'in it (`image_not_found`)',
      ),
    },
  });
};

export function imageRoutes(deps: ServerDeps) {
  return newRouter()
    .openapi(imageRoute(deps), async (c) => {
      const { chatId, imageId } = c.req.valid('param');
      const found = await chatImage(c.var.tenant, chatId, imageId);
      if (found === undefined) return errorJson(c, 404, IMAGE_NOT_FOUND.code, IMAGE_NOT_FOUND.message);
      return sendLogo(c, found, logoVersion(found.sha256));
    })
    .get(`${RUNNER_TURN_IMAGES_PATH}/:turnId/images/:imageId`, authnRunner(deps), async (c) => {
      const found = await runnerImage(deps.db, c.var.runner, c.req.param('turnId'), c.req.param('imageId'));
      if (found === undefined)
        return errorJson(c, 404, IMAGE_NOT_FOUND.code, 'No such image of a turn on this machine');
      return c.body(new Uint8Array(found.bytes), 200, {
        'content-type': found.contentType,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        [RUNNER_SHA256_HEADER]: found.sha256,
      });
    });
}
