import type { ChatConversationView } from '../schemas/history.ts';

/**
 * A long chat's own rules (docs/harness.md "Reading a long chat"): the conversations before each Clear, as the chat's
 * detail describes them for its folded bars. Pure.
 */

/** A Clear of the chat: its turn's id, number and time. */
export interface ClearPoint {
  readonly id: string;
  readonly seq: number;
  readonly createdAt: Date;
}

/** A conversation's size and span, by the index of the Clear that ended it. */
export interface SpanOf {
  readonly index: number;
  readonly turns: number;
  readonly from: Date | null;
  readonly to: Date | null;
}

/** The conversation each Clear ended (`clears` oldest first, `spans` by their index), newest first. */
export function conversationsBefore(
  clears: readonly ClearPoint[],
  spans: readonly SpanOf[],
): ChatConversationView[] {
  const byIndex = new Map(spans.map((span) => [span.index, span]));
  return clears
    .map((clear, index) => {
      const span = byIndex.get(index);
      return {
        clearTurnId: clear.id,
        clearSeq: clear.seq,
        clearedAt: clear.createdAt.toISOString(),
        turns: span?.turns ?? 0,
        from: span?.from?.toISOString() ?? null,
        to: span?.to?.toISOString() ?? null,
      };
    })
    .reverse();
}
