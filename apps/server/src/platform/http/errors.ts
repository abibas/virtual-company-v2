import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { isCompanyNotFound } from '@mwc/db';
import { isIdentityProviderError } from '@mwc/identity-core';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from 'pino';
import type { AppEnv } from '../env.ts';

/** Every error response: `{ error: { code, message, requestId } }`. */
export const ErrorBodySchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: 'not_found' }),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi('Error');

export type ErrorBody = z.infer<typeof ErrorBodySchema>;

const CODES: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'too_many_requests',
};

/** The machine-readable `code` for an HTTP status the client caused. */
export function errorCode(status: number): string {
  return CODES[status] ?? 'error';
}

/** The one message for a company that is missing, deleted, malformed or not the caller's (never leak which). */
export const COMPANY_NOT_FOUND = 'Company not found';

/** An error response in the common shape, from any route's context (also behind auth middleware). */
export function errorJson<E extends AppEnv, S extends ContentfulStatusCode>(
  c: Context<E>,
  status: S,
  code: string,
  message: string,
) {
  const body: ErrorBody = { error: { code, message, requestId: c.get('requestId') } };
  return c.json(body, status);
}

/**
 * The app's error handler. A client error (an HTTPException below 500) keeps its status and
 * message. `CompanyNotFoundError` (from `tenant()`) is a 404, and an identity provider that is down or
 * rate limited a 503 `identity_unavailable` (with `Retry-After` when it said how long). Anything else is a
 * 500 whose body says only "Internal server error" and the request id; the error and its stack go to the
 * log, never to the client.
 */
export function errorHandler(logger: Logger): ErrorHandler<AppEnv> {
  return (error, c) => {
    if (error instanceof HTTPException && error.status < 500) {
      return errorJson(c, error.status, errorCode(error.status), error.message || 'Request failed');
    }
    if (isCompanyNotFound(error)) return errorJson(c, 404, 'not_found', COMPANY_NOT_FOUND);
    if (isIdentityProviderError(error) && error.retryable) {
      logger.warn({ err: error, requestId: c.var.requestId }, 'identity provider unavailable');
      if (error.retryAfterMs !== undefined)
        c.header('retry-after', String(Math.ceil(error.retryAfterMs / 1000)));
      return errorJson(
        c,
        503,
        'identity_unavailable',
        'The identity provider is unavailable; try again shortly',
      );
    }
    logger.error(
      { err: error, requestId: c.var.requestId, method: c.req.method, path: c.req.path },
      'request failed',
    );
    return errorJson(c, 500, 'internal', 'Internal server error');
  };
}

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  errorJson(c, 404, 'not_found', `No route for ${c.req.method} ${c.req.path}`);

/** zod-openapi's validation hook for every router: a 400 in the common error shape. */
export const validationHook: Hook<unknown, AppEnv, string, unknown> = (result, c) => {
  if (!result.success) {
    return errorJson(c, 400, 'invalid_request', z.prettifyError(result.error));
  }
  return undefined;
};
