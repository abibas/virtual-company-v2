// The tasks module (S5.3a): a team's flow of steps, its tasks moved through them by hand, their history and the
// board; S5.3b runs a task's step through the chats module (`steps`) and hears of its turns (`taskTurnHook`).
// createApp mounts its router and wires both.
export { tasksRoutes } from './routes.ts';
export { taskTurnHook } from './service/hook.ts';
