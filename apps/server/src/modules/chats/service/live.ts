import type { ChatTurn, TenantDb } from '@mwc/db';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnEventItem } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { TurnChannel, TurnSink } from '../../machines/index.ts';
import { queueRepo } from '../repo/queue.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { type TurnOutcome, withEvent } from '../rules.ts';
import { noticeQuestion } from './ask-notice.ts';
import { type ChatBus, chatBus } from './bus.ts';
import {
  ended,
  type Live,
  type LiveDeps,
  type LiveTurn,
  type StartAfresh,
  type TurnCredential,
} from './live-end.ts';
import { NO_TOOLS_HERE, toolCall } from './live-tools.ts';
import type { TaskTurnContext } from './task-hook.ts';
import { streamEvent, turnView } from './views.ts';

/**
 * The chats' live turns in this server process (S5.1b): each started turn's sink, which stores the runner's events in
 * order (a `session` event saves the chat's session id, and a branch's forked one ends its `fork_pending`; a question the agent asked is its `question` event, S5.2, told to the admins, S6c),
 * tells the chat's stream listeners, and on the turn's end closes its row (done, failed or stopped, with the reply and
 * the usage) and seals again a Codex login the process rewrote; and each live turn's channel, which a stop and the
 * person's message mid-turn go through (S5.2 step 6: the harness's `input` event for it removes the message's waiting
 * turn). Every write runs on one queue per turn, so the end is written after the last event, and what follows a turn's
 * end (the chat's next waiting turn starts, `onEnded`) after it. A failure is logged by the turn's id, never thrown into
 * the hub. A task's turn (S5.3b) hands the files the runner collected, what it left out and its end to the tasks
 * module's hook, on the same queue, before the next waiting turn starts. A turn whose runner went away (S5.4) is
 * `detached` until its runner comes back with it (the stream shows it reconnecting) and says the last event it stored
 * (`lastSeq`); after a server restart, `adopt` builds the sink of a turn left running from its stored events. An agent's
 * tool call (S6a) goes to the tasks module's hook on the same queue, so a decision is written before the turn's end. A
 * turn the runner refuses for a full machine (`busy`) waits for a free slot instead of ending (`live-slot.ts`). A turn
 * Most Wanted queued tells the tasks module's hook its end too (`systemEnded`: the team room posts its reply). How an end
 * closes the turn, or starts it again on a fresh conversation when the harness lost its own (S7, 2026-11-13), is
 * `live-end.ts`'s.
 */

export type { LiveDeps, TurnCredential } from './live-end.ts';

/** A running turn's runner is away: since when, when this process saw it go. */
export interface TurnAway {
  readonly since: Date | undefined;
}

/** What a turn's sink knows besides its row: its task step (S5.3b) and the chat's agent, whose tools it answers (S6a). */
export interface SinkContext {
  readonly task?: TaskTurnContext | undefined;
  readonly agentPrincipalId?: string | undefined;
}

export { NO_TOOLS_HERE };

/** One turn's writes, in order; a failure is logged and the next write still runs. */
function queue(logger: Logger, turnId: string) {
  let chain = Promise.resolve();
  return (work: () => Promise<void>) => {
    chain = chain.then(work).catch((error: unknown) => {
      logger.error({ err: error, turnId }, 'chats: could not record what a turn said');
    });
    return chain;
  };
}

/** Stores and tells a batch of events; returns what they add to the turn's outcome. */
async function stored(
  l: Live,
  t: TenantDb,
  turn: ChatTurn,
  items: readonly TurnEventItem[],
  outcome: TurnOutcome,
): Promise<TurnOutcome> {
  const at = l.deps.clock();
  const rows = await turnsRepo.insertEvents(
    t,
    turn.id,
    items.map((item) => ({ seq: item.seq, event: item.event as Record<string, unknown>, at })),
  );
  let next = outcome;
  for (const row of rows.sort((a, b) => a.seq - b.seq)) {
    const event = row.event as TurnEvent;
    next = withEvent(next, event);
    if (event.type === 'session') await chatsRepo.saveSession(t, turn.chatId, event.sessionId);
    l.bus.publish(turn.chatId, { kind: 'event', event: streamEvent(turn, row) });
    if (event.type === 'input' && event.inputId !== undefined) await taken(l, t, turn.chatId, event.inputId);
  }
  return next;
}

/** The harness took a message sent into the running turn: its waiting turn goes. */
async function taken(l: Live, t: TenantDb, chatId: string, inputId: string): Promise<void> {
  const gone = await queueRepo.deleteQueued(t, chatId, inputId);
  if (gone !== undefined) l.bus.publish(chatId, { kind: 'removed', turnId: gone.id });
}

export function chatsLive(deps: LiveDeps) {
  const bus = chatBus();
  const live = new Map<string, LiveTurn>();
  const l: Live = { deps, bus, turns: live };
  return {
    bus,
    /**
     * The sink of a turn about to start (or, `adopted`, of one a restarted server takes back): its events and its end go
     * to the database and the stream, in order; a task's turn's collected files and what was left out go to the tasks
     * module's hook.
     */
    sink(
      t: TenantDb,
      turn: ChatTurn,
      used: TurnCredential,
      context: SinkContext = {},
      adopted = false,
    ): TurnSink {
      const { task } = context;
      const run = queue(deps.logger, turn.id);
      let outcome: TurnOutcome = {};
      const entry: LiveTurn = { channel: undefined, stopRequested: false, detachedAt: undefined };
      live.set(turn.id, entry);
      const hook = task === undefined ? undefined : deps.tasks;
      if (adopted) {
        // A turn taken back after a restart: what its stored events said so far.
        void run(async () => {
          const rows = await turnsRepo.eventsOf(t, [turn.id]);
          outcome = rows.reduce((sum, row) => withEvent(sum, row.event as TurnEvent), outcome);
        });
      }
      return {
        events: (items) =>
          void run(async () => {
            outcome = await stored(l, t, turn, items, outcome);
          }),
        question: ({ seq, questionId, questions }) =>
          void run(async () => {
            const event = { type: 'question', id: questionId, questions } as const;
            const fresh = (await turnsRepo.lastEventSeq(t, turn.id)) < seq;
            outcome = await stored(l, t, turn, [{ seq, event }], outcome);
            if (fresh) await noticeQuestion(t, turn.chatId, questions);
          }),
        artifact: (file) => void run(async () => hook?.collected(t, task as TaskTurnContext, file)),
        artifacts: (collected) => void run(async () => hook?.skipped(t, task as TaskTurnContext, collected)),
        tool: (call) => toolCall(deps, run, t, { turn, context }, call),
        end: async (ending) => {
          let after: (() => void) | undefined;
          await run(async () => {
            after = await ended(l, t, turn, { ending, outcome, used, task });
          });
          return after;
        },
        lastSeq: async () => {
          let seq = 0;
          await run(async () => {
            seq = await turnsRepo.lastEventSeq(t, turn.id);
          });
          return seq;
        },
        detached: (away) => {
          entry.detachedAt = away ? deps.clock() : undefined;
          const since = entry.detachedAt === undefined ? {} : { detachedAt: entry.detachedAt.toISOString() };
          void run(async () => {
            const row = await turnsRepo.get(t, turn.chatId, turn.id);
            if (row?.status === 'running')
              bus.publish(turn.chatId, {
                kind: 'turn',
                turn: { ...turnView(row), detached: away, ...since },
              });
          });
        },
        adopted: (channel) => {
          entry.channel = channel;
        },
      };
    },
    /**
     * A running turn waiting for its runner: since when it went away, or an unknown time when this process has not
     * taken the turn back yet; undefined while attached.
     */
    awayOf(turnId: string): TurnAway | undefined {
      const entry = live.get(turnId);
      if (entry === undefined) return { since: undefined };
      return entry.detachedAt === undefined ? undefined : { since: entry.detachedAt };
    },
    /** Whether this process holds the turn (it started it, or took it back after a restart). */
    holds(turnId: string): boolean {
      return live.has(turnId);
    },
    /** The started turn's channel, for a stop. */
    started(turnId: string, channel: TurnChannel): void {
      // Right after `sink`, before any frame of the turn can come back: its entry is there.
      (live.get(turnId) as LiveTurn).channel = channel;
    },
    /** Forgets a turn that never started (its runner went away before `turn.start`). */
    forget(turnId: string): void {
      live.delete(turnId);
    },
    /** Gives the running turn the person's message (`turn.input`); false when this process has no such live turn. */
    input(turnId: string, inputId: string, text: string): boolean {
      const channel = live.get(turnId)?.channel;
      channel?.input(inputId, text);
      return channel !== undefined;
    },
    /** What runs once each turn's end is written: the chats' queue starts the next waiting turn. */
    onEnded(then: (t: TenantDb, chatId: string) => Promise<void>): void {
      l.ended = then;
    },
    /** What runs once a turn the runner refused for a full machine waits for a slot. */
    onBusy(then: (t: TenantDb, turn: ChatTurn) => Promise<void>): void {
      l.busy = then;
    },
    /** What starts a turn whose conversation the harness lost again on a fresh one (`session-lost.ts`). */
    onSessionLost(then: StartAfresh): void {
      l.afresh = then;
    },
    /** Asks the turn's runner to stop it; false when this process has no such live turn. */
    stop(turnId: string): boolean {
      const entry = live.get(turnId);
      if (entry?.channel === undefined) return false;
      entry.stopRequested = true;
      entry.channel.stop();
      return true;
    },
  };
}

export type ChatsLive = ReturnType<typeof chatsLive>;
export type { ChatBus };
