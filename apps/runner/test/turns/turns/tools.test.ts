import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TurnArtifact, TurnTool } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import { callRunner, TOOL_NOT_IN_TURN } from '../../../src/turns/ask/client.ts';
import type { AskReply } from '../../../src/turns/ask/tool.ts';
import { TOOL_ENDING, TOOL_LOST } from '../../../src/turns/turn.ts';
import { askRoot, testAskHost } from '../../fixtures/ask.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { settle } from '../../fixtures/time.ts';
import { answerLines, FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../../fixtures/turns.ts';

const DIR = 'tasks/T-12/artifacts/1-develop/round-1';

/** A world whose host offers the runner's tools and outputs folders; the link up unless `online` says otherwise. */
function toolWorld(online?: () => boolean) {
  const fake = fakeHarnessHost();
  const host = {
    ...fake.host,
    ask: testAskHost(memoryLog().log, askRoot(fake.root)),
    artifacts: nodeArtifactFs(),
  };
  const w = turnsWorld({ host, ...(online ? { online } : {}) });
  return { ...fake, w };
}

const start = (w: ReturnType<typeof turnsWorld>, cwd: string, tools?: string[]) => {
  const turnId = newId();
  const spec = fakeTurnSpec('claude_code', { cwd, ...(tools ? { tools } : {}), artifacts: { dir: DIR } });
  w.turns.handle({ type: 'turn.start', turnId, spec });
  return turnId;
};

const envOf = (w: ReturnType<typeof turnsWorld>) => w.spawn.calls[0]?.options.env ?? {};
const socketOf = (w: ReturnType<typeof turnsWorld>) => ({
  socket: envOf(w).MWC_ASK_SOCKET as string,
  token: envOf(w).MWC_ASK_TOKEN as string,
});
const toolFrames = (w: ReturnType<typeof turnsWorld>) =>
  w.sent.filter((frame): frame is TurnTool => frame.type === 'turn.tool');

describe("a chat turn's agents' tools (S6a)", () => {
  it('offers the spec’s tools it knows, after the question tool, by name and in the environment', async () => {
    const { w, driver, cwd } = toolWorld();
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(w, cwd, ['task_read', 'task_hand_on', 'some_future_tool', 'task_read', 'task_attach']);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(driver.tools[0]?.names).toEqual(['ask_user_question', 'task_read', 'task_hand_on', 'task_attach']);
    expect(envOf(w).MWC_TOOLS).toBe('task_read,task_hand_on,task_attach');
    const plain = toolWorld();
    plain.w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(plain.w, plain.cwd);
    await vi.waitFor(() => expect(plain.w.ends()).toHaveLength(1));
    expect(plain.driver.tools[0]?.names).toEqual(['ask_user_question']);
    expect(envOf(plain.w)).not.toHaveProperty('MWC_TOOLS');
  });

  it('relays a call after the events before it and answers what the server says, by its call id', async () => {
    const { w, cwd } = toolWorld();
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
      child.stdout?.write(
        `${fakeLines([
          { type: 'session', sessionId: 's-1' },
          { type: 'text', text: 'Done.' },
        ]).join('\n')}\n`,
      );
    });
    const turnId = start(w, cwd, ['task_read', 'task_hand_on']);
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    const { socket, token } = socketOf(w);
    const replies: AskReply[] = [];
    const pending = callRunner(socket, token, { tool: 'task_hand_on', input: { summary: 'Fixed.' } }).then(
      (r) => replies.push(r),
    );
    await vi.waitFor(() => expect(toolFrames(w)).toHaveLength(1));
    const order = w.sent.map((frame) => frame.type);
    expect(order.indexOf('turn.tool')).toBeGreaterThan(order.indexOf('turn.events'));
    const [call] = toolFrames(w);
    expect(call).toMatchObject({ turnId, tool: 'task_hand_on', input: { summary: 'Fixed.' } });
    const text = 'Recorded: when your turn ends the task goes to "Code review". End your turn now.';
    w.turns.handle({ type: 'turn.tool.result', turnId, callId: newId(), ok: true, text: 'stray' });
    w.turns.handle({
      type: 'turn.tool.result',
      turnId: newId(),
      callId: call?.callId as string,
      ok: true,
      text,
    });
    w.turns.handle({ type: 'turn.tool.result', turnId, callId: call?.callId as string, ok: true, text });
    await pending;
    expect(replies).toEqual([{ ok: true, text }]);
    expect(
      w.logs.messages().filter((m) => m === 'turn.tool.result for no waiting call; dropped'),
    ).toHaveLength(2);
    w.spawn.calls[0]?.child.finish(answerLines(), 0);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
  });

  it('attaches a file of the outputs folder as parts before its call, and does not collect it again', async () => {
    const { w, cwd } = toolWorld();
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    const turnId = start(w, cwd, ['task_attach']);
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    writeFileSync(join(cwd, DIR, 'review.md'), '# Review\n\nAll good.');
    writeFileSync(join(cwd, DIR, 'later.md'), 'written after');
    const { socket, token } = socketOf(w);
    const outside = await callRunner(socket, token, {
      tool: 'task_attach',
      input: { path: '../../secret.md' },
    });
    expect(outside.ok).toBe(false);
    const pending = callRunner(socket, token, { tool: 'task_attach', input: { path: 'review.md' } });
    await vi.waitFor(() => expect(toolFrames(w)).toHaveLength(1));
    const parts = w.sent.filter((frame): frame is TurnArtifact => frame.type === 'turn.artifact');
    const [call] = toolFrames(w);
    expect(parts).toEqual([expect.objectContaining({ path: 'review.md', callId: call?.callId, index: 0 })]);
    expect(w.sent.indexOf(parts[0] as TurnArtifact)).toBeLessThan(w.sent.indexOf(call as TurnTool));
    expect(call?.input).toMatchObject({ path: 'review.md', file: { path: 'review.md', size: 19 } });
    w.turns.handle({
      type: 'turn.tool.result',
      turnId,
      callId: call?.callId as string,
      ok: true,
      text: 'Attached.',
    });
    expect(await pending).toEqual({ ok: true, text: 'Attached.' });
    w.sent.length = 0;
    w.spawn.calls[0]?.child.finish(answerLines(), 0);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const collected = w.sent.filter((frame): frame is TurnArtifact => frame.type === 'turn.artifact');
    expect(collected.map((frame) => [frame.path, frame.callId])).toEqual([['later.md', undefined]]);
  });

  it('answers a waiting call when the turn ends or its link drops, and does nothing after it ended', async () => {
    let online = true;
    const { w, cwd } = toolWorld(() => online);
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.dies = false;
    });
    start(w, cwd, ['team_board']);
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    const { socket, token } = socketOf(w);
    const dropped = callRunner(socket, token, { tool: 'team_board', input: {} });
    await vi.waitFor(() => expect(toolFrames(w)).toHaveLength(1));
    online = false;
    w.turns.linkDown();
    expect(await dropped).toEqual({ ok: false, error: TOOL_LOST });
    online = true;
    const turnId = (toolFrames(w)[0] as TurnTool).turnId;
    w.turns.handle({ type: 'turn.resume', turns: [{ turnId, lastSeq: 0 }] });
    const ended = callRunner(socket, token, { tool: 'team_board', input: {} });
    await vi.waitFor(() => expect(toolFrames(w)).toHaveLength(2));
    w.spawn.calls[0]?.child.exit(0);
    expect(await ended).toEqual({ ok: false, error: TOOL_ENDING });
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    await settle();
    expect(await callRunner(socket, token, { tool: 'team_board', input: {} })).toEqual({
      ok: false,
      error: TOOL_NOT_IN_TURN,
    });
  });
});
