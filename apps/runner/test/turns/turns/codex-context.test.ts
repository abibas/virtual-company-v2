import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CodexDriver } from '@mwc/harness-codex';
import { PARSER_TICK_MS } from '@mwc/harness-core';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it, vi } from 'vitest';
import { nodePrivateFs } from '../../../src/turns/files.ts';
import { JOURNAL_POLL_MS } from '../../../src/turns/turn.ts';
import type { FakeChild } from '../../fixtures/spawn.ts';
import { settle } from '../../fixtures/time.ts';
import { FAKE_COMMAND, fakeHarnessHost, startTurn as start, turnsWorld } from '../../fixtures/turns.ts';

describe("a Codex turn's context reading", () => {
  const THREAD = '01a1c212-3068-7e90-8f9c-95e922ca6d88';
  const line = (type: string, payload: object) =>
    JSON.stringify({ timestamp: 't', ordinal: 0, type, payload });
  /** Codex's session file of the thread: its turn's model, then a request's reading. */
  const ROLLOUT = [
    line('turn_context', { model: 'gpt-6.1-sol', effort: 'xhigh' }),
    line('event_msg', {
      type: 'token_count',
      info: {
        last_token_usage: {
          input_tokens: 35_409,
          cached_input_tokens: 33_152,
          output_tokens: 456,
          total_tokens: 35_865,
        },
        model_context_window: 475_000,
      },
      rate_limits: null,
    }),
  ].join('\n');
  const STDOUT = [
    JSON.stringify({ type: 'thread.started', thread_id: THREAD }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 249_000, cached_input_tokens: 225_000, output_tokens: 1500 },
    }),
  ].join('\n');

  it("ends with Codex's own reading from the thread's file in the turn's home folder", async () => {
    const driver = new CodexDriver({ command: FAKE_COMMAND, rollouts: nodePrivateFs() });
    const { host, cwd } = fakeHarnessHost({ drivers: { codex: driver } });
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => {
      const day = join(w.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'sessions', '2026', '11', '09');
      mkdirSync(day, { recursive: true });
      writeFileSync(join(day, `rollout-2026-11-09T22-48-54-${THREAD}.jsonl`), ROLLOUT);
      child.finish(`${STDOUT}\n`, 0);
    });
    start(w, fakeTurnSpec('codex', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const context = w.events().find((item) => item.event.type === 'context')?.event;
    expect(context).toMatchObject({ usedTokens: 35_865, window: 475_000, model: 'gpt-6.1-sol' });
    expect(context).not.toHaveProperty('estimate');
    expect(w.ends()[0]).toMatchObject({ ok: true });
  });

  it("follows the thread's subagents in their files while the turn runs, between its lines", async () => {
    const SOL = '019a6f2f-1a20-7b31-8c4d-2e6f0a9b3c51';
    const driver = new CodexDriver({ command: FAKE_COMMAND, rollouts: nodePrivateFs() });
    const { host, cwd } = fakeHarnessHost({ drivers: { codex: driver } });
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.stdout?.write(`${STDOUT.split('\n')[0]}\n`));
    start(w, fakeTurnSpec('codex', { cwd }));
    await settle();
    // The thread's line is read before its file is there (a new thread's file is read from its start).
    await w.time.advance(JOURNAL_POLL_MS);
    const day = join(w.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'sessions', '2026', '11', '10');
    mkdirSync(day, { recursive: true });
    const turnStarted = line('event_msg', {
      type: 'task_started',
      started_at: Math.floor(Date.now() / 1000),
    });
    const started = line('event_msg', {
      type: 'item_completed',
      item: {
        type: 'SubAgentActivity',
        id: 'c1',
        kind: 'started',
        agent_thread_id: SOL,
        agent_path: '/root/sleep_sol',
      },
    });
    writeFileSync(join(day, `rollout-a-${THREAD}.jsonl`), `${turnStarted}\n${started}\n`);
    await w.time.advance(PARSER_TICK_MS + 200);
    const call = line('response_item', {
      type: 'function_call',
      name: 'exec_command',
      arguments: JSON.stringify({ cmd: 'sleep 45' }),
      call_id: 'k1',
    });
    writeFileSync(join(day, `rollout-b-${SOL}.jsonl`), `${turnStarted}\n${call}\n`);
    await w.time.advance(PARSER_TICK_MS + 200);
    (w.spawn.calls[0] as { child: FakeChild }).child.finish(`${STDOUT.split('\n')[1]}\n`, 0);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const sol = { type: 'subagent', id: SOL, agentType: 'sleep_sol', description: '', background: true };
    expect(w.events().map((item) => item.event)).toEqual([
      { type: 'session', sessionId: THREAD },
      { ...sol, status: 'running' },
      { type: 'tool', id: `${SOL}:k1`, name: 'command', summary: 'sleep 45', parentId: SOL },
      expect.objectContaining({ type: 'usage' }),
      expect.objectContaining({ type: 'context', estimate: true }),
      { ...sol, status: 'interrupted' },
      { type: 'result', ok: true },
    ]);
  });
});
