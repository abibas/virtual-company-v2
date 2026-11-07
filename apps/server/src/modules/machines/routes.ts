import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { runnerDownloadRoutes } from './routes/download.ts';
import { enrollmentRoutes } from './routes/enrollment.ts';
import { machineRoutes } from './routes/machines.ts';
import { placementRoutes } from './routes/placement.ts';
import { powerRoutes } from './routes/power.ts';
import { runnerSocketRoutes } from './routes/runner.ts';
import type { RunnerHub } from './service/hub.ts';
import { holdOnConnect } from './service/power/hold.ts';
import { tunnelsOnConnect } from './service/power/tunnels.ts';
import { powerService } from './service/power.ts';
import { machinesService } from './service.ts';

/**
 * The machines module's routes (docs/machines.md): the machines and their stats, enrolling a machine, the runner's
 * installer and bundle (S4.5), the runners' socket, which the hub serves (S4.2), each machine's power (S4.4b) and the
 * agents' placements on the machines (S4.7). A runner that connects gets its machine's hold at once, and a power
 * controller its devboxes' tunnels (the hub's connect listeners, registered here once per app). Both ends of every
 * tunnel are this server's own port.
 */
export function machinesRoutes(deps: ServerDeps & { readonly hub: RunnerHub }) {
  const linked = { ...deps, port: deps.config.MWC_PORT };
  const machines = machinesService(linked);
  deps.hub.onConnect(holdOnConnect(deps));
  deps.hub.onConnect(tunnelsOnConnect(linked));
  return newRouter()
    .route('/', enrollmentRoutes(linked))
    .route('/', runnerDownloadRoutes(deps))
    .route('/', machineRoutes(deps, machines))
    .route('/', powerRoutes(deps, powerService(linked)))
    .route('/', placementRoutes(deps))
    .route('/', runnerSocketRoutes(deps, deps.hub));
}
