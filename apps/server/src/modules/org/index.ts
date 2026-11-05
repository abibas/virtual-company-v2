// The org module: the agents, everyone's place on the chart and the chart itself. createApp mounts its router and
// passes its side of a membership's start and end (memberChart) to the identity and members modules.
export { orgRoutes } from './routes.ts';
export { memberChart } from './service/lifecycle.ts';
