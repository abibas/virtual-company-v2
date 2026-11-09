// The machines module (S4.2): enrollment, the runner hub and its socket, the machines and their stats, the upkeep job,
// the agents' placements (S4.7) and a machine's terminal (owners' tickets, the browser's socket relayed to the runner).
// The chats module (S5.1b) reads an agent's placement (agentPlacement), starts its turns through the hub and issues its
// terminals' tickets on the store createApp shares (terminalTickets).
// createApp mounts its router and makes the hub and the power control (who drives the devboxes); moduleJobs runs its
// upkeep; the org module shows each agent's placement (placementsOf).
export { machinesRoutes } from './routes.ts';
export { TerminalTicketSchema, type TerminalTicketView } from './schemas/terminal.ts';
export { agentPlacement, type PlacementSummary, placementsOf } from './service/placement.ts';
export { createPowerControl, type PowerControl } from './service/power/control.ts';
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
  type TurnChannel,
  type TurnEnding,
  type TurnRequest,
  type TurnSink,
} from './service/runner/hub.ts';
export {
  type IssuedTicket,
  type TerminalTickets,
  type TicketBinding,
  terminalTickets,
} from './service/terminal/tickets.ts';
export { machineUpkeep } from './service/upkeep.ts';
