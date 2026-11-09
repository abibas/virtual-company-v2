import {
  clipHead,
  clipLine,
  clipMarked,
  countOf,
  isRecord,
  type JsonRecord,
  stringOf,
} from '@mwc/harness-core';
import {
  RESULT_ERROR_MAX,
  THINKING_MAX,
  TODO_ITEMS_MAX,
  TODO_TEXT_MAX,
  TodoStatus,
  type TurnEvent,
  type TurnEventOf,
} from '@mwc/shared/harness';
import { contextEvents, resultContext } from './context.ts';
import { bodyOf, type ClaudeState, newClaudeState, parentOf } from './state.ts';
import { interruptedSubagents, subagentAnswered, subagentStarted } from './subagents.ts';
import { denialNotice, resultSummary, toolSummary } from './summary.ts';

/**
 * Claude Code's `assistant`, `user` and `result` messages as turn events (`system` ones are `system.ts`'s). A subagent's
 * own messages (with a `parent_tool_use_id`) give the same events with that id as their `parentId`; its call is the
 * Agent tool, its state the `subagent` events (`subagents.ts`).
 */

type Belongs = { parentId?: string };

/** The content blocks of an assistant or user message. */
function blocksOf(message: JsonRecord): readonly unknown[] {
  const content = bodyOf(message).content;
  return Array.isArray(content) ? content : [];
}

/** A `TodoWrite` call's list: each item's text and status (an unknown status is pending). */
export function todoEvent(input: unknown, belongs: Belongs): TurnEventOf<'todo'>[] {
  const todos = isRecord(input) && Array.isArray(input.todos) ? input.todos : undefined;
  if (todos === undefined) return [];
  const items = todos
    .filter(isRecord)
    .map((todo) => ({
      text: clipLine(stringOf(todo.content) ?? '', TODO_TEXT_MAX),
      status: TodoStatus.safeParse(todo.status).data ?? 'pending',
    }))
    .filter((todo) => todo.text !== '')
    .slice(0, TODO_ITEMS_MAX);
  return [{ type: 'todo', items, ...belongs }];
}

/** A tool call block: the tool, and its to-do list or its subagent when it is one. */
function toolEvents(block: JsonRecord, belongs: Belongs, state: ClaudeState): TurnEvent[] {
  const id = stringOf(block.id);
  if (id === undefined || id === '') return [];
  const name = clipLine(stringOf(block.name) ?? '', 200) || 'tool';
  const call = { id: id.slice(0, 200), name, input: block.input };
  const tool: TurnEvent = { type: 'tool', id: call.id, name, summary: toolSummary(block.input), ...belongs };
  if (name === 'TodoWrite') return [tool, ...todoEvent(block.input, belongs)];
  return [tool, ...subagentStarted(call, belongs, state)];
}

/** `assistant`: its text, thinking and tool calls in order, then how full the context is (the main agent's only). */
export function assistantEvents(message: JsonRecord, state: ClaudeState = newClaudeState()): TurnEvent[] {
  const belongs = parentOf(message);
  const events: TurnEvent[] = [];
  for (const block of blocksOf(message)) {
    if (!isRecord(block)) continue;
    const text = stringOf(block.text);
    if (block.type === 'text' && text !== undefined && text.trim() !== '')
      events.push({ type: 'text', text, ...belongs });
    const thinking = stringOf(block.thinking);
    if (block.type === 'thinking' && thinking !== undefined && thinking.trim() !== '')
      events.push({ type: 'thinking', text: clipMarked(thinking, THINKING_MAX), ...belongs });
    if (block.type === 'tool_use' || block.type === 'server_tool_use')
      events.push(...toolEvents(block, belongs, state));
  }
  events.push(...contextEvents(message, state));
  return events;
}

/** `user`: the results of the tool calls, each ending the subagent its call started. */
export function userEvents(message: JsonRecord, state: ClaudeState = newClaudeState()): TurnEvent[] {
  const belongs = parentOf(message);
  const events: TurnEvent[] = [];
  for (const block of blocksOf(message)) {
    if (!isRecord(block) || block.type !== 'tool_result') continue;
    const id = stringOf(block.tool_use_id)?.slice(0, 200);
    if (id === undefined || id === '') continue;
    const ok = block.is_error !== true;
    events.push({ type: 'tool_result', id, ok, summary: resultSummary(block.content), ...belongs });
    events.push(...subagentAnswered(id, block.content, !ok, state));
  }
  return events;
}

/** The tokens of a `result`: every input token (cache writes and reads included), the output, the cost. */
function usageEvent(message: JsonRecord): TurnEventOf<'usage'> | null {
  const usage = isRecord(message.usage) ? message.usage : undefined;
  const cost = message.total_cost_usd;
  const costUsd = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
  if (usage === undefined && costUsd === undefined) return null;
  const cached = countOf(usage?.cache_read_input_tokens) ?? 0;
  const written = countOf(usage?.cache_creation_input_tokens) ?? 0;
  return {
    type: 'usage',
    inputTokens: (countOf(usage?.input_tokens) ?? 0) + written + cached,
    outputTokens: countOf(usage?.output_tokens) ?? 0,
    cachedInputTokens: cached,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

/** What a failed `result` says, when its `result` text says nothing. */
const SUBTYPE_ERRORS: Readonly<Record<string, string>> = {
  error_max_turns: 'The turn reached its limit of turns.',
  error_max_budget_usd: 'The turn reached its budget.',
  error_during_execution: 'Claude Code failed during the turn.',
};

function errorOf(message: JsonRecord, subtype: string | undefined): string {
  const said = stringOf(message.result)?.trim();
  if (said) return said;
  const errors = Array.isArray(message.errors) ? message.errors.filter((e) => typeof e === 'string') : [];
  if (errors.length > 0) return errors.join('; ');
  if (subtype === undefined || subtype === 'success') return 'Claude Code reported an error.';
  return SUBTYPE_ERRORS[subtype] ?? `Claude Code ended the turn with ${subtype}.`;
}

/**
 * `result`: a notice per refused tool, the subagents still running as interrupted, the context with the window Claude
 * Code reported, the usage, then the turn's end.
 */
export function resultEvents(message: JsonRecord, state: ClaudeState = newClaudeState()): TurnEvent[] {
  const events: TurnEvent[] = [];
  const denials = Array.isArray(message.permission_denials) ? message.permission_denials : [];
  for (const denial of denials) {
    const notice = denialNotice(denial);
    if (notice) events.push(notice);
  }
  events.push(...interruptedSubagents(state), ...resultContext(message, state));
  const usage = usageEvent(message);
  if (usage) events.push(usage);
  const subtype = stringOf(message.subtype);
  const ok = message.is_error !== true && (subtype === undefined || subtype === 'success');
  const durationMs = countOf(message.duration_ms);
  const reply = stringOf(message.result);
  events.push({
    type: 'result',
    ok,
    ...(ok && reply ? { text: reply } : {}),
    ...(ok ? {} : { error: clipHead(errorOf(message, subtype), RESULT_ERROR_MAX) }),
    ...(durationMs === undefined ? {} : { durationMs }),
  });
  return events;
}
