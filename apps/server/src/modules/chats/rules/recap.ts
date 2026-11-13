import type { ChatTurn } from '@mwc/db';

/**
 * A lost conversation's recap (docs/harness.md "A lost conversation"): when the harness no longer has the conversation a
 * chat resumes (`session_missing`), the turn starts a fresh one whose first prompt carries the conversation so far, from
 * the chat's own stored turns: the last `RECAP_EXCHANGES` finished message turns, oldest first, each the person's prompt
 * and the agent's final reply only (no tool calls, no thinking), each part cut to `RECAP_PART_MAX` and the oldest
 * dropped until the whole fits `RECAP_BUDGET`; then the person's new message. Pure.
 */

/** How many exchanges a recap holds at most. */
export const RECAP_EXCHANGES = 20;

/** The most characters of the exchanges together. */
export const RECAP_BUDGET = 16_000;

/** The most characters of one prompt or one reply in a recap. */
export const RECAP_PART_MAX = 3_000;

/** What ends a part that was cut. */
export const RECAP_CUT = ' […]';

/** A turn as a recap reads it. */
export type RecapTurn = Pick<ChatTurn, 'kind' | 'status' | 'prompt' | 'resultText'>;

/** The statuses of a turn that ran to its end, whose prompt the lost conversation saw. */
const FINISHED = new Set<RecapTurn['status']>(['done', 'failed', 'stopped']);

/** `text` trimmed, at most `RECAP_PART_MAX` characters, ending in `RECAP_CUT` when cut. */
export function recapPart(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= RECAP_PART_MAX) return trimmed;
  return `${trimmed.slice(0, RECAP_PART_MAX - RECAP_CUT.length).trimEnd()}${RECAP_CUT}`;
}

/** One exchange as the recap writes it. */
const exchangeOf = (turn: RecapTurn): string => {
  const reply = turn.resultText?.trim() ? recapPart(turn.resultText) : '(no reply)';
  return `Person: ${recapPart(turn.prompt)}\nYou: ${reply}`;
};

/**
 * The recap's exchanges from the turns before the new one (in order, oldest first): finished message turns only, the
 * latest `RECAP_EXCHANGES`, the oldest dropped until they fit `RECAP_BUDGET`; empty when there is none.
 */
export function recapExchanges(turns: readonly RecapTurn[]): string[] {
  const exchanges = turns
    .filter((turn) => turn.kind === 'message' && FINISHED.has(turn.status))
    .slice(-RECAP_EXCHANGES)
    .map(exchangeOf);
  let size = exchanges.reduce((sum, text) => sum + text.length + 2, 0);
  while (exchanges.length > 0 && size > RECAP_BUDGET) size -= (exchanges.shift() as string).length + 2;
  return exchanges;
}

/** The first prompt of the fresh conversation: the recap, when there is one, then the person's new message. */
export function recapPrompt(exchanges: readonly string[], prompt: string): string {
  if (exchanges.length === 0) return prompt;
  return [
    "This chat's saved conversation was lost on its machine, so this is a fresh conversation. Here is a recap of its " +
      'last messages, oldest first: the prompts and your final replies only.',
    '<recap>',
    exchanges.join('\n\n'),
    '</recap>',
    "Carry on from there. The person's new message:",
    '',
    prompt,
  ].join('\n');
}

/** The thread's notice that the chat started afresh (`machine` its machine's name). */
export function sessionLostNotice(machine: string, recapped: boolean): string {
  const fresh = `The saved conversation on ${machine} was gone, so this chat started a fresh one`;
  return recapped ? `${fresh} with a recap of the last messages.` : `${fresh}.`;
}
