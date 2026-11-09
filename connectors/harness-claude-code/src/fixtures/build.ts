/**
 * The stream-json messages the recorded-style turns are made of (`../fixtures.ts`), written from Claude Code's
 * documented stream format (2.1.x): `system/init`, assistant and user messages (a subagent's with its
 * `parent_tool_use_id`), and the `result`.
 */

/** The conversation every scenario belongs to (the resume continues it). */
export const CLAUDE_SESSION_ID = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';

export const MODEL = 'claude-opus-5-5';

const uuid = (n: number) => `c0a80101-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const init = {
  type: 'system',
  subtype: 'init',
  cwd: '/home/agent/work',
  session_id: CLAUDE_SESSION_ID,
  tools: ['Agent', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'TodoWrite'],
  mcp_servers: [],
  model: MODEL,
  permissionMode: 'default',
  slash_commands: ['compact', 'context', 'cost'],
  apiKeySource: 'none',
  claude_code_version: '2.1.319',
  output_style: 'default',
  uuid: uuid(1),
};

export const usage = (input: number, written: number, read: number, output: number) => ({
  input_tokens: input,
  cache_creation_input_tokens: written,
  cache_read_input_tokens: read,
  output_tokens: output,
  service_tier: 'standard',
});

export interface MessageOptions {
  /** The subagent's call this message belongs to. */
  readonly parent?: string;
  readonly model?: string;
  readonly usage?: object;
}

/**
 * Message `n` of the turn: Claude Code writes one line per content block, so lines of one message share its id and
 * usage. The main agent's message `n` has read `13600 + 400 n` tokens from the cache.
 */
export function assistant(n: number, content: readonly object[], options: MessageOptions = {}) {
  return {
    type: 'assistant',
    message: {
      id: `msg_01Fixture${options.parent === undefined ? '' : 'Sub'}${n}`,
      type: 'message',
      role: 'assistant',
      model: options.model ?? MODEL,
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: options.usage ?? usage(3, 0, 13600 + 400 * n, 20),
    },
    parent_tool_use_id: options.parent ?? null,
    session_id: CLAUDE_SESSION_ID,
    uuid: uuid(100 + n),
  };
}

export function toolResult(
  id: string,
  content: string | readonly object[],
  isError: boolean,
  parent?: string,
) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }],
    },
    parent_tool_use_id: parent ?? null,
    session_id: CLAUDE_SESSION_ID,
    uuid: uuid(201),
  };
}

/** A `system` message of the turn (`task_started`, `compact_boundary`). */
export const system = (subtype: string, fields: object) => ({
  type: 'system',
  subtype,
  ...fields,
  session_id: CLAUDE_SESSION_ID,
  uuid: uuid(401),
});

/** What `result.modelUsage` says of a model. */
export const modelUsage = (contextWindow: number) => ({
  inputTokens: 6,
  outputTokens: 29,
  cacheReadInputTokens: 28000,
  cacheCreationInputTokens: 1200,
  webSearchRequests: 0,
  costUSD: 0.0312,
  contextWindow,
  maxOutputTokens: 128000,
});

export function result(reply: string, extra: object = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2310,
    duration_api_ms: 2104,
    num_turns: 1,
    result: reply,
    stop_reason: 'end_turn',
    session_id: CLAUDE_SESSION_ID,
    total_cost_usd: 0.0312,
    usage: usage(3, 1200, 14000, 9),
    modelUsage: { [MODEL]: modelUsage(1_000_000) },
    permission_denials: [],
    uuid: uuid(301),
    ...extra,
  };
}

export const lines = (...messages: readonly object[]) => messages.map((message) => JSON.stringify(message));
