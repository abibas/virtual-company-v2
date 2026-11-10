import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { COMPOSE_FILE } from '../health/service.ts';
import { runnerDownloadRoutes } from './routes/download.ts';
import { enrollmentRoutes } from './routes/enrollment.ts';
import { folderRoutes } from './routes/folders.ts';
import { machineLogoRoutes } from './routes/logo.ts';
import { machineRoutes } from './routes/machines.ts';
import { placementRoutes } from './routes/placement.ts';
import { powerRoutes } from './routes/power.ts';
import { runnerSocketRoutes } from './routes/runner.ts';
import { terminalRoutes } from './routes/terminal.ts';
import { toolRoutes } from './routes/tools.ts';
import { runnerUpdateRoutes } from './routes/update.ts';
import { machineJobs } from './service/jobs.ts';
import { containerPower } from './service/power/container.ts';
import { type PowerControl, tunnelsOnConnect } from './service/power/control.ts';
import { holdOnConnect } from './service/power/hold.ts';
import { powerService } from './service/power.ts';
import type { RunnerHub } from './service/runner/hub.ts';
import type { TerminalTickets } from './service/terminal/tickets.ts';
import { npmLatest, registryFetchFor } from './service/tools/npm.ts';
import { machinesService } from './service.ts';

/**
 * The machines module's routes (docs/machines.md): the machines and their stats, enrolling a machine, the runner's
 * installer and bundle (S4.5), the runners' socket, which the hub serves (S4.2), each machine's power (S4.4b), the
 * agents' placements on the machines (S4.7), each machine's logo, a machine's terminal for its owners (tickets and the
 * browser's socket), the update of its runner, its folders read and made through its runner (S5.1d), and its tools
 * (the CLIs its runner found, a check and an install of Claude Code or Codex). A runner that
 * connects gets its machine's hold at once, and a power controller its devboxes' tunnels, an empty set while this server
 * drives them (the hub's connect listeners, registered here once per app). The power control (`control`) says who
 * drives the devboxes; both ends of every tunnel are this server's own port. The latest Claude Code and Codex are
 * npm's (`registryFetch`), read once now and then every six hours, shared by the machines' views and the installs. The
 * machines' maintenance lock (`jobs`: one install, runner update or container start or stop at a time per machine) is
 * shared by the installs, the updates, the containers' Start and Stop (`containers`, with this server's Docker CLI when
 * it has one) and the machines' views; a runner that connects ends the update waiting for it.
 */
export function machinesRoutes(
  deps: ServerDeps & {
    readonly hub: RunnerHub;
    readonly control: PowerControl;
    /** The terminal tickets, shared with the chats' terminals (S5.1b); omitted, the terminal routes keep their own. */
    readonly tickets?: TerminalTickets;
  },
) {
  const npm = npmLatest({
    fetch: deps.registryFetch ?? registryFetchFor(deps.config),
    clock: deps.clock,
    logger: deps.logger,
  });
  void npm.refresh();
  const latest = () => npm.current();
  const jobs = machineJobs(deps.clock);
  const linked = { ...deps, port: deps.config.MWC_PORT };
  const machines = machinesService({ ...linked, latest, machineJobs: jobs });
  const containers = containerPower({
    docker: deps.localDocker,
    composeFile: deps.config.NODE_ENV === 'production' ? null : COMPOSE_FILE,
    hub: deps.hub,
    jobs,
    logger: deps.logger,
  });
  deps.hub.onConnect(holdOnConnect(deps));
  deps.hub.onConnect(tunnelsOnConnect(linked));
  deps.hub.onConnect((runner) => jobs.connected(runner.machineId));
  return newRouter()
    .route('/', enrollmentRoutes(linked))
    .route('/', runnerDownloadRoutes(deps))
    .route('/', machineRoutes(deps, machines))
    .route('/', machineLogoRoutes(deps))
    .route('/', powerRoutes(deps, powerService({ ...linked, containers })))
    .route('/', placementRoutes(deps))
    .route('/', runnerSocketRoutes(deps, deps.hub))
    .route('/', terminalRoutes(deps))
    .route('/', runnerUpdateRoutes({ ...deps, machineJobs: jobs }))
    .route('/', folderRoutes(deps))
    .route('/', toolRoutes({ ...deps, latest, machineJobs: jobs }));
}
