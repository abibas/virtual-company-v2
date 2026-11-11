// The org module: the agents, everyone's place on the chart and the chart itself. createApp mounts its router and
// passes its side of a membership's start and end (memberChart) to the identity and members modules, and an agent's
// standing instructions (standingReader) to the chats module.
export { orgRoutes } from './routes.ts';
export { standingReader } from './service/briefing.ts';
export { memberChart } from './service/lifecycle.ts';
