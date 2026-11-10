import { countOf, isRecord, type JsonRecord, parseJsonLine, stringOf } from '@mwc/harness-core';
import {
  EVENT_MODEL_MAX,
  PLAN_TYPE_MAX,
  type RateLimits,
  type RateLimitWindow,
  type TurnEventOf,
} from '@mwc/shared/harness';

/**
 * Codex's own context reading, from the lines of its session file (docs/harness.md, "Codex's context reading"). Codex
 * writes a `token_count` event after each model request: `info.last_token_usage` is that request (its `total_tokens`,
 * input and output, is what `/status` calls used), `info.model_context_window` the window it shows (its
 * `context_window` × 95%), and `rate_limits` the plan's limits. A `turn_context` line opens each turn with the model it
 * runs. The reading is the last `token_count` that has `info`, with the model of the last `turn_context` before it.
 */

/** Tokens Codex leaves out of its "% left": instructions and tools it counts as always there (its `BASELINE_TOKENS`). */
export const CODEX_BASELINE_TOKENS = 12_000;

/** The last request's tokens, as Codex counts them. */
export interface CodexUsage {
  readonly input: number;
  readonly cached: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly total: number;
}

export interface CodexReading {
  readonly usage: CodexUsage;
  readonly window: number | null;
  /** The model of the turn it belongs to; undefined when its `turn_context` was not among the lines read. */
  readonly model?: string;
  readonly rateLimits?: RateLimits;
}

/** What the lines gave: the reading, if any, and whether it is whole (its model found too). */
export interface ReadingScan {
  readonly reading: CodexReading | undefined;
  readonly whole: boolean;
}

/** Only lines naming one of these are parsed: a long tool output is never `JSON.parse`d for nothing. */
const WANTED = ['"token_count"', '"turn_context"'] as const;

const wanted = (line: string): JsonRecord | null =>
  WANTED.some((marker) => line.includes(marker)) ? parseJsonLine(line) : null;

/** The reading in `lines` (a file's lines, oldest first), walking back from the end. */
export function scanReading(lines: readonly string[]): ReadingScan {
  let found: Omit<CodexReading, 'model'> | undefined;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = wanted(lines[index] as string);
    if (line === null || !isRecord(line.payload)) continue;
    if (found === undefined) {
      if (line.type === 'event_msg' && line.payload.type === 'token_count') found = tokenCount(line.payload);
      continue;
    }
    if (line.type !== 'turn_context') continue;
    const model = modelOf(line.payload.model);
    return { reading: model === undefined ? found : { ...found, model }, whole: true };
  }
  return { reading: found, whole: false };
}

/** A model id as an event may name it; undefined when it is empty or too long. */
export const modelOf = (value: unknown): string | undefined => {
  const model = stringOf(value)?.trim();
  return model && model.length <= EVENT_MODEL_MAX ? model : undefined;
};

/** A `token_count` payload's reading; undefined without `info` (Codex writes some with `info: null`). */
function tokenCount(payload: JsonRecord): Omit<CodexReading, 'model'> | undefined {
  const info = payload.info;
  if (!isRecord(info) || !isRecord(info.last_token_usage)) return undefined;
  const last = info.last_token_usage;
  const input = countOf(last.input_tokens) ?? 0;
  const output = countOf(last.output_tokens) ?? 0;
  const usage: CodexUsage = {
    input,
    cached: countOf(last.cached_input_tokens) ?? 0,
    cacheWrite: countOf(last.cache_write_input_tokens) ?? 0,
    output,
    total: countOf(last.total_tokens) ?? input + output,
  };
  const window = countOf(info.model_context_window);
  const rateLimits = rateLimitsOf(payload.rate_limits);
  return { usage, window: window ? window : null, ...(rateLimits === undefined ? {} : { rateLimits }) };
}

/** Codex's `rate_limits`: its two windows and the plan; undefined when it says none of them. */
export function rateLimitsOf(value: unknown): RateLimits | undefined {
  if (!isRecord(value)) return undefined;
  const primary = limitWindow(value.primary);
  const secondary = limitWindow(value.secondary);
  const plan = stringOf(value.plan_type)?.trim();
  const planType = plan && plan.length <= PLAN_TYPE_MAX ? plan : undefined;
  if (primary === undefined && secondary === undefined && planType === undefined) return undefined;
  return {
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    ...(planType === undefined ? {} : { planType }),
  };
}

/** One window: `used_percent`, `window_minutes`, `resets_at` (Unix seconds); undefined without its percentage. */
function limitWindow(value: unknown): RateLimitWindow | undefined {
  if (!isRecord(value)) return undefined;
  const used = value.used_percent;
  if (typeof used !== 'number' || !Number.isFinite(used)) return undefined;
  const minutes = countOf(value.window_minutes);
  const resetsAt = secondsToIso(value.resets_at);
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    ...(minutes ? { windowMinutes: minutes } : {}),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function secondsToIso(value: unknown): string | undefined {
  const seconds = countOf(value);
  if (!seconds) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** The reading as the turn's `context` event: exact (no `estimate`), its size Codex's own `total_tokens`. */
export function readingEvent(reading: CodexReading): TurnEventOf<'context'> {
  const { input, cached, cacheWrite, output, total } = reading.usage;
  const cacheRead = Math.min(cached, input);
  const cacheCreation = Math.min(cacheWrite, input - cacheRead);
  return {
    type: 'context',
    inputTokens: input - cacheRead - cacheCreation,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
    outputTokens: output,
    window: reading.window,
    usedTokens: total,
    baselineTokens: CODEX_BASELINE_TOKENS,
    ...(reading.model === undefined ? {} : { model: reading.model }),
    ...(reading.rateLimits === undefined ? {} : { rateLimits: reading.rateLimits }),
  };
}
