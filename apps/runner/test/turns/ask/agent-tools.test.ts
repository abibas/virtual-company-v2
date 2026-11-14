import { stepTools } from '@mwc/shared/flows';
import { describe, expect, it } from 'vitest';
import {
  agentToolDefinition,
  checkToolInput,
  knownTools,
  toolsFromEnv,
} from '../../../src/turns/ask/agent-tools.ts';

describe('the agents’ tools a turn offers', () => {
  it('keeps the names the runner knows, each once, in order, and reads them from MWC_TOOLS', () => {
    expect(knownTools(['task_read', 'task_hand_on', 'rm_rf', 'task_read', 'team_board'])).toEqual([
      'task_read',
      'task_hand_on',
      'team_board',
    ]);
    expect(toolsFromEnv({ MWC_TOOLS: ' task_read , task_pass,,task_send_back,ask_user_question ' })).toEqual([
      'task_read',
      'task_pass',
      'task_send_back',
    ]);
    expect(toolsFromEnv({})).toEqual([]);
    expect(knownTools(Array.from({ length: 40 }, () => 'task_read'))).toEqual(['task_read']);
  });

  it('lists each tool with its words, its input as JSON Schema and whether it only reads', () => {
    expect(agentToolDefinition('task_send_back')).toEqual({
      name: 'task_send_back',
      title: 'Send the task back',
      description: expect.stringContaining('send it back with why and your findings'),
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 2000, description: 'Why, in a sentence or two' },
          findings: expect.objectContaining({ type: 'string', maxLength: 50_000 }),
        },
        required: ['reason', 'findings'],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    });
    expect(agentToolDefinition('team_board').annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(agentToolDefinition('task_read').inputSchema).toEqual({ type: 'object', properties: {} });
    expect(agentToolDefinition('task_attach').inputSchema).not.toHaveProperty('$schema');
    expect(stepTools('work').map((tool) => agentToolDefinition(tool).name)).toEqual([
      'task_read',
      'task_hand_on',
      'task_attach',
      'task_blocked',
    ]);
  });

  it('checks a call’s input: trimmed and kept, or what to fix, one issue a line', () => {
    expect(checkToolInput('task_hand_on', { summary: '  Done.  ', extra: 1 })).toEqual({
      ok: true,
      input: { summary: 'Done.' },
    });
    expect(checkToolInput('team_board', undefined)).toEqual({ ok: true, input: {} });
    const bad = checkToolInput('task_send_back', { reason: '' });
    expect(bad.ok).toBe(false);
    expect(bad.ok ? '' : bad.error.split('\n')).toEqual([
      'task_send_back did nothing; fix its input and call it again:',
      expect.stringMatching(/^reason: /),
      expect.stringMatching(/^findings: /),
    ]);
    const both = checkToolInput('task_attach', { name: 'Notes', text: 'x', url: 'https://example.com' });
    expect(both.ok ? '' : both.error).toContain('give exactly one of text, path or url');
    expect(checkToolInput('task_show', { key: 'T-12' })).toEqual({ ok: true, input: { key: 'T-12' } });
  });

  it('knows the decision log’s record_decision (2026-11-14): its words, its input and that it writes', () => {
    expect(knownTools(['record_decision', 'task_read'])).toEqual(['record_decision', 'task_read']);
    const listed = agentToolDefinition('record_decision');
    expect(listed).toMatchObject({
      name: 'record_decision',
      title: 'Record a decision',
      inputSchema: {
        type: 'object',
        required: ['what', 'why'],
        properties: {
          what: expect.objectContaining({ maxLength: 200 }),
          why: expect.objectContaining({ maxLength: 1000 }),
          sources: expect.objectContaining({ type: 'array', maxItems: 20 }),
          outcome: expect.objectContaining({ enum: expect.arrayContaining(['approved', 'declined']) }),
        },
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    });
    expect(checkToolInput('record_decision', { what: 'Approve', why: 'Tests pass.' })).toEqual({
      ok: true,
      input: { what: 'Approve', why: 'Tests pass.' },
    });
  });
});
