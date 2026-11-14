import type { Chat, TenantDb } from '@mwc/db';
import { newId } from '@mwc/shared/ids';
import { queueRepo } from '../repo/queue.ts';
import { turnsRepo } from '../repo/turns.ts';
import { compactDue } from '../rules/conversation.ts';
import { COMPACT_PROMPT, compactChat, compactRefusal } from './conversation.ts';
import { conversationNow } from './history.ts';
import type { QueueDeps } from './queue.ts';
import { turnView } from './views.ts';

/**
 * A long conversation compacted before the next message from outside (2026-11-14, Ihor: "only when it's time to compact
 * it, we have to compact a conversation… we should not keep sending FULL messages"; docs/harness.md "Slack
 * conversations"). When the chat's conversation since its last Clear is at least `share` of its window full (its last
 * reading, `conversationNow`), its `/compact` goes first, as a turn Most Wanted queues (`system`, by the agent), which the
 * thread shows as "Compacted to keep this conversation short": at once while nothing runs or waits there, else behind
 * the running turn. Nothing is compacted when a turn already waits, when the chat cannot compact (no session yet, Codex)
 * or when the compaction is refused (a stopped machine, which a compaction never starts, or no free slot): the message
 * then goes as before, and the next one tries again.
 */

/** Compacts the chat first when it is due (see above); true when its compaction started or waits for the running turn. */
export async function compactFirst(
  deps: QueueDeps,
  t: TenantDb,
  chat: Chat,
  by: { readonly principalId: string },
  share: number,
): Promise<boolean> {
  if (compactRefusal(chat) !== undefined) return false;
  if (!compactDue((await conversationNow(t, chat)).context, share)) return false;
  if ((await queueRepo.queuedOf(t, chat.id)).length > 0) return false;
  const caller = { principalId: by.principalId, system: true };
  if ((await queueRepo.runningOf(t, chat.id)) === undefined) {
    const started = await compactChat(deps, t, caller, chat.id);
    return started.ok && started.turn.status === 'running';
  }
  const turn = await t.transaction(async (tx) => {
    const seq = (await turnsRepo.lastSeq(tx, chat.id)) + 1;
    return turnsRepo.insert(tx, {
      id: newId(),
      chatId: chat.id,
      seq,
      kind: 'compact',
      prompt: COMPACT_PROMPT,
      status: 'queued',
      delivery: 'after',
      createdBy: caller.principalId,
      system: true,
    });
  });
  deps.live.bus.publish(chat.id, { kind: 'turn', turn: turnView(turn) });
  return true;
}
