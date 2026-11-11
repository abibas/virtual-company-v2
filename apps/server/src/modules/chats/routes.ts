import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import type { Keyring } from '../../platform/secrets/keyring.ts';
import { credentialsForHarness, providerFetchFor } from '../credentials/index.ts';
import type { RunnerHub, TerminalTickets } from '../machines/index.ts';
import { standingReader } from '../org/index.ts';
import { answerRoutes } from './routes/answers.ts';
import { branchRoutes } from './routes/branch.ts';
import { chatRoutes } from './routes/chats.ts';
import { conversationRoutes } from './routes/conversation.ts';
import { historyRoutes } from './routes/history.ts';
import { queueRoutes } from './routes/queue.ts';
import { streamRoutes } from './routes/stream.ts';
import { chatTerminalRoutes } from './routes/terminal.ts';
import { turnRoutes } from './routes/turns.ts';
import { chatQueue } from './service/drain.ts';
import { chatsLive } from './service/live.ts';
import type { TaskTurnHook } from './service/task-hook.ts';
import { taskTurns } from './service/tasks.ts';

/**
 * What the chats need beyond the server's deps: the runner hub, the terminal tickets, the master keyring and (S5.3b)
 * the tasks module's side of a task's conversation.
 */
export interface ChatsDeps extends ServerDeps {
  readonly hub: RunnerHub;
  readonly tickets: TerminalTickets;
  readonly keyring: Keyring;
  readonly tasks?: TaskTurnHook | undefined;
}

/**
 * The chats' live part of a server process, made once per app and shared: the credentials module's side for turns
 * (subscriptions opened, refreshed, sealed again), the org module's standing instructions of an agent, the live turns
 * of this process (their sinks, their stops, the stream's listeners), the queue that starts the next waiting turn when
 * one ends, and (S5.3b) the way the tasks module runs a step (`taskTurns`).
 */
export function chatsRuntime(deps: ChatsDeps) {
  const providerFetch = deps.providerFetch ?? providerFetchFor(deps.config);
  const credentials = credentialsForHarness({ ...deps, providerFetch });
  const live = chatsLive({ logger: deps.logger, clock: deps.clock, credentials, tasks: deps.tasks });
  const turns = { ...deps, credentials, live, standing: standingReader(deps) };
  const queue = chatQueue(turns);
  live.onEnded((t, chatId) => queue.startNext(t, chatId));
  return { turns, queue, live, taskTurns: taskTurns(turns) };
}

export type ChatsRuntime = ReturnType<typeof chatsRuntime>;

/**
 * The chats module's routes (S5.1b, docs/harness.md "How a turn runs"): chats with an agent, their turns (the older
 * ones a page at a time), a branch from a reply, Compact and Clear (S5.2), answers to the agent's questions (S5.2 step
 * 4), the messages that wait for a running turn (S5.2 step 6), the chat's stream and its terminal, on the app's runtime
 * (`chatsRuntime`, one of its own when none is given).
 */
export function chatsRoutes(deps: ChatsDeps, runtime: ChatsRuntime = chatsRuntime(deps)) {
  const { turns, queue, live } = runtime;
  const queued = { ...turns, queue };
  return newRouter()
    .route('/', chatRoutes(deps))
    .route('/', branchRoutes(deps))
    .route('/', turnRoutes(queued))
    .route('/', historyRoutes(deps))
    .route('/', queueRoutes(queued))
    .route('/', conversationRoutes(turns))
    .route('/', answerRoutes(turns))
    .route('/', streamRoutes(deps, { bus: live.bus }))
    .route('/', chatTerminalRoutes({ ...turns, tickets: deps.tickets }));
}
