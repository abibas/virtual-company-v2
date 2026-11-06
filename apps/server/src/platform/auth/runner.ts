import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.ts';
import { errorJson } from '../http/errors.ts';
import { type AuthFailure, unauthenticated } from './actor.ts';
import { checkRunnerKey, type RunnerCredential } from './api-keys.ts';
import type { AuthDeps } from './authn.ts';
import { readBearer } from './bearer.ts';

/** The environment of a route behind `authnRunner()`: the runner's machine and company on `c.var.runner`. */
export interface RunnerEnv extends AppEnv {
  Variables: AppEnv['Variables'] & { runner: RunnerCredential };
}

const NO_KEY: AuthFailure = unauthenticated('Send Authorization: Bearer <runner key>');

/**
 * Who is calling the runner's socket: `Authorization: Bearer <runner key>` turned into `c.var.runner` (S4.2). Anything
 * else is a 401 before any socket opens: no header, another kind of credential, an unknown, revoked or expired key, a
 * removed machine. Sessions and personal keys never open it.
 */
export function authnRunner(deps: Pick<AuthDeps, 'db' | 'logger'>): MiddlewareHandler<RunnerEnv> {
  return async (c, next) => {
    const token = readBearer(c.req.header('authorization'));
    const result = token === null ? NO_KEY : await checkRunnerKey(deps.db, token, c.var.clock(), deps.logger);
    if (!result.ok) {
      c.header('www-authenticate', 'Bearer');
      return errorJson(c, result.status, result.code, result.message);
    }
    c.set('runner', result.runner);
    await next();
  };
}
