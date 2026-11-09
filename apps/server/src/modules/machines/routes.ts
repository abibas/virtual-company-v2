import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { runnerDownloadRoutes } from './routes/download.ts';
import { enrollmentRoutes } from './routes/enrollment.ts';
import { machineLogoRoutes } from './routes/logo.ts';
import { machineRoutes } from './routes/machines.ts';
import { placementRoutes } from './routes/placement.ts';
import { powerRoutes } from './routes/power.ts';
import { runnerSocketRoutes } from './routes/runner.ts';
import { terminalRoutes } from './routes/terminal.ts';
import { runnerUpdateRoutes } from './routes/update.ts';
import { type PowerControl, tunnelsOnConnect } from './service/power/control.ts';
import { holdOnConnect } from './service/power/hold.ts';
import { powerService } from './service/power.ts';
import type { RunnerHub } from './service/runner/hub.ts';
import type { TerminalTickets } from './service/terminal/tickets.ts';
import { machinesService } from './service.ts';

/**
 * The machines module's routes (docs/machines.md): the machines and their stats, enrolling a machine, the runner's
 * installer and bundle (S4.5), the runners' socket, which the hub serves (S4.2), each machine's power (S4.4b), the
 * agents' placements on the machines (S4.7), each machine's logo, a machine's terminal for its owners (tickets and the
 * browser's socket) and the update of its runner. A runner that connects gets its machine's hold at once, and a power
 * controller its devboxes' tunnels, an empty set while this server drives them (the hub's connect listeners, registered
 * here once per app). The power control (`control`) says who drives the devboxes; both ends of every tunnel are this
 * server's own port.
 */
export function machinesRoutes(
  deps: ServerDeps & {
    readonly hub: RunnerHub;
    readonly control: PowerControl;
    /** The terminal tickets, shared with the chats' terminals (S5.1b); omitted, the terminal routes keep their own. */
    readonly tickets?: TerminalTickets;
  },
) {
  const linked = { ...deps, port: deps.config.MWC_PORT };
  const machines = machinesService(linked);
  deps.hub.onConnect(holdOnConnect(deps));
  deps.hub.onConnect(tunnelsOnConnect(linked));
  return newRouter()
    .route('/', enrollmentRoutes(linked))
    .route('/', runnerDownloadRoutes(deps))
    .route('/', machineRoutes(deps, machines))
    .route('/', machineLogoRoutes(deps))
    .route('/', powerRoutes(deps, powerService(linked)))
    .route('/', placementRoutes(deps))
    .route('/', runnerSocketRoutes(deps, deps.hub))
    .route('/', terminalRoutes(deps))
    .route('/', runnerUpdateRoutes(deps));
}
