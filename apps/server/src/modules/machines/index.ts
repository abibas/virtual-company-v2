// The machines module (S4.2): enrollment, the runner hub and its socket, the machines and their stats, the upkeep job,
// the agents' placements (S4.7) and a machine's terminal (owners' tickets, the browser's socket relayed to the runner).
// createApp mounts its router and makes the hub; moduleJobs runs its upkeep; the org module shows each agent's
// placement (placementsOf).
export { machinesRoutes } from './routes.ts';
export {
  type CommandFrame,
  type ConnectedRunner,
  createRunnerHub,
  HubError,
  type HubErrorCode,
  type HubOptions,
  type ReplyTo,
  type RunnerHub,
  type TerminalChannel,
  type TerminalEnding,
  type TerminalRequest,
  type TerminalSink,
} from './service/hub.ts';
export { type PlacementSummary, placementsOf } from './service/placement.ts';
export { machineUpkeep } from './service/upkeep.ts';
