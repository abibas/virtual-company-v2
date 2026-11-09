import { describe, expect, it } from 'vitest';
import { assistantEvents, resultEvents, systemEvents, userEvents } from '../src/messages.ts';

const assistant = (content: unknown, parent: string | null = null) => ({
  type: 'assistant',
  message: { role: 'assistant', content },
  parent_tool_use_id: parent,
});
const user = (content: unknown, parent: string | null = null) => ({
  type: 'user',
  message: { role: 'user', content },
  parent_tool_use_id: parent,
});

describe('systemEvents', () => {
  it('turns an API retry into an info notice', () => {
    const retry = { type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, error_status: 529 };
    expect(systemEvents(retry)).toEqual([
      {
        type: 'notice',
        level: 'info',
        message: 'The request to the model failed and is retried (attempt 2 of 10): HTTP 529',
      },
    ]);
    expect(systemEvents({ subtype: 'api_retry', error: 'overloaded_error' })[0]).toMatchObject({
      message: 'The request to the model failed and is retried: overloaded_error',
    });
    expect(systemEvents({ subtype: 'api_retry' })[0]).toMatchObject({
      message: 'The request to the model failed and is retried',
    });
  });

  it('gives nothing for init and the other system messages', () => {
    expect(systemEvents({ type: 'system', subtype: 'init', session_id: 's' })).toEqual([]);
    expect(systemEvents({ type: 'system', subtype: 'compact_boundary' })).toEqual([]);
  });
});

describe('assistantEvents', () => {
  it('gives the text blocks and the tool calls, in order, and nothing for thinking', () => {
    const events = assistantEvents(
      assistant([
        { type: 'thinking', thinking: 'hmm', signature: 's' },
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/w/a.ts' } },
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'zod' } },
      ]),
    );
    expect(events).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool', id: 'toolu_1', name: 'Read', summary: '/w/a.ts' },
      { type: 'tool', id: 'srvtoolu_1', name: 'web_search', summary: 'zod' },
    ]);
  });

  it('skips blank text, calls without an id, odd blocks and a subagent’s messages', () => {
    expect(
      assistantEvents(
        assistant([
          { type: 'text', text: '  \n' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', id: '' },
          'x',
          null,
        ]),
      ),
    ).toEqual([]);
    expect(assistantEvents(assistant([{ type: 'text', text: 'inner' }], 'toolu_task'))).toEqual([]);
    expect(assistantEvents({ type: 'assistant' })).toEqual([]);
    expect(assistantEvents({ type: 'assistant', message: { content: 'text' } })).toEqual([]);
  });

  it('names a call without a name `tool`', () => {
    expect(assistantEvents(assistant([{ type: 'tool_use', id: 't', input: {} }]))).toEqual([
      { type: 'tool', id: 't', name: 'tool', summary: '' },
    ]);
  });
});

describe('userEvents', () => {
  it('gives each tool result, ok unless it is an error', () => {
    const events = userEvents(
      user([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'index.ts' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: [{ type: 'text', text: 'denied' }],
          is_error: true,
        },
        { type: 'text', text: 'not a result' },
        { type: 'tool_result', content: 'no id' },
      ]),
    );
    expect(events).toEqual([
      { type: 'tool_result', id: 'toolu_1', ok: true, summary: 'index.ts' },
      { type: 'tool_result', id: 'toolu_2', ok: false, summary: 'denied' },
    ]);
  });

  it('gives nothing for a subagent’s results or a plain user message', () => {
    expect(userEvents(user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }], 'toolu_task'))).toEqual(
      [],
    );
    expect(userEvents(user('a plain message'))).toEqual([]);
  });
});

describe('resultEvents', () => {
  const success = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 2310,
    result: 'Done.',
    total_cost_usd: 0.03,
    usage: {
      input_tokens: 3,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 2000,
      output_tokens: 9,
    },
    permission_denials: [],
  };

  it('gives the usage (cache reads and writes counted as input) and the reply', () => {
    expect(resultEvents(success)).toEqual([
      { type: 'usage', inputTokens: 2103, outputTokens: 9, cachedInputTokens: 2000, costUsd: 0.03 },
      { type: 'result', ok: true, text: 'Done.', durationMs: 2310 },
    ]);
  });

  it('puts a notice per refused tool before the usage', () => {
    const events = resultEvents({
      ...success,
      permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, 'odd'],
    });
    expect(events.map((event) => event.type)).toEqual(['notice', 'usage', 'result']);
    expect(events[0]).toMatchObject({ message: 'Refused for permission: Bash (rm -rf build)' });
  });

  it('fails with the result text, the errors, or the subtype', () => {
    expect(
      resultEvents({ ...success, is_error: true, result: 'Invalid API key · Please run /login' }).at(-1),
    ).toEqual({
      type: 'result',
      ok: false,
      error: 'Invalid API key · Please run /login',
      durationMs: 2310,
    });
    const failed = (extra: object) => resultEvents({ type: 'result', ...extra }).at(-1);
    expect(failed({ subtype: 'error_during_execution', errors: ['boom', 1, 'bang'] })).toEqual({
      type: 'result',
      ok: false,
      error: 'boom; bang',
    });
    expect(failed({ subtype: 'error_max_turns' })).toMatchObject({
      error: 'The turn reached its limit of turns.',
    });
    expect(failed({ subtype: 'error_max_budget_usd' })).toMatchObject({
      error: 'The turn reached its budget.',
    });
    expect(failed({ subtype: 'error_during_execution', result: ' ' })).toMatchObject({
      error: 'Claude Code failed during the turn.',
    });
    expect(failed({ subtype: 'error_new_kind' })).toMatchObject({
      error: 'Claude Code ended the turn with error_new_kind.',
    });
    expect(failed({ is_error: true })).toMatchObject({ error: 'Claude Code reported an error.' });
    expect(failed({ subtype: 'success', is_error: true })).toMatchObject({
      error: 'Claude Code reported an error.',
    });
  });

  it('gives no usage without one, no cost when it is not a number, and no empty reply', () => {
    expect(resultEvents({ type: 'result', subtype: 'success', result: '' })).toEqual([
      { type: 'result', ok: true },
    ]);
    expect(resultEvents({ type: 'result', total_cost_usd: 0.5 })[0]).toEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0.5,
    });
    expect(resultEvents({ type: 'result', usage: {}, total_cost_usd: -1 })[0]).toEqual({
      type: 'usage',
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
    });
  });
});
