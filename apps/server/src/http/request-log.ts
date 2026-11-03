import type { MiddlewareHandler } from 'hono';
import type { Logger } from 'pino';
import type { AppEnv } from '../env.ts';

/** Probes hit these every few seconds: a passing probe logs at debug, a failing one (503) at warn. */
const PROBES = new Set(['/healthz', '/readyz']);

/**
 * One log line per request, after the response: method, path (without the query string), status,
 * duration in ms and request id. Headers and bodies are never logged. Other 5xx log at error, 4xx at
 * warn, the rest at info.
 */
export function requestLog(logger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const status = c.res.status;
    const line = {
      requestId: c.var.requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      durationMs: Math.round((performance.now() - started) * 10) / 10,
    };
    if (PROBES.has(c.req.path)) logger[status < 400 ? 'debug' : 'warn'](line, 'request');
    else if (status >= 500) logger.error(line, 'request');
    else if (status >= 400) logger.warn(line, 'request');
    else logger.info(line, 'request');
  };
}
