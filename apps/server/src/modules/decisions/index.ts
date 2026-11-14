// The decisions module (2026-11-14): the decision log. Agents record their real decisions with the `record_decision`
// tool, which the chats module offers in every message turn and hands to this module's hook (`decisionsHook`, passed
// in by createApp); people read them back through `decisionsRoutes`, in the chat, on the agent's page and the task's.
export { decisionsRoutes } from './routes.ts';
export { decisionsHook } from './service.ts';
