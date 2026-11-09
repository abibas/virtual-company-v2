import { clipHead, clipLine, countOf, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import { NOTICE_MAX, RESULT_ERROR_MAX, type TurnEvent, type TurnEventOf } from '@mwc/shared/harness';
import { denialNotice, resultSummary, toolSummary } from './summary.ts';

/**
 * Claude Code's stream-json messages, one type each, as turn events. A subagent's own messages (those with a
 * `parent_tool_use_id`) give nothing: its call shows as the `Task` tool and its answer as that tool's result.
 */

/** The content blocks of an assistant or user message from the main agent; none for a subagent's. */
function blocksOf(message: JsonRecord): readonly unknown[] {
  if (stringOf(message.parent_tool_use_id) !== undefined) return [];
  const body = isRecord(message.message) ? message.message : {};
  return Array.isArray(body.content) ? body.content : [];
}

/** `system`: `api_retry` becomes a notice; `init` gives the session (the parser's own) and the rest nothing. */
export function systemEvents(message: JsonRecord): TurnEvent[] {
  if (message.subtype !== 'api_retry') return [];
  const attempt = countOf(message.attempt);
  const max = countOf(message.max_retries);
  const status = countOf(message.error_status);
  const why = stringOf(message.error) ?? (status === undefined ? undefined : `HTTP ${status}`);
  const count = attempt === undefined || max === undefined ? '' : ` (attempt ${attempt} of ${max})`;
  const text = `The request to the model failed and is retried${count}${why === undefined ? '' : `: ${why}`}`;
  return [{ type: 'notice', level: 'info', message: clipHead(text, NOTICE_MAX) }];
}

/** `assistant`: its text blocks and tool calls (thinking gives nothing). */
export function assistantEvents(message: JsonRecord): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (const block of blocksOf(message)) {
    if (!isRecord(block)) continue;
    const text = stringOf(block.text);
    if (block.type === 'text' && text !== undefined && text.trim() !== '')
      events.push({ type: 'text', text });
    const id = stringOf(block.id);
    if ((block.type === 'tool_use' || block.type === 'server_tool_use') && id !== undefined && id !== '') {
      const name = clipLine(stringOf(block.name) ?? '', 200) || 'tool';
      events.push({ type: 'tool', id: id.slice(0, 200), name, summary: toolSummary(block.input) });
    }
  }
  return events;
}

/** `user`: the results of the tool calls. */
export function userEvents(message: JsonRecord): TurnEvent[] {
  const events: TurnEvent[] = [];
  for (const block of blocksOf(message)) {
    if (!isRecord(block) || block.type !== 'tool_result') continue;
    const id = stringOf(block.tool_use_id);
    if (id === undefined || id === '') continue;
    events.push({
      type: 'tool_result',
      id: id.slice(0, 200),
      ok: block.is_error !== true,
      summary: resultSummary(block.content),
    });
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

/** `result`: a notice per refused tool, the usage, then the turn's end. */
export function resultEvents(message: JsonRecord): TurnEvent[] {
  const events: TurnEvent[] = [];
  const denials = Array.isArray(message.permission_denials) ? message.permission_denials : [];
  for (const denial of denials) {
    const notice = denialNotice(denial);
    if (notice) events.push(notice);
  }
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
