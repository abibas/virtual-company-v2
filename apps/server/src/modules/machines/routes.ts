import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { runnerDownloadRoutes } from './routes/download.ts';
import { enrollmentRoutes } from './routes/enrollment.ts';
import { machineRoutes } from './routes/machines.ts';
import { powerRoutes } from './routes/power.ts';
import { runnerSocketRoutes } from './routes/runner.ts';
import type { RunnerHub } from './service/hub.ts';
import { holdOnConnect } from './service/power/hold.ts';
import { powerService } from './service/power.ts';
import { machinesService } from './service.ts';

/**
 * The machines module's routes (docs/machines.md): the machines and their stats, enrolling a machine, the runner's
 * installer and bundle (S4.5), the runners' socket, which the hub serves (S4.2), and each machine's power (S4.4b). A
 * runner that connects gets its machine's hold at once (the hub's connect listener, registered here once per app).
 */
export function machinesRoutes(deps: ServerDeps & { readonly hub: RunnerHub }) {
  const machines = machinesService(deps);
  deps.hub.onConnect(holdOnConnect(deps));
  return newRouter()
    .route('/', enrollmentRoutes(deps))
    .route('/', runnerDownloadRoutes(deps))
    .route('/', machineRoutes(deps, machines))
    .route('/', powerRoutes(deps, powerService(deps)))
    .route('/', runnerSocketRoutes(deps, deps.hub));
}
