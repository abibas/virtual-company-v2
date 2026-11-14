/**
 * The turns that talk with the agent (2026-11-14, docs/harness.md "Who is in a chat"): a line of who joined or left
 * (`people`) and a message sent straight into Slack (`slack`) run no process, so they neither close the agent's question
 * nor stand for the chat's last reply.
 */
export const talks = (turn: { readonly kind: string }): boolean =>
  turn.kind !== 'people' && turn.kind !== 'slack';

/** The last turn that talks with the agent, of turns in order. */
export const lastTalk = <T extends { readonly kind: string }>(turns: readonly T[]): T | undefined =>
  turns.findLast(talks);
