// The org module: the agents, everyone's place on the chart and the chart itself. createApp mounts its router and
// passes its side of a membership's start and end (memberChart) to the identity and members modules, an agent's
// standing instructions (standingReader) to the chats module, and the live chart (orgOf) to the tasks module. The tasks,
// inbox and notifications modules read the principals' names with principalNames.

export { orgRoutes } from './routes.ts';
export type { OrgState } from './rules/placement.ts';
export { standingReader } from './service/briefing.ts';
export { memberChart } from './service/lifecycle.ts';
export { type PrincipalName, type PrincipalNames, principalNames, SOMEONE } from './service/names.ts';
export { orgOf } from './service/read.ts';
