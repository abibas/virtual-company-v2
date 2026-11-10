import { BRANCH_SUPPORT } from '@mwc/shared/chats';
import type { ChatTurnWithEvents } from '../../../api/types.ts';

/**
 * Whether a reply shows Branch (docs/harness.md "Branching"): only on a finished reply that began or continued a
 * conversation (it has a `session` event); enabled on the latest reply of the thread, and on an earlier one where the
 * harness forks up to a message (Claude Code) and the reply kept its message id with no compaction after it; disabled,
 * saying why, otherwise and while a turn runs. The server decides again (`POST …/branch`).
 */

export type BranchState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled'; readonly why: string };

const FINISHED = new Set(['done', 'failed', 'stopped']);

const has = (turn: ChatTurnWithEvents, type: string) => turn.events.some((item) => item.event.type === type);

/** The last message id the turn's result named, if any. */
function messageIdOf(turn: ChatTurnWithEvents): string | undefined {
  const result = turn.events.findLast((item) => item.event.type === 'result')?.event;
  return result?.type === 'result' ? result.messageId : undefined;
}

/** The Branch action's state for `turn` in the thread `turns` (the current conversation, in order). */
export function branchState(
  harness: keyof typeof BRANCH_SUPPORT,
  turns: readonly ChatTurnWithEvents[],
  turn: ChatTurnWithEvents,
): BranchState {
  const support = BRANCH_SUPPORT[harness];
  if (
    typeof support === 'object' ||
    turn.kind !== 'message' ||
    !FINISHED.has(turn.status) ||
    !has(turn, 'session')
  )
    return { kind: 'hidden' };
  if (turns.some((other) => other.status === 'running' || other.status === 'queued'))
    return { kind: 'disabled', why: 'Branch once the agent has finished' };
  const later = turns.slice(turns.indexOf(turn) + 1).filter((other) => other.kind !== 'clear');
  if (later.length === 0) return { kind: 'enabled' };
  if (support === 'latest') return { kind: 'disabled', why: 'Codex branches from the latest reply only' };
  if (later.some((other) => other.kind === 'compact' || has(other, 'compact')))
    return { kind: 'disabled', why: 'Compacted since: branch from a later reply' };
  if (messageIdOf(turn) === undefined)
    return { kind: 'disabled', why: 'Only the latest reply can branch: this one came before branching' };
  return { kind: 'enabled' };
}
