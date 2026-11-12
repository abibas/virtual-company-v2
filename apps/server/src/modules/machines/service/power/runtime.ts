import type { ServerDeps } from '../../../../platform/env.ts';
import { COMPOSE_FILE } from '../../../health/service.ts';
import { machineJobs } from '../jobs.ts';
import type { RunnerHub } from '../runner/hub.ts';
import { containerPower } from './container.ts';
import type { PowerControl } from './control.ts';
import { machineWake } from './wake.ts';

/**
 * The machines' power share of a server process, made once per app (`createApp`) and shared by the machines' routes and
 * the chats: the maintenance lock (`jobs`: one install, runner update or container start or stop at a time per
 * machine), the container runners' Start and Stop with this server's Docker CLI (`containers`), and the wakes for work
 * (`wake`), which start a machine through the same paths as a Start by hand.
 */
export function machinePowerRuntime(
  deps: ServerDeps & { readonly hub: RunnerHub; readonly control: PowerControl },
) {
  const jobs = machineJobs(deps.clock);
  const containers = containerPower({
    docker: deps.localDocker,
    composeFile: deps.config.NODE_ENV === 'production' ? null : COMPOSE_FILE,
    hub: deps.hub,
    jobs,
    logger: deps.logger,
  });
  const wake = machineWake({ ...deps, containers });
  return { jobs, containers, wake };
}

export type MachinePowerRuntime = ReturnType<typeof machinePowerRuntime>;
