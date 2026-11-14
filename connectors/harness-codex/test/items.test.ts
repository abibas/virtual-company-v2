import { THINKING_MAX, TRUNCATED_MARKER } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { completedEvents, newItemState, startedEvents, todoEvents } from '../src/items.ts';

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

  it('gives nothing for reasoning until it completes, unknown items and items without an id', () => {
    const state = newItemState();
    expect(startedEvents({ id: 'r', type: 'reasoning', text: 'x' }, state)).toEqual([]);
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

  it('turns an error item into a notice and gives nothing for blank reasoning or unknown items', () => {
    expect(
      completedEvents({ id: 'e', type: 'error', message: ' model at capacity ' }, newItemState()),
    ).toEqual([{ type: 'notice', level: 'warn', message: 'model at capacity' }]);
    expect(completedEvents({ id: 'e', type: 'error' }, newItemState())).toEqual([]);
    expect(completedEvents({ id: 'r', type: 'reasoning', text: ' ' }, newItemState())).toEqual([]);
    expect(completedEvents({ id: 'r', type: 'reasoning' }, newItemState())).toEqual([]);
    expect(completedEvents({ id: 'u', type: 'image_generation' }, newItemState())).toEqual([]);
  });

  it('gives a completed reasoning item as thinking, cut to its limit with the marker', () => {
    expect(completedEvents({ id: 'r', type: 'reasoning', text: '**Reading**' }, newItemState())).toEqual([
      { type: 'thinking', text: '**Reading**' },
    ]);
    const [long] = completedEvents(
      { id: 'r', type: 'reasoning', text: 'r'.repeat(THINKING_MAX + 1) },
      newItemState(),
    );
    expect((long as { text: string }).text).toHaveLength(THINKING_MAX);
    expect((long as { text: string }).text.endsWith(TRUNCATED_MARKER)).toBe(true);
  });
});

describe('todoEvents', () => {
  const list = (items: unknown) => ({ id: 't', type: 'todo_list', items });

  it('gives the to-do list when it is made, changes or completes, done items as completed', () => {
    const state = newItemState();
    const items = [
      { text: 'Read', completed: true },
      { text: ' Write\nit ', completed: false },
    ];
    const todo = {
      type: 'todo',
      items: [
        { text: 'Read', status: 'completed' },
        { text: 'Write it', status: 'pending' },
      ],
    };
    expect(startedEvents(list(items), state)).toEqual([todo]);
    expect(todoEvents(list(items), state)).toEqual([]);
    expect(completedEvents(list([{ text: 'Read', completed: true }]), state)).toEqual([
      { type: 'todo', items: [{ text: 'Read', status: 'completed' }] },
    ]);
  });

  it('keeps 100 items of 300 characters, skips odd ones, and gives nothing for another item', () => {
    const state = newItemState();
    const many = Array.from({ length: 120 }, (_, i) => ({ text: `${i}${'t'.repeat(400)}` }));
    const [event] = todoEvents(list([...many, 'odd', { text: ' ' }]), state);
    expect((event as { items: unknown[] }).items).toHaveLength(100);
    expect((event as { items: { text: string }[] }).items[0]?.text).toHaveLength(300);
    expect(todoEvents(list('none'), newItemState())).toEqual([]);
    expect(todoEvents({ id: 'c', type: 'command_execution' }, newItemState())).toEqual([]);
  });
});

describe('the full trace (2026-11-14)', () => {
  it('a tool carries its whole input when its summary does not say it all', () => {
    const script = "/bin/zsh -lc 'cd src\ngit status'";
    const [command] = startedEvents({ ...cmd('in_progress', null), command: script }, newItemState());
    expect(command).toMatchObject({ summary: "/bin/zsh -lc 'cd src git status'", input: script });
    const [short] = startedEvents(cmd('in_progress', null), newItemState());
    expect(short).not.toHaveProperty('input');
    const args = { query: 'how', filters: { lang: 'ts', limit: 20 } };
    const mcp = { id: 'm', type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: args };
    expect(startedEvents({ ...mcp, status: 'in_progress' }, newItemState())[0]).toMatchObject({
      summary: 'how',
      input: JSON.stringify(args, null, 2),
    });
  });

  it('a result carries the whole text its summary cut: a command’s output, an MCP call’s text', () => {
    const output = `${'compiling…\n'.repeat(80)}done`;
    const [, result] = completedEvents(cmd('completed', 0, output), newItemState());
    expect(result).toMatchObject({ type: 'tool_result', ok: true, output });
    const [, small] = completedEvents(cmd('completed', 0, 'ok'), newItemState());
    expect(small).not.toHaveProperty('output');
    const text = 'x'.repeat(900);
    const mcp = { id: 'm', type: 'mcp_tool_call', server: 'docs', tool: 'search', arguments: {} };
    const done = { ...mcp, status: 'completed', result: { content: [{ type: 'text', text }] } };
    expect(completedEvents(done, newItemState())[1]).toMatchObject({ output: text });
  });
});
