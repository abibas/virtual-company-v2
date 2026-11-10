import type { CodexReading } from '../../src/reading.ts';
import type { RolloutFs } from '../../src/rollout.ts';

/**
 * Recorded-style lines of Codex's session file (`$CODEX_HOME/sessions/…/rollout-<time>-<thread>.jsonl`), shaped as
 * Codex 0.166 writes them (`{ timestamp, ordinal, type, payload }`) with made-up text: a turn on GPT-6.1 Sol that made
 * two requests, and a `token_count` with `info: null` as Codex writes some.
 */

export const THREAD = '01a1c212-3068-7e90-8f9c-95e922ca6d88';
export const FILE_NAME = `rollout-2026-11-09T22-48-54-${THREAD}.jsonl`;

let ordinal = 0;
const line = (type: string, payload: object) =>
  JSON.stringify({ timestamp: '2026-11-09T20:49:00.000Z', ordinal: ordinal++, type, payload });

/** `last_token_usage` of one request. */
export const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});

/** Codex's `rate_limits` as a ChatGPT plan gives them, or as a gateway leaves them (all null). */
export const PLAN_LIMITS = {
  limit_id: 'codex',
  limit_name: null,
  primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_794_337_200 },
  secondary: { used_percent: 40, window_minutes: 10_080, resets_at: 1_794_700_000 },
  credits: null,
  individual_limit: null,
  spend_control_reached: null,
  plan_type: 'pro',
  rate_limit_reached_type: null,
};
export const NO_LIMITS = { ...PLAN_LIMITS, primary: null, secondary: null, plan_type: null };

export const tokenCount = (last: object | null, window = 475_000, limits: object = NO_LIMITS) =>
  line('event_msg', {
    type: 'token_count',
    info:
      last === null
        ? null
        : { total_token_usage: last, last_token_usage: last, model_context_window: window },
    rate_limits: limits,
  });

export const turnContext = (model: string, effort = 'xhigh') =>
  line('turn_context', { turn_id: 't', cwd: '/home/agent', model, effort, summary: 'auto' });

export const SESSION_META = line('session_meta', { id: THREAD, cli_version: '0.166.0', source: 'exec' });
const message = (text: string) =>
  line('response_item', { type: 'message', role: 'assistant', content: text });

/** One whole turn: its context, two requests, and its end. */
export const TURN_LINES = [
  SESSION_META,
  line('event_msg', { type: 'task_started', turn_id: 't' }),
  turnContext('gpt-6.1-sol'),
  message('Looking.'),
  tokenCount(null),
  tokenCount(usage(31_784, 31_232, 79)),
  message('The answer.'),
  tokenCount(usage(35_409, 33_152, 456)),
  line('event_msg', { type: 'task_complete', turn_id: 't' }),
];

/** What `TURN_LINES` read as. */
export const READING: CodexReading = {
  usage: { input: 35_409, cached: 33_152, cacheWrite: 0, output: 456, total: 35_865 },
  window: 475_000,
  model: 'gpt-6.1-sol',
};

/** A file system in memory: folders by path, files by path; it counts what it was asked. */
export function memoryRollouts(files: Record<string, string>) {
  const reads: number[] = [];
  const listed: string[] = [];
  const fs: RolloutFs = {
    list: (dir) => {
      listed.push(dir);
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split('/')[0] as string);
      return [...new Set(names)];
    },
    tail: (path, bytes) => {
      const text = files[path];
      if (text === undefined) return undefined;
      reads.push(bytes);
      const buffer = Buffer.from(text, 'utf8');
      return {
        text: buffer.subarray(Math.max(0, buffer.length - bytes)).toString('utf8'),
        size: buffer.length,
      };
    },
  };
  return { fs, reads, listed };
}
