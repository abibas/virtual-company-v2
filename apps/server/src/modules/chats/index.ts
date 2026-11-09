// The chats module (S5.1b): chats with an agent on its machine, their turns and events, the chat's stream and its
// terminal. createApp mounts its router; platform/start.ts fails the turns a stopped server left running (reapTurns).
export { type ChatsDeps, chatsRoutes } from './routes.ts';
export { reapTurns, SERVER_RESTARTED } from './service/reaper.ts';
