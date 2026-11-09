import { isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import type { TurnEventOf } from '@mwc/shared/harness';

/**
 * What the parser of one turn keeps between lines: the main agent's model (for the context window), the last `context`
 * event it gave, and the subagents the turn started, by the id of their Agent/Task call (and Claude Code's task ids).
 */

export type SubagentState = Omit<TurnEventOf<'subagent'>, 'type'>;

export interface ClaudeState {
  /** The main agent's model: `system/init`'s, else its first message's. */
  model: string | null;
  /** The last `context` event given, and what told it apart (its message id and tokens). */
  context: TurnEventOf<'context'> | undefined;
  contextKey: string | undefined;
  readonly subagents: Map<string, SubagentState>;
  /** Claude Code's task id of a subagent → its call's id. */
  readonly tasks: Map<string, string>;
}

export function newClaudeState(): ClaudeState {
  return { model: null, context: undefined, contextKey: undefined, subagents: new Map(), tasks: new Map() };
}

/** The subagent a message comes from (Claude Code's `parent_tool_use_id`), as an event's `parentId`. */
export function parentOf(message: JsonRecord): { parentId?: string } {
  const parent = stringOf(message.parent_tool_use_id);
  return parent === undefined || parent === '' ? {} : { parentId: parent.slice(0, 200) };
}

/** The body of an assistant or user message (`message`), or an empty one. */
export const bodyOf = (message: JsonRecord): JsonRecord => (isRecord(message.message) ? message.message : {});
