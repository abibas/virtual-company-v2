import {
  clipHead,
  clipLine,
  clipMarked,
  clipTail,
  isRecord,
  type JsonRecord,
  stringOf,
} from '@mwc/harness-core';
import {
  NOTICE_MAX,
  THINKING_MAX,
  TODO_ITEMS_MAX,
  TODO_TEXT_MAX,
  TOOL_RESULT_SUMMARY_MAX,
  TOOL_SUMMARY_MAX,
  type TurnEvent,
  type TurnEventOf,
} from '@mwc/shared/harness';

/**
 * Codex's thread items (`item.started` / `item.updated` / `item.completed` of `codex exec --json`) as turn events: an
 * agent message is text, reasoning is thinking; a command, a file change, an MCP tool call and a web search are tools,
 * shown when they start (or, for those that only complete, then) with their result on completion; the to-do list is a
 * `todo` event each time it changes (Codex's items are only done or not: `completed` or `pending`).
 */

/** What the parser keeps across items: the tools already shown, the last agent message (the reply), the last list. */
export interface ItemState {
  readonly tools: Set<string>;
  lastMessage: string | undefined;
  lastTodos: string | undefined;
}

export function newItemState(): ItemState {
  return { tools: new Set(), lastMessage: undefined, lastTodos: undefined };
}

/** A `todo_list` item's list, when it changed since the last one given. */
export function todoEvents(item: JsonRecord, state: ItemState): TurnEvent[] {
  if (item.type !== 'todo_list' || !Array.isArray(item.items)) return [];
  const items = item.items
    .filter(isRecord)
    .map((todo) => ({
      text: clipLine(stringOf(todo.text) ?? '', TODO_TEXT_MAX),
      status: todo.completed === true ? ('completed' as const) : ('pending' as const),
    }))
    .filter((todo) => todo.text !== '')
    .slice(0, TODO_ITEMS_MAX);
  const key = JSON.stringify(items);
  if (key === state.lastTodos) return [];
  state.lastTodos = key;
  return [{ type: 'todo', items }];
}

const tool = (id: string, name: string, summary: string): TurnEventOf<'tool'> => ({
  type: 'tool',
  id: id.slice(0, 200),
  name: clipLine(name, 200) || 'tool',
  summary: clipLine(summary, TOOL_SUMMARY_MAX),
});

/** `update src/main.ts, add src/new.ts`. */
function changesSummary(changes: unknown): string {
  if (!Array.isArray(changes)) return '';
  return changes
    .filter(isRecord)
    .map((change) => `${stringOf(change.kind) ?? 'change'} ${stringOf(change.path) ?? ''}`.trim())
    .join(', ');
}

/** An MCP call's arguments: the first text among them, else their JSON. */
function argumentsSummary(args: unknown): string {
  if (!isRecord(args)) return '';
  const first = Object.values(args).find((value) => typeof value === 'string' && value.trim() !== '');
  return typeof first === 'string' ? first : JSON.stringify(args) === '{}' ? '' : JSON.stringify(args);
}

function toolOf(item: JsonRecord): TurnEventOf<'tool'> | null {
  const id = stringOf(item.id);
  if (id === undefined || id === '') return null;
  switch (item.type) {
    case 'command_execution':
      return tool(id, 'command', stringOf(item.command) ?? '');
    case 'file_change':
      return tool(id, 'file_change', changesSummary(item.changes));
    case 'mcp_tool_call':
      return tool(
        id,
        `mcp:${stringOf(item.server) ?? '?'}/${stringOf(item.tool) ?? '?'}`,
        argumentsSummary(item.arguments),
      );
    case 'web_search':
      return tool(id, 'web_search', stringOf(item.query) ?? '');
    default:
      return null;
  }
}

/** `exit 1: <the end of the output>`, `declined`, or the status. */
function commandResult(item: JsonRecord, id: string): TurnEventOf<'tool_result'> {
  const exit = typeof item.exit_code === 'number' ? item.exit_code : null;
  const head = item.status === 'declined' ? 'declined' : exit === null ? String(item.status) : `exit ${exit}`;
  const output = stringOf(item.aggregated_output)?.trim() ?? '';
  const summary =
    output === '' ? head : `${head}: ${clipTail(output, TOOL_RESULT_SUMMARY_MAX - head.length - 2)}`;
  return { type: 'tool_result', id, ok: item.status === 'completed' && (exit ?? 0) === 0, summary };
}

/** An MCP result's text blocks, one per line. */
function mcpText(result: unknown): string {
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  return content
    .map((block) => (isRecord(block) && block.type === 'text' ? (stringOf(block.text) ?? '') : ''))
    .filter((text) => text !== '')
    .join('\n');
}

function resultOf(item: JsonRecord, id: string): TurnEventOf<'tool_result'> | null {
  if (item.status !== 'completed' && item.status !== 'failed' && item.status !== 'declined') return null;
  const ok = item.status === 'completed';
  switch (item.type) {
    case 'command_execution':
      return commandResult(item, id);
    case 'file_change':
      return { type: 'tool_result', id, ok, summary: ok ? 'applied' : 'failed' };
    case 'mcp_tool_call': {
      const error = isRecord(item.error) ? stringOf(item.error.message) : undefined;
      const text = error ?? (mcpText(item.result) || String(item.status));
      return {
        type: 'tool_result',
        id,
        ok: ok && error === undefined,
        summary: clipHead(text, TOOL_RESULT_SUMMARY_MAX),
      };
    }
    default:
      return null;
  }
}

/** `item.started`: a tool as soon as it starts, the to-do list when it is made. */
export function startedEvents(item: JsonRecord, state: ItemState): TurnEvent[] {
  if (item.type === 'todo_list') return todoEvents(item, state);
  const started = toolOf(item);
  if (started === null || state.tools.has(started.id)) return [];
  state.tools.add(started.id);
  return [started];
}

/**
 * `item.completed`: the agent's text, its reasoning, the final to-do list, a non-fatal error as a notice, a tool's
 * result (with the tool if not shown).
 */
export function completedEvents(item: JsonRecord, state: ItemState): TurnEvent[] {
  if (item.type === 'todo_list') return todoEvents(item, state);
  if (item.type === 'reasoning') {
    const text = stringOf(item.text);
    return text?.trim() ? [{ type: 'thinking', text: clipMarked(text, THINKING_MAX) }] : [];
  }
  if (item.type === 'agent_message') {
    const text = stringOf(item.text);
    if (text === undefined || text.trim() === '') return [];
    state.lastMessage = text;
    return [{ type: 'text', text }];
  }
  if (item.type === 'error') {
    const message = stringOf(item.message)?.trim();
    return message ? [{ type: 'notice', level: 'warn', message: clipHead(message, NOTICE_MAX) }] : [];
  }
  const done = toolOf(item);
  if (done === null) return [];
  const events: TurnEvent[] = startedEvents(item, state);
  const result = resultOf(item, done.id);
  if (result) events.push(result);
  if (item.type === 'command_execution' && item.status === 'declined') {
    const message = clipHead(`Refused for permission: ${done.summary}`, NOTICE_MAX);
    events.push({ type: 'notice', level: 'warn', message });
  }
  return events;
}
