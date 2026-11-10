import { isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import { commandLine } from '../children.ts';
import { commandResult } from '../items.ts';
import { callOf, payloadOf, pick, TURN_STARTED, turnStartOf } from './lines.ts';
import { idOf } from './parent.ts';

/**
 * What a subagent's own session file says while it works (docs/harness.md, "Codex subagents"). Its `session_meta`
 * names its `history_mode`; each `task_started` opens a turn, its own or one copied from the root thread (`lines.ts`). A command starts as a `response_item` `function_call` (`exec_command` with `cmd`, `shell`
 * or `container.exec` with an argv `command`, `shell_command` with a `command` line) or `local_shell_call` (`action.
 * command`), and ends as an `event_msg` `item_completed` of a `CommandExecution` (`id` the call's, argv `command`,
 * `status`, `exit_code`, `aggregated_output`; a paginated thread, also for a command code mode ran) or `exec_command_end`
 * (older Codex); a legacy-history thread has only the call's `function_call_output`. Its messages are `item_completed`
 * `AgentMessage` items (`content: [{ type: "Text", text }]`) or, legacy, `agent_message` events; each turn ends with
 * `task_complete` (`last_agent_message`, `error.message` when it failed).
 */

export type ChildLine =
  | { readonly kind: 'meta'; readonly paginated: boolean }
  | { readonly kind: 'turn'; readonly startedAt: number | null; readonly root: boolean }
  | { readonly kind: 'call'; readonly callId: string; readonly command: string }
  | {
      readonly kind: 'done';
      readonly callId: string;
      readonly command: string | undefined;
      readonly ok: boolean;
      readonly summary: string;
    }
  | { readonly kind: 'output'; readonly callId: string; readonly output: string }
  | { readonly kind: 'message'; readonly text: string }
  | { readonly kind: 'end'; readonly answer: string | undefined; readonly error: string | undefined };

const MARKERS = [
  '"session_meta"',
  TURN_STARTED,
  '"function_call"',
  '"function_call_output"',
  '"local_shell_call"',
  '"CommandExecution"',
  '"exec_command_end"',
  '"AgentMessage"',
  '"agent_message"',
  '"task_complete"',
] as const;

/** The calls that run a command, by name without their namespace. */
const SHELL_CALLS: ReadonlySet<string> = new Set(['exec_command', 'shell', 'shell_command', 'exec']);

/** A response item that starts a command: its call id and its command line. */
function callStart(payload: JsonRecord): ChildLine | undefined {
  const callId = idOf(payload.call_id);
  if (callId === undefined) return undefined;
  if (payload.type === 'local_shell_call') {
    const command = commandLine(isRecord(payload.action) ? payload.action.command : undefined);
    return command === undefined ? undefined : { kind: 'call', callId, command };
  }
  const { name, args } = callOf(payload);
  if (payload.type !== 'function_call' || !SHELL_CALLS.has(name)) return undefined;
  const command = stringOf(args.cmd)?.trim() || commandLine(args.command);
  return command ? { kind: 'call', callId, command } : undefined;
}

/** A call's output as text: a plain string, or its content items' texts. */
function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  const items = Array.isArray(output) ? output : [];
  return items.map((item) => (isRecord(item) ? (stringOf(item.text) ?? '') : '')).join('\n');
}

function responseLine(payload: JsonRecord): ChildLine | undefined {
  if (payload.type !== 'function_call_output') return callStart(payload);
  const callId = idOf(payload.call_id);
  return callId === undefined ? undefined : { kind: 'output', callId, output: outputText(payload.output) };
}

/** A command that ended (`CommandExecution` or `exec_command_end`), with its result as the exec stream words it. */
function commandEnd(fields: JsonRecord, id: unknown): ChildLine | undefined {
  const callId = idOf(id);
  if (callId === undefined || fields.status === 'in_progress') return undefined;
  // Older Codex's `exec_command_end` may name no status: it ended, by its exit code.
  const { ok, summary } = commandResult(
    fields.status === undefined ? { ...fields, status: 'completed' } : fields,
    callId,
  );
  return { kind: 'done', callId, command: commandLine(fields.command), ok, summary };
}

/** An `AgentMessage` item's text. */
function messageText(item: JsonRecord): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.map((part) => (isRecord(part) ? (stringOf(part.text) ?? '') : '')).join('\n\n');
}

const textLine = (text: string | undefined): ChildLine | undefined =>
  text?.trim() ? { kind: 'message', text } : undefined;

function eventLine(payload: JsonRecord): ChildLine | undefined {
  const item = payloadOf({ payload: payload.item });
  switch (payload.type) {
    case 'item_completed':
      if (item.type === 'CommandExecution') return commandEnd(item, item.id);
      return item.type === 'AgentMessage' ? textLine(messageText(item)) : undefined;
    case 'exec_command_end':
      return commandEnd(payload, payload.call_id);
    case 'agent_message':
      return textLine(stringOf(payload.message));
    case 'task_complete': {
      const error = isRecord(payload.error) ? stringOf(payload.error.message)?.trim() : undefined;
      const answer = stringOf(payload.last_agent_message)?.trim();
      return { kind: 'end', answer: answer || undefined, error: error || undefined };
    }
    default:
      return undefined;
  }
}

/** What a line of a subagent's own file says; undefined for any other line. */
export function childLine(text: string): ChildLine | undefined {
  const line = pick(text, MARKERS);
  if (line === null) return undefined;
  const turn = turnStartOf(line);
  if (turn !== undefined) return { kind: 'turn', ...turn };
  const payload = payloadOf(line);
  if (line.type === 'session_meta') return { kind: 'meta', paginated: payload.history_mode === 'paginated' };
  if (line.type === 'response_item') return responseLine(payload);
  return line.type === 'event_msg' ? eventLine(payload) : undefined;
}
