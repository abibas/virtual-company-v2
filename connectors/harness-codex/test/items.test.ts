import { describe, expect, it } from 'vitest';
import { completedEvents, newItemState, startedEvents } from '../src/items.ts';

const cmd = (status: string, exit: number | null, output = '') => ({
  id: 'item_1',
  type: 'command_execution',
  command: "/bin/zsh -lc 'ls'",
  aggregated_output: output,
  exit_code: exit,
  status,
});

describe('startedEvents', () => {
  it('shows a command, an MCP call and a web search when they start, once', () => {
    const state = newItemState();
    expect(startedEvents(cmd('in_progress', null), state)).toEqual([
      { type: 'tool', id: 'item_1', name: 'command', summary: "/bin/zsh -lc 'ls'" },
    ]);
    expect(startedEvents(cmd('in_progress', null), state)).toEqual([]);
    const mcp = {
      id: 'item_2',
      type: 'mcp_tool_call',
      server: 'docs',
      tool: 'search',
      arguments: { q: 'zod' },
    };
    expect(startedEvents(mcp, state)).toEqual([
      { type: 'tool', id: 'item_2', name: 'mcp:docs/search', summary: 'zod' },
    ]);
    expect(startedEvents({ id: 'item_3', type: 'web_search', query: 'codex exec json' }, state)).toEqual([
      { type: 'tool', id: 'item_3', name: 'web_search', summary: 'codex exec json' },
    ]);
  });

  it('gives nothing for reasoning, the to-do list, unknown items and items without an id', () => {
    const state = newItemState();
    expect(startedEvents({ id: 'r', type: 'reasoning', text: 'x' }, state)).toEqual([]);
    expect(startedEvents({ id: 't', type: 'todo_list', items: [] }, state)).toEqual([]);
    expect(startedEvents({ id: 'c', type: 'collab_tool_call' }, state)).toEqual([]);
    expect(startedEvents({ type: 'command_execution', command: 'ls' }, state)).toEqual([]);
    expect(startedEvents({ id: '', type: 'web_search' }, state)).toEqual([]);
  });
});

describe('completedEvents', () => {
  it('gives the agent’s text and keeps it as the reply, skipping blank messages', () => {
    const state = newItemState();
    expect(completedEvents({ id: 'm', type: 'agent_message', text: 'Done.' }, state)).toEqual([
      { type: 'text', text: 'Done.' },
    ]);
    expect(completedEvents({ id: 'm2', type: 'agent_message', text: ' ' }, state)).toEqual([]);
    expect(completedEvents({ id: 'm3', type: 'agent_message' }, state)).toEqual([]);
    expect(state.lastMessage).toBe('Done.');
  });

  it('gives a command’s result after its start: the exit code and the end of its output', () => {
    const state = newItemState();
    startedEvents(cmd('in_progress', null), state);
    expect(completedEvents(cmd('completed', 0, 'a\nb\n'), state)).toEqual([
      { type: 'tool_result', id: 'item_1', ok: true, summary: 'exit 0: a\nb' },
    ]);
    const failed = completedEvents(cmd('failed', 2, `${'x'.repeat(900)}\nfatal: no`), newItemState());
    expect(failed[0]).toMatchObject({ type: 'tool', name: 'command' });
    expect(failed[1]).toMatchObject({ type: 'tool_result', ok: false });
    const summary = (failed[1] as { summary: string }).summary;
    expect(summary).toHaveLength(500);
    expect(summary.startsWith('exit 2: …')).toBe(true);
    expect(summary.endsWith('fatal: no')).toBe(true);
    expect(completedEvents(cmd('completed', null), newItemState())[1]).toMatchObject({
      ok: true,
      summary: 'completed',
    });
  });

  it('refuses a declined command with a notice', () => {
    const events = completedEvents({ ...cmd('declined', null), command: 'rm -rf build' }, newItemState());
    expect(events).toEqual([
      { type: 'tool', id: 'item_1', name: 'command', summary: 'rm -rf build' },
      { type: 'tool_result', id: 'item_1', ok: false, summary: 'declined' },
      { type: 'notice', level: 'warn', message: 'Refused for permission: rm -rf build' },
    ]);
  });

  it('shows a file change with its changes and whether it applied', () => {
    const change = {
      id: 'f',
      type: 'file_change',
      changes: [
        { path: 'src/a.ts', kind: 'update' },
        { path: 'src/b.ts', kind: 'add' },
        { kind: 'delete' },
        'x',
      ],
      status: 'completed',
    };
    expect(completedEvents(change, newItemState())).toEqual([
      { type: 'tool', id: 'f', name: 'file_change', summary: 'update src/a.ts, add src/b.ts, delete' },
      { type: 'tool_result', id: 'f', ok: true, summary: 'applied' },
    ]);
    const failed = completedEvents(
      { id: 'g', type: 'file_change', changes: 'x', status: 'failed' },
      newItemState(),
    );
    expect(failed).toEqual([
      { type: 'tool', id: 'g', name: 'file_change', summary: '' },
      { type: 'tool_result', id: 'g', ok: false, summary: 'failed' },
    ]);
    const odd = completedEvents(
      { id: 'h', type: 'file_change', changes: [{ path: 'p' }], status: 'completed' },
      newItemState(),
    );
    expect(odd[0]).toMatchObject({ summary: 'change p' });
  });

  it('gives an MCP call’s text result or its error', () => {
    const base = { id: 'm', type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: { limit: 3 } };
    const ok = completedEvents(
      {
        ...base,
        status: 'completed',
        result: { content: [{ type: 'text', text: 'found 3' }, { type: 'image' }] },
      },
      newItemState(),
    );
    expect(ok).toEqual([
      { type: 'tool', id: 'm', name: 'mcp:docs/search', summary: '{"limit":3}' },
      { type: 'tool_result', id: 'm', ok: true, summary: 'found 3' },
    ]);
    const failed = completedEvents(
      { ...base, status: 'failed', error: { message: 'server gone' } },
      newItemState(),
    );
    expect(failed[1]).toEqual({ type: 'tool_result', id: 'm', ok: false, summary: 'server gone' });
    const empty = completedEvents(
      { id: 'n', type: 'mcp_tool_call', status: 'completed', result: null },
      newItemState(),
    );
    expect(empty).toEqual([
      { type: 'tool', id: 'n', name: 'mcp:?/?', summary: '' },
      { type: 'tool_result', id: 'n', ok: true, summary: 'completed' },
    ]);
  });

  it('shows a web search without a result, and nothing for a tool still running', () => {
    expect(completedEvents({ id: 'w', type: 'web_search', query: 'q' }, newItemState())).toEqual([
      { type: 'tool', id: 'w', name: 'web_search', summary: 'q' },
    ]);
    expect(completedEvents(cmd('in_progress', null), newItemState())).toEqual([
      { type: 'tool', id: 'item_1', name: 'command', summary: "/bin/zsh -lc 'ls'" },
    ]);
  });

  it('turns an error item into a notice and gives nothing for reasoning or unknown items', () => {
    expect(
      completedEvents({ id: 'e', type: 'error', message: ' model at capacity ' }, newItemState()),
    ).toEqual([{ type: 'notice', level: 'warn', message: 'model at capacity' }]);
    expect(completedEvents({ id: 'e', type: 'error' }, newItemState())).toEqual([]);
    expect(completedEvents({ id: 'r', type: 'reasoning', text: 'x' }, newItemState())).toEqual([]);
    expect(completedEvents({ id: 'u', type: 'image_generation' }, newItemState())).toEqual([]);
  });
});
