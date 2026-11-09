import { CHAT_QUEUE_MAX, type QueuedPlace, queueOrder } from '@mwc/shared/chats';
import type { ChatTurnKind, Harness } from '@mwc/shared/enums';
import { type Refusal, refuse } from '../rules.ts';

/**
 * A chat's queue (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): its refusals, which waiting turn starts
 * next, and the number a waiting turn takes when it starts, so the turns that started are numbered in the order they
 * started (the stream's `Last-Event-ID` reads them in that order). Pure.
 */

export const QUEUE_FULL = refuse(
  409,
  'queue_full',
  `${CHAT_QUEUE_MAX} messages already wait for the running turn: wait for them, or discard one`,
);
export const TURN_NOT_QUEUED = refuse(
  409,
  'turn_not_queued',
  'This message is no longer waiting: it has started or ended',
);
export const MESSAGE_SENT = refuse(
  409,
  'message_sent',
  'This message went into the running turn: it can no longer be changed',
);
export const NOW_CODEX = refuse(
  409,
  'now_unsupported',
  "Codex can't take a message while it works: send it after this turn, or interrupt",
);
export const NOW_COMPACT = refuse(
  409,
  'now_unsupported',
  'The running turn compacts the conversation: send it after this turn',
);

/** Why the running turn cannot take a message now: Codex takes none mid-turn, and a compaction takes none. */
export function nowRefusal(
  chat: { readonly harness: Harness },
  running: { readonly kind: ChatTurnKind },
): Refusal | undefined {
  if (chat.harness === 'codex') return NOW_CODEX;
  return running.kind === 'compact' ? NOW_COMPACT : undefined;
}

/** The waiting turn that starts next (`queueOrder`), if any waits. */
export function nextQueued<T extends QueuedPlace>(queued: readonly T[]): T | undefined {
  return [...queued].sort(queueOrder)[0];
}

/**
 * The number a waiting turn takes when it starts: its own while it is after every turn that started, else the next
 * one after the chat's last (a message that jumped the queue started before it).
 */
export function startSeq(seq: number, lastStarted: number, last: number): number {
  return seq > lastStarted ? seq : last + 1;
}
