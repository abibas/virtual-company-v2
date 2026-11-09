import { clipLine, clipMarked, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import {
  EVENT_MODEL_MAX,
  SUBAGENT_DESCRIPTION_MAX,
  SUBAGENT_STEP_MAX,
  SUBAGENT_SUMMARY_MAX,
  SUBAGENT_TYPE_MAX,
  type SubagentStatus,
  type TurnEventOf,
} from '@mwc/shared/harness';
import type { ClaudeState, SubagentState } from './state.ts';
import { resultText } from './summary.ts';

/**
 * The subagents of a Claude Code turn: an Agent (or, before 2.1, Task) call starts one (`running`); `system`
 * `task_started` ties Claude Code's task id to it, `task_progress` and `task_updated` report its steps, and it ends with
 * its call's `tool_result` (its answer) or, for one in the background (whose call returns at once), `task_notification`
 * (its summary). Each change gives a `subagent` event with its whole state; one still running when the turn ends is
 * `interrupted`.
 */

export const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);

/** What a background subagent's call answers at once: the subagent goes on and reports by `task_notification`. */
const LAUNCHED = 'Async agent launched successfully';

const event = (subagent: SubagentState): TurnEventOf<'subagent'> => ({ type: 'subagent', ...subagent });

/** Changes a subagent; its event when something changed, else none. */
function update(state: ClaudeState, id: string, change: Partial<SubagentState>): TurnEventOf<'subagent'>[] {
  const before = state.subagents.get(id);
  if (before === undefined) return [];
  const after = { ...before, ...change };
  if (JSON.stringify(after) === JSON.stringify(before)) return [];
  state.subagents.set(id, after);
  return [event(after)];
}

/** The call's subagent, when this tool call starts one. */
export function subagentStarted(
  call: { readonly id: string; readonly name: string; readonly input: unknown },
  belongs: { parentId?: string },
  state: ClaudeState,
): TurnEventOf<'subagent'>[] {
  const input = isRecord(call.input) ? call.input : {};
  const named = stringOf(input.subagent_type)?.trim();
  if (!SUBAGENT_TOOLS.has(call.name) && !named) return [];
  const model = stringOf(input.model)?.trim();
  const subagent: SubagentState = {
    id: call.id,
    agentType: clipLine(named || 'general-purpose', SUBAGENT_TYPE_MAX),
    description: clipLine(stringOf(input.description) ?? '', SUBAGENT_DESCRIPTION_MAX),
    ...(model ? { model: model.slice(0, EVENT_MODEL_MAX) } : {}),
    background: input.run_in_background === true,
    status: 'running',
    ...belongs,
  };
  state.subagents.set(call.id, subagent);
  return [event(subagent)];
}

/** A subagent's answer: its result's text without the trailer Claude Code adds (its agent id, its usage). */
function answerOf(text: string): string | undefined {
  const answer = text
    .replace(/<usage>[\s\S]*?<\/usage>/g, '')
    .replace(/\n*agentId: [\s\S]*$/, '')
    .trim();
  return answer === '' ? undefined : clipMarked(answer, SUBAGENT_SUMMARY_MAX);
}

/** Ends a running subagent with this status and answer. */
function end(state: ClaudeState, id: string, status: SubagentStatus, answer: string | undefined) {
  if (state.subagents.get(id)?.status !== 'running') return [];
  return update(state, id, { status, ...(answer === undefined ? {} : { summary: answer }) });
}

/** A tool result: the end of the subagent its call started (or, for one sent to the background, just that). */
export function subagentAnswered(id: string, content: unknown, isError: boolean, state: ClaudeState) {
  const text = resultText(content);
  if (!isError && text.includes(LAUNCHED)) return update(state, id, { background: true });
  return end(state, id, isError ? 'failed' : 'done', answerOf(text));
}

/** Claude Code's word for how a task ended, as a subagent's status. */
function statusOf(status: string | undefined): SubagentStatus | undefined {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'killed' || status === 'stopped' || status === 'cancelled') return 'interrupted';
  return undefined;
}

const stepOf = (text: string | undefined) =>
  text?.trim() ? { lastStep: clipLine(text, SUBAGENT_STEP_MAX) } : {};

/** `system` `task_started`, `task_progress`, `task_updated` and `task_notification` of a subagent the turn started. */
export function taskEvents(message: JsonRecord, state: ClaudeState): TurnEventOf<'subagent'>[] {
  const taskId = stringOf(message.task_id);
  const callId = stringOf(message.tool_use_id);
  const id =
    callId !== undefined && state.subagents.has(callId)
      ? callId
      : taskId === undefined
        ? undefined
        : state.tasks.get(taskId);
  if (id === undefined) return [];
  if (taskId !== undefined) state.tasks.set(taskId, id);
  const patch = isRecord(message.patch) ? message.patch : {};
  const background =
    message.is_backgrounded === true || patch.is_backgrounded === true ? { background: true } : {};
  switch (message.subtype) {
    case 'task_started':
      return update(state, id, background);
    case 'task_progress':
      return update(state, id, { ...background, ...stepOf(stringOf(message.description)) });
    case 'task_updated': {
      const status = statusOf(stringOf(patch.status));
      const ends = status !== undefined && state.subagents.get(id)?.status === 'running' ? { status } : {};
      return update(state, id, { ...background, ...stepOf(stringOf(patch.description)), ...ends });
    }
    case 'task_notification': {
      const status = statusOf(stringOf(message.status));
      const summary = stringOf(message.summary);
      if (status === undefined) return [];
      return end(state, id, status, summary === undefined ? undefined : answerOf(summary));
    }
    default:
      return [];
  }
}

/** The subagents still running when the turn ends, as `interrupted`. */
export function interruptedSubagents(state: ClaudeState): TurnEventOf<'subagent'>[] {
  return [...state.subagents.values()]
    .filter((subagent) => subagent.status === 'running')
    .flatMap((subagent) => end(state, subagent.id, 'interrupted', undefined));
}
