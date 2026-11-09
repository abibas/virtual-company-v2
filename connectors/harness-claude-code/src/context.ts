import { countOf, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import { contextWindowOf, type TurnEvent, type TurnEventOf } from '@mwc/shared/harness';
import { bodyOf, type ClaudeState, parentOf } from './state.ts';

/**
 * How full the conversation is: after each message of the main agent with its usage, the last request's input, cache
 * reads, cache writes and output (their sum without the output is the conversation's size), and the model's window from
 * the table of `@mwc/shared` (`contextWindowOf`). Claude Code sends one line per content block of a message, each with
 * the same usage, so a message gives one event. At the turn's end `result.modelUsage[].contextWindow` names the window
 * the CLI used: when it differs, the last event is given again with it (unless it is smaller than what the conversation
 * already holds, as an ACP agent once reported 200k for a 1M conversation).
 */

/** Claude Code's own messages (an API error shown as a reply): no request behind them. */
const SYNTHETIC = '<synthetic>';

const sizeOf = (event: TurnEventOf<'context'>) =>
  event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens;

/** The `context` event of an assistant message of the main agent with its usage; none for a repeated one. */
export function contextEvents(message: JsonRecord, state: ClaudeState): TurnEvent[] {
  if (parentOf(message).parentId !== undefined) return [];
  const body = bodyOf(message);
  const model = stringOf(body.model);
  if (model === SYNTHETIC) return [];
  if (model !== undefined && model !== '') state.model ??= model;
  const usage = isRecord(body.usage) ? body.usage : undefined;
  const inputTokens = countOf(usage?.input_tokens);
  if (usage === undefined || inputTokens === undefined) return [];
  const event: TurnEventOf<'context'> = {
    type: 'context',
    inputTokens,
    cacheReadTokens: countOf(usage.cache_read_input_tokens) ?? 0,
    cacheCreationTokens: countOf(usage.cache_creation_input_tokens) ?? 0,
    outputTokens: countOf(usage.output_tokens) ?? 0,
    window: contextWindowOf(state.model),
  };
  const key = JSON.stringify([stringOf(body.id), event]);
  if (key === state.contextKey) return [];
  state.contextKey = key;
  state.context = event;
  return [event];
}

/** The window `result.modelUsage` gives for the main agent's model (or its only model); undefined when none. */
function reportedWindow(modelUsage: unknown, model: string | null): number | undefined {
  if (!isRecord(modelUsage)) return undefined;
  const entries = Object.entries(modelUsage);
  const base = (id: string) => id.replace(/\[[^\]]*\]$/, '');
  const mine =
    entries.find(([id]) => id === model) ??
    (model === null ? undefined : entries.find(([id]) => base(id) === base(model))) ??
    (entries.length === 1 ? entries[0] : undefined);
  const window = mine === undefined || !isRecord(mine[1]) ? undefined : countOf(mine[1].contextWindow);
  return window === undefined || window === 0 ? undefined : window;
}

/** At the turn's end: the last `context` again, with the window Claude Code reported, when that changes it. */
export function resultContext(message: JsonRecord, state: ClaudeState): TurnEvent[] {
  const last = state.context;
  if (last === undefined) return [];
  const reported = reportedWindow(message.modelUsage, state.model);
  if (reported === undefined || reported === last.window || reported < sizeOf(last)) return [];
  state.context = { ...last, window: reported };
  return [state.context];
}

/** After a compaction the last request's size is history: the next message measures it again. */
export function forgetContext(state: ClaudeState): void {
  state.context = undefined;
  state.contextKey = undefined;
}
