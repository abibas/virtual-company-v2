import type { TenantDb } from '@mwc/db';
import type { ServerDeps } from '../../platform/env.ts';
import { newRouter } from '../../platform/http/router.ts';
import { SYSTEM_TIMERS } from '../../platform/jobs/runner.ts';
import type { Keyring } from '../../platform/secrets/keyring.ts';
import { credentialsForHarness, providerFetchFor } from '../credentials/index.ts';
import type { MachineWake, RunnerHub, TerminalTickets } from '../machines/index.ts';
import { standingReader } from '../org/index.ts';
import { answerRoutes } from './routes/answers.ts';
import { branchRoutes } from './routes/branch.ts';
import { chatRoutes } from './routes/chats.ts';
import { conversationRoutes } from './routes/conversation.ts';
import { historyRoutes } from './routes/history.ts';
import { overrideRoutes } from './routes/overrides.ts';
import { queueRoutes } from './routes/queue.ts';
import { reportChatRoutes } from './routes/reports.ts';
import { streamRoutes } from './routes/stream.ts';
import { chatTerminalRoutes } from './routes/terminal.ts';
import { turnRoutes } from './routes/turns.ts';
import { failLeftTurns, turnAdopter } from './service/adopt.ts';
import { type ChatQueue, chatQueue } from './service/drain.ts';
import { type InboundTurnHook, inboundChats } from './service/inbound.ts';
import { chatsLive } from './service/live.ts';
import { machineWaits } from './service/machine-wait.ts';
import { runnerUpdateFor, type ServerToolsHook } from './service/server-tools.ts';
import { startAfresh } from './service/session-lost.ts';
import { slotWaits, slotWordsOf } from './service/slot-wait.ts';
import type { TaskTurnHook } from './service/task-hook.ts';
import { taskTurns } from './service/tasks.ts';
import { teamChats } from './service/team.ts';

/**
 * What the chats need beyond the server's deps: the runner hub, the terminal tickets, the master keyring, (S5.3b) the
 * tasks module's side of a task's conversation, and the machines' wake of a stopped machine.
 */
export interface ChatsDeps extends ServerDeps {
  readonly hub: RunnerHub;
  readonly tickets: TerminalTickets;
  readonly keyring: Keyring;
  readonly tasks?: TaskTurnHook | undefined;
  /** The server's own tools (S7.1c: the Atlassian tools), offered by a turn's profile. */
  readonly serverTools?: ServerToolsHook | undefined;
  /** What hears the end of a turn a Slack message started (2026-11-13: the integrations module posts its answer). */
  readonly inbound?: InboundTurnHook | undefined;
  readonly wake: MachineWake;
}

/**
 * The chats' live part of a server process, made once per app and shared: the credentials module's side for turns
 * (subscriptions opened, refreshed, sealed again), the org module's standing instructions of an agent, the live turns
 * of this process (their sinks, their stops, the stream's listeners), the queue that starts the next waiting turn when
 * one ends, and (S5.3b) the way the tasks module runs a step (`taskTurns`). Since S5.4 it takes back the turns a
 * stopped server left running as their runners say hello with them (the hub's adopter), and once the grace after its
 * start is over ends those no runner took back (`server_restarted`). Since S6c it wakes a flow's Lead agent in its team
 * chat for the tasks module (`teamChats`). A turn for a stopped machine waits for it (`machineWaits`): the machine's
 * runner connecting starts its chats' waiting turns, and a start that failed ends them. A turn for a machine with every
 * slot taken waits for a free one (`slotWaits`): each turn's end starts the chats waiting on its machine. A turn whose
 * conversation the harness lost starts again on a fresh one with a recap (`startAfresh`, 2026-11-13). A message from
 * outside (a Slack message, 2026-11-13) asks an agent for a turn in its conversation's chat (`inboundChats`), and every
 * turn Most Wanted queued tells its end to the inbound hook.
 */
export function chatsRuntime(deps: ChatsDeps) {
  const providerFetch = deps.providerFetch ?? providerFetchFor(deps.config);
  const credentials = credentialsForHarness({ ...deps, providerFetch });
  const { logger, clock, tasks, serverTools, inbound } = deps;
  const live = chatsLive({ logger, clock, credentials, tasks, serverTools, inbound });
  const later = {} as { queue: ChatQueue };
  const timers = deps.machineWaitTimers ?? SYSTEM_TIMERS;
  const startNext = (t: TenantDb, chatId: string) => later.queue.startNext(t, chatId);
  const waits = machineWaits({ ...deps, live, timers, startNext, slotWords: slotWordsOf(deps) });
  const turns = { ...deps, credentials, live, standing: standingReader(deps), waits };
  const queue = chatQueue(turns);
  later.queue = queue;
  const slots = slotWaits({ ...deps, waits, startNext });
  live.onEnded(async (t, chatId) => {
    await queue.startNext(t, chatId);
    await slots.freed(t, chatId);
  });
  live.onBusy((t, turn) => slots.held(t, turn));
  live.onSessionLost((t, turn, lost) => startAfresh(turns, t, turn, lost));
  deps.hub.onConnect((runner) => void waits.connected(runner));
  deps.wake.onFailed((failure) => void waits.failed(failure));
  const adopt = { db: deps.db, logger: deps.logger, live, tasks: deps.tasks };
  deps.hub.adoptTurns(turnAdopter(adopt));
  const startedAt = deps.clock();
  const sweep = setTimeout(
    () => void failLeftTurns(adopt, startedAt),
    deps.config.MWC_TURN_GRACE_SECONDS * 1000,
  );
  sweep.unref();
  deps.onShutdown?.(async () => clearTimeout(sweep));
  return {
    turns,
    queue,
    live,
    taskTurns: taskTurns(turns),
    teamChats: teamChats({ ...turns, queue }),
    inboundChats: inboundChats({ ...turns, queue }),
  };
}

export type ChatsRuntime = ReturnType<typeof chatsRuntime>;

/**
 * The chats module's routes (S5.1b, docs/harness.md "How a turn runs"): chats with an agent (with their own mode, model
 * and effort since 2026-11-13), their turns (the older
 * ones a page at a time), a branch from a reply, Compact and Clear (S5.2), answers to the agent's questions (S5.2 step
 * 4), the messages that wait for a running turn (S5.2 step 6), the chat's stream and its terminal, your direct reports'
 * main chats with you (the right rail's Chats), on the app's runtime
 * (`chatsRuntime`, one of its own when none is given).
 */
export function chatsRoutes(deps: ChatsDeps, runtime: ChatsRuntime = chatsRuntime(deps)) {
  const { turns, queue, live } = runtime;
  const queued = { ...turns, queue };
  return newRouter()
    .route(
      '/',
      chatRoutes(deps, { awayOf: live.awayOf, runnerUpdateFor: (t, chat) => runnerUpdateFor(deps, t, chat) }),
    )
    .route('/', overrideRoutes(deps))
    .route('/', reportChatRoutes(deps))
    .route('/', branchRoutes(deps))
    .route('/', turnRoutes(queued))
    .route('/', historyRoutes(deps))
    .route('/', queueRoutes(queued))
    .route('/', conversationRoutes(turns))
    .route('/', answerRoutes(turns))
    .route('/', streamRoutes(deps, { bus: live.bus }))
    .route('/', chatTerminalRoutes({ ...turns, tickets: deps.tickets }));
}
