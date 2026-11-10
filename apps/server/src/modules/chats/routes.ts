import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import type { Keyring } from '../../platform/secrets/keyring.ts';
import { credentialsForHarness, providerFetchFor } from '../credentials/index.ts';
import type { RunnerHub, TerminalTickets } from '../machines/index.ts';
import { answerRoutes } from './routes/answers.ts';
import { chatRoutes } from './routes/chats.ts';
import { conversationRoutes } from './routes/conversation.ts';
import { historyRoutes } from './routes/history.ts';
import { queueRoutes } from './routes/queue.ts';
import { streamRoutes } from './routes/stream.ts';
import { chatTerminalRoutes } from './routes/terminal.ts';
import { turnRoutes } from './routes/turns.ts';
import { chatQueue } from './service/drain.ts';
import { chatsLive } from './service/live.ts';

/** What the chats need beyond the server's deps: the runner hub, the terminal tickets and the master keyring. */
export interface ChatsDeps extends ServerDeps {
  readonly hub: RunnerHub;
  readonly tickets: TerminalTickets;
  readonly keyring: Keyring;
}

/**
 * The chats module's routes (S5.1b, docs/harness.md "How a turn runs"): chats with an agent, their turns (the older
 * ones a page at a time), Compact and Clear (S5.2), answers to the agent's questions (S5.2 step 4), the messages that wait for a running turn (S5.2 step
 * 6), the chat's stream and its terminal. The live turns of this process (their sinks, their stops, the stream's
 * listeners) and the queue that starts the next waiting turn when one ends are made here once per app, on the
 * credentials module's side for turns (subscriptions opened, refreshed, sealed again).
 */
export function chatsRoutes(deps: ChatsDeps) {
  const providerFetch = deps.providerFetch ?? providerFetchFor(deps.config);
  const credentials = credentialsForHarness({ ...deps, providerFetch });
  const live = chatsLive({ logger: deps.logger, clock: deps.clock, credentials });
  const turns = { ...deps, credentials, live };
  const queue = chatQueue(turns);
  live.onEnded((t, chatId) => queue.startNext(t, chatId));
  const queued = { ...turns, queue };
  return newRouter()
    .route('/', chatRoutes(deps))
    .route('/', turnRoutes(queued))
    .route('/', historyRoutes(deps))
    .route('/', queueRoutes(queued))
    .route('/', conversationRoutes(turns))
    .route('/', answerRoutes(turns))
    .route('/', streamRoutes(deps, { bus: live.bus }))
    .route('/', chatTerminalRoutes({ ...turns, tickets: deps.tickets }));
}
