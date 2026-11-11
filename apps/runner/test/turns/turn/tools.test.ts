import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnArtifact, TurnTool } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { ArtifactCollector } from '../../../src/turns/artifacts/collect.ts';
import { nodeArtifactFs } from '../../../src/turns/artifacts/fs.ts';
import type { AskReply } from '../../../src/turns/ask/tool.ts';
import {
  NO_OUTPUTS,
  TOOL_ENDING,
  TOOL_LOST,
  TOOL_NO_ANSWER,
  TOOL_OFFLINE,
  TOOL_REPLY_MS,
  TurnToolCalls,
} from '../../../src/turns/turn/tools.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { tempDir } from '../../fixtures/runner.ts';
import { FakeTime, settle } from '../../fixtures/time.ts';

const TURN = '0193f6c2-7a5e-7b3c-9d4e-1f2a3b4c5d6e';
const DIR = 'tasks/T-12/artifacts/1-develop/round-1';

/** A turn's tool calls on fake time, the frames they relayed, and switches for the link and the turn. */
function calls(options: { readonly artifacts?: ArtifactCollector } = {}) {
  const time = new FakeTime();
  const logs = memoryLog();
  const sent: (TurnTool | TurnArtifact)[] = [];
  const state = { online: true, live: true };
  const tools = new TurnToolCalls({
    turnId: TURN,
    timers: time,
    log: logs.log,
    live: () => state.live,
    artifacts: options.artifacts,
    relay: (frame) => {
      if (!state.online) return false;
      sent.push(frame);
      return true;
    },
  });
  const toolFrames = () => sent.filter((frame): frame is TurnTool => frame.type === 'turn.tool');
  return { tools, time, logs, sent, state, toolFrames };
}

/** Resolves with the call's answer, recording it as it comes. */
function track(promise: Promise<AskReply>) {
  const box: { reply?: AskReply } = {};
  void promise.then((reply) => {
    box.reply = reply;
  });
  return box;
}

describe("a turn's calls of the agents' tools", () => {
  it('sends each call with its own id and answers what the server says for that id', async () => {
    const w = calls();
    const first = track(w.tools.call('task_hand_on', { summary: 'Done.' }));
    const second = track(w.tools.call('task_read', {}));
    const [hand, read] = w.toolFrames();
    expect(hand).toEqual({
      type: 'turn.tool',
      turnId: TURN,
      callId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      tool: 'task_hand_on',
      input: { summary: 'Done.' },
    });
    expect(read?.callId).not.toBe(hand?.callId);
    expect(w.tools.waiting).toBe(2);
    const text = 'Recorded: when your turn ends the task goes to "Code review". End your turn now.';
    expect(
      w.tools.result({
        type: 'turn.tool.result',
        turnId: TURN,
        callId: read?.callId as string,
        ok: false,
        text: 'Not yours.',
      }),
    ).toBe(true);
    expect(
      w.tools.result({
        type: 'turn.tool.result',
        turnId: TURN,
        callId: hand?.callId as string,
        ok: true,
        text,
      }),
    ).toBe(true);
    await settle();
    expect(first.reply).toEqual({ ok: true, text });
    expect(second.reply).toEqual({ ok: false, error: 'Not yours.' });
    expect(
      w.tools.result({
        type: 'turn.tool.result',
        turnId: TURN,
        callId: hand?.callId as string,
        ok: true,
        text,
      }),
    ).toBe(false);
    expect(w.time.pending).toEqual([]);
    expect(w.logs.messages()).toEqual(['turn called a tool', 'turn called a tool']);
  });

  it('says the server did not answer in time after TOOL_REPLY_MS', async () => {
    const w = calls();
    const call = track(w.tools.call('team_board', {}));
    expect(w.time.pending).toEqual([TOOL_REPLY_MS]);
    await w.time.advance(TOOL_REPLY_MS);
    expect(call.reply).toEqual({ ok: false, error: TOOL_NO_ANSWER });
    expect(w.tools.waiting).toBe(0);
  });

  it('does nothing once the turn ends, while the link is down, and answers waiting calls when it closes', async () => {
    const w = calls();
    w.state.live = false;
    expect(await w.tools.call('task_read', {})).toEqual({ ok: false, error: TOOL_ENDING });
    w.state.live = true;
    w.state.online = false;
    expect(await w.tools.call('task_read', {})).toEqual({ ok: false, error: TOOL_OFFLINE });
    expect(w.tools.waiting).toBe(0);
    w.state.online = true;
    const waiting = track(w.tools.call('task_read', {}));
    w.tools.closeAll(TOOL_LOST);
    await settle();
    expect(waiting.reply).toEqual({ ok: false, error: TOOL_LOST });
    expect(w.time.pending).toEqual([]);
  });

  it('sends a file attached by its path as parts with the call’s id, then the call naming it', async () => {
    const cwd = tempDir();
    const artifacts = ArtifactCollector.open(
      nodeArtifactFs(),
      cwd,
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    writeFileSync(join(cwd, DIR, 'notes.md'), '# Review');
    const w = calls({ artifacts });
    const call = track(w.tools.call('task_attach', { path: 'notes.md', name: 'ignored' }));
    const [part, tool] = w.sent;
    expect(part).toMatchObject({ type: 'turn.artifact', index: 0, path: 'notes.md', part: 0, parts: 1 });
    expect(tool).toEqual({
      type: 'turn.tool',
      turnId: TURN,
      callId: (part as TurnArtifact).callId,
      tool: 'task_attach',
      input: {
        path: 'notes.md',
        name: 'ignored',
        file: {
          path: 'notes.md',
          contentType: 'text/markdown; charset=utf-8',
          size: 8,
          sha256: (part as TurnArtifact).sha256,
        },
      },
    });
    expect(artifacts.collect().files).toEqual([]);
    w.tools.result({
      type: 'turn.tool.result',
      turnId: TURN,
      callId: (tool as TurnTool).callId,
      ok: true,
      text: 'Attached.',
    });
    await settle();
    expect(call.reply).toEqual({ ok: true, text: 'Attached.' });
  });

  it('refuses a file it cannot attach, and any file without an outputs folder, sending nothing', async () => {
    const cwd = tempDir();
    const artifacts = ArtifactCollector.open(
      nodeArtifactFs(),
      cwd,
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    const w = calls({ artifacts });
    expect(await w.tools.call('task_attach', { path: 'missing.md' })).toEqual({
      ok: false,
      error: 'There is no file "missing.md" in your outputs folder.',
    });
    expect(await calls().tools.call('task_attach', { path: 'notes.md' })).toEqual({
      ok: false,
      error: NO_OUTPUTS,
    });
    const note = track(w.tools.call('task_attach', { name: 'Findings', text: 'All good.' }));
    expect(w.sent.map((frame) => frame.type)).toEqual(['turn.tool']);
    expect(note.reply).toBeUndefined();
  });

  it('keeps a file it could not send for the end’s collection', async () => {
    const cwd = tempDir();
    const artifacts = ArtifactCollector.open(
      nodeArtifactFs(),
      cwd,
      DIR,
      memoryLog().log,
    ) as ArtifactCollector;
    writeFileSync(join(cwd, DIR, 'notes.md'), '# Review');
    const w = calls({ artifacts });
    w.state.online = false;
    expect(await w.tools.call('task_attach', { path: 'notes.md' })).toEqual({
      ok: false,
      error: TOOL_OFFLINE,
    });
    expect(artifacts.collect().files.map((file) => file.path)).toEqual(['notes.md']);
  });
});
