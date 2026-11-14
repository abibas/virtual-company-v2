// The chats module (S5.1b): chats with an agent on its machine, their turns and events, the chat's stream and its
// terminal. createApp makes its runtime once, mounts its router and hands the tasks module its way to run a step's turn
// (S5.3b: `taskTurns`, with the tasks module's `TaskTurnHook` passed in); platform/start.ts fails the turns a stopped
// server left waiting (reapTurns), and the runtime takes back the running ones from their runners (S5.4). Since S6c the
// runtime's `teamChats` wakes a flow's Lead agent in its team chat for the tasks module. Since S7.1c a turn gets the
// server's own tools of its profile through `ServerToolsHook`, which the integrations module implements. Since
// 2026-11-13 a Slack message asks an agent for a turn through `InboundChats`, and its end comes back by `InboundTurnHook`
// (since 2026-11-14 with whom the turn speaks for, `TurnFrom`, and where the hook posted the reply). Since 2026-11-14
// every message turn gets `record_decision`, whose calls the decisions module stores (`DecisionsHook`).
export { type ChatsDeps, type ChatsRuntime, chatsRoutes, chatsRuntime } from './routes.ts';
export { senderOf, type TurnFrom, type TurnSenderView, visibleTextOf } from './rules/sender.ts';
export type { DecisionRecorded, DecisionsHook, DecisionTurn } from './service/decisions.ts';
export type {
  InboundChats,
  InboundReply,
  InboundTurnHook,
  InboundTurnRequest,
  InboundTurnSent,
} from './service/inbound.ts';
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
