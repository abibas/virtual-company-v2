// The chats module (S5.1b): chats with an agent on its machine, their turns and events, the chat's stream and its
// terminal. createApp makes its runtime once, mounts its router and hands the tasks module its way to run a step's turn
// (S5.3b: `taskTurns`, with the tasks module's `TaskTurnHook` passed in); platform/start.ts fails the turns a stopped
// server left waiting (reapTurns), and the runtime takes back the running ones from their runners (S5.4). Since S6c the
// runtime's `teamChats` wakes a flow's Lead agent in its team chat for the tasks module. Since S7.1c a turn gets the
// server's own tools of its profile through `ServerToolsHook`, which the integrations module implements.
export { type ChatsDeps, type ChatsRuntime, chatsRoutes, chatsRuntime } from './routes.ts';
export { reapTurns, SERVER_RESTARTED } from './service/reaper.ts';
export type { GitUse, ServerToolsHook, ServerToolsPlan, ServerToolTurn } from './service/server-tools.ts';
export type {
  AgentToolsPlan,
  AgentToolTurn,
  SystemTurnEnd,
  TaskTurnContext,
  TaskTurnDraft,
  TaskTurnEnd,
  TaskTurnHook,
  TaskTurnLink,
  TaskTurnPlan,
} from './service/task-hook.ts';
export type { StepPrompts, TaskTurnRequest, TaskTurnStarted, TaskTurns } from './service/tasks.ts';
export type { LeadWakeRequest, LeadWakeSent, RoomTurnRequest, TeamChats } from './service/team.ts';
