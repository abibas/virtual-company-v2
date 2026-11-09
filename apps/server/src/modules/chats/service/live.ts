import type { ChatTurn, TenantDb } from '@mwc/db';
import type { CredentialKind } from '@mwc/shared/enums';
import type { TurnEvent } from '@mwc/shared/harness';
import type { TurnEventItem } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import type { CredentialsForHarness } from '../../credentials/index.ts';
import type { TurnChannel, TurnEnding, TurnSink } from '../../machines/index.ts';
import { turnsRepo } from '../repo/turns.ts';
import { chatsRepo } from '../repo.ts';
import { endedTurn, type TurnOutcome, withEvent } from '../rules.ts';
import { type ChatBus, chatBus } from './bus.ts';
import { streamEvent, turnView } from './views.ts';

/**
 * The chats' live turns in this server process (S5.1b): each started turn's sink, which stores the runner's events in
 * order (a `session` event saves the chat's session id; a question the agent asked is its `question` event, S5.2),
 * tells the chat's stream listeners, and on the turn's end closes its row (done, failed or stopped, with the reply and
 * the usage) and seals again a Codex login the process rewrote; and each live turn's channel, which a stop goes through. Every write runs on one queue per turn, so the end is written
 * after the last event. A failure is logged by the turn's id, never thrown into the hub.
 */

/** The subscription a turn runs on: which credential, whose, of which kind (a Codex login is sealed again). */
export interface TurnCredential {
  readonly credentialId: string;
  readonly ownerUserId: string;
  readonly kind: CredentialKind;
}

export interface LiveDeps {
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly credentials: CredentialsForHarness;
}

interface LiveTurn {
  channel: TurnChannel | undefined;
  stopRequested: boolean;
}

/** What the steps of a turn's sink share: the deps, the stream's bus and the live turns. */
interface Live {
  readonly deps: LiveDeps;
  readonly bus: ChatBus;
  readonly turns: Map<string, LiveTurn>;
}

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
    if (event.type === 'session') await chatsRepo.update(t, turn.chatId, { sessionId: event.sessionId });
    l.bus.publish(turn.chatId, { kind: 'event', event: streamEvent(turn, row) });
  }
  return next;
}

/** Closes the turn's row from its end, and seals again a Codex login the process rewrote. */
async function ended(
  l: Live,
  t: TenantDb,
  turn: ChatTurn,
  end: { readonly ending: TurnEnding; readonly outcome: TurnOutcome; readonly used: TurnCredential },
): Promise<void> {
  const { ending, outcome, used } = end;
  if (ending.authJson !== undefined && used.kind === 'codex_oauth') {
    await l.deps.credentials.rewriteCodexLogin(
      used.credentialId,
      used.ownerUserId,
      ending.authJson,
      'chat_turn',
    );
  }
  const stopRequested = l.turns.get(turn.id)?.stopRequested ?? false;
  l.turns.delete(turn.id);
  const how = ending.error === undefined ? { ok: ending.ok } : { ok: ending.ok, error: ending.error };
  const row = await turnsRepo.updateLive(t, turn.id, {
    ...endedTurn(how, outcome, stopRequested),
    endedAt: l.deps.clock(),
  });
  if (row === undefined) return;
  await chatsRepo.update(t, turn.chatId, { updatedAt: l.deps.clock() });
  l.bus.publish(turn.chatId, { kind: 'turn', turn: turnView(row) });
}

export function chatsLive(deps: LiveDeps) {
  const bus = chatBus();
  const live = new Map<string, LiveTurn>();
  const l: Live = { deps, bus, turns: live };
  return {
    bus,
    /** The sink of a turn about to start: its events and its end go to the database and the stream, in order. */
    sink(t: TenantDb, turn: ChatTurn, used: TurnCredential): TurnSink {
      const run = queue(deps.logger, turn.id);
      let outcome: TurnOutcome = {};
      live.set(turn.id, { channel: undefined, stopRequested: false });
      return {
        events: (items) =>
          void run(async () => {
            outcome = await stored(l, t, turn, items, outcome);
          }),
        question: ({ seq, questionId, questions }) =>
          void run(async () => {
            const event = { type: 'question', id: questionId, questions } as const;
            outcome = await stored(l, t, turn, [{ seq, event }], outcome);
          }),
        end: (ending) => void run(() => ended(l, t, turn, { ending, outcome, used })),
      };
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
