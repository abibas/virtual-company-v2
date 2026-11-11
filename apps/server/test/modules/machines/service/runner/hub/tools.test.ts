import { createHash } from 'node:crypto';
import { TOOL_RESULT_MAX } from '@mwc/shared/flows';
import type { TurnArtifact, TurnToolResult } from '@mwc/shared/runner-protocol';
import { captureLogger } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  NO_TOOLS,
  replyText,
  TOOL_FAILED,
  type TurnToolCall,
  toolCalls,
} from '../../../../../../src/modules/machines/service/runner/hub/tools.ts';

const TURN = '019a7b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2c';
const CALL = '019a7b2c-3d4e-7f5a-8b6c-7d8e9f0a1b2d';
const call = (tool = 'task_read', input: Record<string, unknown> = {}) =>
  ({ type: 'turn.tool', turnId: TURN, callId: CALL, tool, input }) as const;

/** A one-part file a call attaches. */
function part(text: string, sha256?: string): TurnArtifact & { callId: string } {
  const bytes = new TextEncoder().encode(text);
  return {
    type: 'turn.artifact',
    turnId: TURN,
    index: 0,
    path: 'notes.md',
    contentType: 'text/markdown; charset=utf-8',
    size: bytes.length,
    sha256: sha256 ?? createHash('sha256').update(bytes).digest('hex'),
    part: 0,
    parts: 1,
    data: Buffer.from(bytes).toString('base64'),
    callId: CALL,
  };
}

/** Runs one call and gives what was sent back and what the sink got. */
async function run(
  calls: ReturnType<typeof toolCalls>,
  answer?: (call: TurnToolCall) => Promise<{ ok: boolean; text: string }>,
) {
  const got: TurnToolCall[] = [];
  const sent: TurnToolResult[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  const sink =
    answer &&
    ((c: TurnToolCall) => {
      got.push(c);
      return answer(c);
    });
  calls.call(call('task_attach', { path: 'notes.md' }), sink, (result) => {
    sent.push(result);
    resolve();
  });
  await promise;
  return { got, sent };
}

describe('toolCalls', () => {
  it('hands a call to its sink with the file it sent, and its answer back by the call’s id', async () => {
    const calls = toolCalls();
    calls.part(part('# Plan'));
    const { got, sent } = await run(calls, async () => ({ ok: true, text: 'Attached.' }));
    expect(got).toEqual([
      expect.objectContaining({
        callId: CALL,
        tool: 'task_attach',
        input: { path: 'notes.md' },
        file: expect.objectContaining({ path: 'notes.md', size: 6 }),
      }),
    ]);
    expect(sent).toEqual([
      { type: 'turn.tool.result', turnId: TURN, callId: CALL, ok: true, text: 'Attached.' },
    ]);
    const again = await run(calls, async () => ({ ok: true, text: 'x' }));
    expect(again.got[0]?.file).toBeUndefined();
  });

  it('answers by itself when the turn takes no calls, or its sink fails', async () => {
    expect((await run(toolCalls())).sent[0]).toMatchObject({ ok: false, text: NO_TOOLS });
    const { logger, lines } = captureLogger();
    const failing = await run(toolCalls({ logger }), async () => {
      throw new Error('boom');
    });
    expect(failing.sent[0]).toMatchObject({ ok: false, text: TOOL_FAILED });
    expect(lines.some((line) => line.msg === 'a tool call failed')).toBe(true);
  });

  it('drops a file whose bytes do not match, and the files of a turn that ended', async () => {
    const { logger, lines } = captureLogger();
    const calls = toolCalls({ logger });
    calls.part(part('# Plan', 'a'.repeat(64)));
    expect(lines.some((line) => line.msg === 'an attached file was dropped')).toBe(true);
    expect((await run(calls, async () => ({ ok: true, text: 'x' }))).got[0]?.file).toBeUndefined();
    calls.part(part('# Plan'));
    calls.drop(TURN);
    expect((await run(calls, async () => ({ ok: true, text: 'x' }))).got[0]?.file).toBeUndefined();
  });

  it('never sends an empty or too long answer', () => {
    expect(replyText('  ')).toBe(TOOL_FAILED);
    expect(replyText('x'.repeat(TOOL_RESULT_MAX + 5))).toHaveLength(TOOL_RESULT_MAX);
    expect(replyText('fine')).toBe('fine');
  });
});
