import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { enrollmentRoutes } from './routes/enrollment.ts';
import { machineRoutes } from './routes/machines.ts';
import { runnerSocketRoutes } from './routes/runner.ts';
import type { RunnerHub } from './service/hub.ts';
import { machinesService } from './service.ts';

/**
 * The machines module's routes (S4.2, docs/machines.md): the machines and their stats, enrolling a machine, and the
 * runners' socket, which the hub serves.
 */
export function machinesRoutes(deps: ServerDeps & { readonly hub: RunnerHub }) {
  const machines = machinesService(deps);
  return newRouter()
    .route('/', enrollmentRoutes(deps))
    .route('/', machineRoutes(deps, machines))
    .route('/', runnerSocketRoutes(deps, deps.hub));
}
