import { clipHead, countOf, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import {
  CompactTrigger,
  EVENT_CWD_MAX,
  EVENT_EFFORT_MAX,
  EVENT_MODEL_MAX,
  NOTICE_MAX,
  SLASH_COMMAND_MAX,
  SLASH_COMMANDS_MAX,
  type TurnEvent,
  type TurnEventOf,
} from '@mwc/shared/harness';
import { forgetContext } from './context.ts';
import { type ClaudeState, newClaudeState } from './state.ts';
import { taskEvents } from './subagents.ts';

/**
 * Claude Code's `system` messages: `init` says what the turn runs on (its session is the parser's own), `api_retry`
 * becomes a notice, `compact_boundary` a compaction, and the `task_*` messages report the subagents (`subagents.ts`).
 * Any other subtype gives nothing.
 */

/** A string field of at most `max` characters; undefined for a blank, missing or longer one. */
function fitting(value: unknown, max: number): string | undefined {
  const text = stringOf(value)?.trim();
  return text && text.length <= max ? text : undefined;
}

/** `init`: the model (kept for the context window), the effort, the folder and the slash commands. */
function initEvent(message: JsonRecord, state: ClaudeState): TurnEventOf<'init'> {
  const model = fitting(message.model, EVENT_MODEL_MAX) ?? null;
  if (model !== null) state.model = model;
  const effort = fitting(message.effort, EVENT_EFFORT_MAX);
  const cwd = fitting(message.cwd, EVENT_CWD_MAX);
  const commands = Array.isArray(message.slash_commands)
    ? message.slash_commands
        .map((command) =>
          fitting(typeof command === 'string' ? command.replace(/^\//, '') : command, SLASH_COMMAND_MAX),
        )
        .filter((command) => command !== undefined)
        .slice(0, SLASH_COMMANDS_MAX)
    : undefined;
  return {
    type: 'init',
    model,
    ...(effort === undefined ? {} : { effort }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(commands === undefined ? {} : { slashCommands: commands }),
  };
}

/** `api_retry`: the request is retried, with how often and why. */
function retryNotice(message: JsonRecord): TurnEventOf<'notice'> {
  const attempt = countOf(message.attempt);
  const max = countOf(message.max_retries);
  const status = countOf(message.error_status);
  const why = stringOf(message.error) ?? (status === undefined ? undefined : `HTTP ${status}`);
  const count = attempt === undefined || max === undefined ? '' : ` (attempt ${attempt} of ${max})`;
  const text = `The request to the model failed and is retried${count}${why === undefined ? '' : `: ${why}`}`;
  return { type: 'notice', level: 'info', message: clipHead(text, NOTICE_MAX) };
}

/** `compact_boundary`: the conversation's size before and after, and who asked. */
function compactEvent(message: JsonRecord, state: ClaudeState): TurnEventOf<'compact'> {
  forgetContext(state);
  const meta = isRecord(message.compact_metadata) ? message.compact_metadata : {};
  const trigger = CompactTrigger.safeParse(meta.trigger);
  return {
    type: 'compact',
    preTokens: countOf(meta.pre_tokens) ?? 0,
    postTokens: countOf(meta.post_tokens) ?? null,
    ...(trigger.success ? { trigger: trigger.data } : {}),
  };
}

/** A `system` message's events (see above). */
export function systemEvents(message: JsonRecord, state: ClaudeState = newClaudeState()): TurnEvent[] {
  switch (message.subtype) {
    case 'init':
      return [initEvent(message, state)];
    case 'api_retry':
      return [retryNotice(message)];
    case 'compact_boundary':
      return [compactEvent(message, state)];
    case 'task_started':
    case 'task_progress':
    case 'task_updated':
    case 'task_notification':
      return taskEvents(message, state);
    default:
      return [];
  }
}
