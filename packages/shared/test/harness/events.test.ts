import { describe, expect, it } from 'vitest';
import {
  SLASH_COMMANDS_MAX,
  THINKING_MAX,
  TODO_ITEMS_MAX,
  TURN_EVENT_TYPES,
  TurnEvent,
} from '../../src/harness/events.ts';

describe('TurnEvent', () => {
  const events = [
    { type: 'session', sessionId: 's-1' },
    { type: 'init', model: 'claude-opus-5-5', cwd: '/w', slashCommands: ['compact', 'review'] },
    { type: 'init', model: null },
    { type: 'text', text: 'Hi' },
    { type: 'text', text: 'Inner', parentId: 'toolu_task' },
    { type: 'thinking', text: 'Check the folder first.' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'ls' },
    { type: 'tool_result', id: 't1', ok: true, summary: 'a\nb', parentId: 'toolu_task' },
    { type: 'todo', items: [{ text: 'Read the spec', status: 'in_progress' }] },
    {
      type: 'subagent',
      id: 'toolu_task',
      agentType: 'Explore',
      description: 'Find the parser',
      model: 'haiku',
      background: false,
      status: 'done',
      summary: 'It is in src/parser.ts.',
      lastStep: 'Running Read',
    },
    { type: 'usage', inputTokens: 10, outputTokens: 2, cachedInputTokens: 8, costUsd: 0.01 },
    { type: 'usage', inputTokens: 0, outputTokens: 0 },
    {
      type: 'context',
      inputTokens: 3,
      cacheReadTokens: 14000,
      cacheCreationTokens: 1200,
      outputTokens: 20,
      window: 1_000_000,
    },
    { type: 'compact', preTokens: 150_000, postTokens: 12_000, trigger: 'manual' },
    { type: 'compact', preTokens: 150_000, postTokens: null },
    { type: 'notice', level: 'warn', message: 'Refused for permission: Bash' },
    { type: 'result', ok: true, text: 'Hi', durationMs: 12 },
    { type: 'result', ok: false, error: 'Claude Code exited with code 1' },
  ];

  it('takes every event type, one of each listed in order', () => {
    for (const event of events) expect(TurnEvent.parse(event)).toEqual(event);
    expect(new Set(events.map((event) => event.type))).toEqual(new Set(TURN_EVENT_TYPES));
  });

  it('refuses summaries over their limits, negative counts, unknown levels and types', () => {
    for (const bad of [
      { type: 'tool', id: 't', name: 'Bash', summary: 'x'.repeat(201) },
      { type: 'tool', id: '', name: 'Bash', summary: '' },
      { type: 'tool_result', id: 't', ok: true, summary: 'x'.repeat(501) },
      { type: 'usage', inputTokens: -1, outputTokens: 0 },
      { type: 'usage', inputTokens: 1.5, outputTokens: 0 },
      { type: 'notice', level: 'error', message: 'x' },
      { type: 'notice', level: 'info', message: 'x'.repeat(2001) },
      { type: 'result', ok: false, error: 'x'.repeat(2001) },
      { type: 'text', text: '' },
      { type: 'session', sessionId: '-x' },
      { type: 'reasoning', text: 'x' },
    ]) {
      expect(TurnEvent.safeParse(bad).success).toBe(false);
    }
  });

  it('keeps the new events to their limits', () => {
    const subagent = { type: 'subagent', id: 't', agentType: 'Explore', description: '', status: 'running' };
    const context = {
      type: 'context',
      inputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
    };
    for (const bad of [
      { type: 'thinking', text: 'x'.repeat(THINKING_MAX + 1) },
      { type: 'thinking', text: '' },
      { type: 'init', model: 'm', slashCommands: Array.from({ length: SLASH_COMMANDS_MAX + 1 }, () => 'c') },
      { type: 'init', model: 'm', slashCommands: ['c'.repeat(101)] },
      { type: 'init', model: '' },
      { type: 'init' },
      {
        type: 'todo',
        items: Array.from({ length: TODO_ITEMS_MAX + 1 }, () => ({ text: 'x', status: 'pending' })),
      },
      { type: 'todo', items: [{ text: 'x', status: 'blocked' }] },
      { type: 'todo', items: [{ text: 'x'.repeat(301), status: 'pending' }] },
      { ...subagent, status: 'completed' },
      { ...subagent, agentType: '' },
      { ...subagent, summary: 'x'.repeat(4001) },
      { ...subagent, lastStep: 'x'.repeat(201) },
      { ...subagent, description: 'x'.repeat(201) },
      { ...context, window: 0 },
      { ...context, window: undefined },
      { type: 'compact', preTokens: -1, postTokens: null },
      { type: 'compact', preTokens: 1, postTokens: 1, trigger: 'timer' },
      { type: 'text', text: 'x', parentId: '' },
    ]) {
      expect(TurnEvent.safeParse(bad).success).toBe(false);
    }
    expect(TurnEvent.safeParse({ ...subagent }).success).toBe(true);
    expect(TurnEvent.safeParse({ ...context, window: null }).success).toBe(true);
  });
});
