import { RUNNER_SUBPROTOCOL, RUNNER_WS_PATH } from '@mwc/shared/runner-protocol';
import type { MiddlewareHandler } from 'hono';
import { authnRunner, type RunnerEnv } from '../../../platform/auth/runner.ts';
import type { ServerDeps } from '../../../platform/env.ts';
import { errorJson } from '../../../platform/http/errors.ts';
import { newRouter } from '../../../platform/http/router.ts';
import { upgradeSocket } from '../../../platform/realtime/sockets.ts';
import type { RunnerHub } from '../service/runner/hub.ts';

/**
 * `GET /api/runner/ws`: a runner's one WebSocket (docs/runner-protocol.md). Its runner key is checked before the
 * upgrade (401, no socket), and it must speak `mwc-runner.v1` (400); then the hub takes the socket. Not in the OpenAPI
 * document: it is no JSON route.
 */

/** Refuses an upgrade that does not offer the runner protocol's subprotocol. */
const speaksRunnerProtocol: MiddlewareHandler<RunnerEnv> = async (c, next) => {
  const offered = (c.req.header('sec-websocket-protocol') ?? '')
    .split(',')
    .map((protocol) => protocol.trim());
  if (!offered.includes(RUNNER_SUBPROTOCOL)) {
    return errorJson(c, 400, 'unsupported_subprotocol', `A runner speaks ${RUNNER_SUBPROTOCOL}`);
  }
  await next();
};

export function runnerSocketRoutes(deps: ServerDeps, hub: RunnerHub) {
  return newRouter().get(
    RUNNER_WS_PATH,
    authnRunner(deps),
    speaksRunnerProtocol,
    upgradeSocket<RunnerEnv>((c, link) => hub.open(link, c.var.runner), { pingMs: hub.pingMs }),
  );
}
