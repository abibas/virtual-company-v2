import { ClaudeCodeDriver } from '@mwc/harness-claude-code';
import { CLAUDE_SESSION_ID } from '@mwc/harness-claude-code/fixtures';
import { fakeInputLine, fakeLines, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it, vi } from 'vitest';
import { settle } from '../../fixtures/time.ts';
import { FAKE_COMMAND, fakeHarnessHost, turnsWorld } from '../../fixtures/turns.ts';

const INPUT_ID = '0a8d6c3e-5f1b-4c2a-9e7d-3b6f1a2c4d5e';

/** Starts a turn on the world's host and waits for its process. */
async function started(w: ReturnType<typeof turnsWorld>, cwd: string) {
  const turnId = newId();
  w.turns.handle({
    type: 'turn.start',
    turnId,
    spec: fakeTurnSpec('claude_code', { cwd, prompt: 'Deploy it' }),
  });
  await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
  return { turnId, child: (w.spawn.calls[0] as (typeof w.spawn.calls)[number]).child };
}

describe('a turn that takes messages while it runs', () => {
  it('keeps stdin open after the prompt, writes turn.input, sends its echo, and closes stdin after the result', async () => {
    const { host, cwd } = fakeHarnessHost({ driver: { liveInput: true } });
    const w = turnsWorld({ host });
    const { turnId, child } = await started(w, cwd);
    await settle();
    expect([child.input, child.inputClosed]).toEqual(['Deploy it', false]);
    w.turns.handle({ type: 'turn.input', turnId, inputId: INPUT_ID, text: 'Use staging' });
    await settle();
    expect(child.input).toBe(`Deploy it${fakeInputLine('Use staging', INPUT_ID)}`);
    const lines = fakeLines([
      { type: 'text', text: 'Deploying.' },
      { type: 'input', text: 'echoed', inputId: INPUT_ID },
      { type: 'text', text: 'On staging.' },
      { type: 'result', ok: true, text: 'On staging.' },
    ]);
    child.stdout?.write(`${lines.join('\n')}\n`);
    await vi.waitFor(() => expect(child.inputClosed).toBe(true));
    child.exit(0);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.events().map((item) => item.event)).toEqual([
      { type: 'text', text: 'Deploying.' },
      { type: 'input', text: 'Use staging', inputId: INPUT_ID },
      { type: 'text', text: 'On staging.' },
      { type: 'result', ok: true, text: 'On staging.' },
    ]);
    expect(w.ends()[0]).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('drops a message for no live turn, for a harness that takes none, and once it is stopping', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    w.turns.handle({ type: 'turn.input', turnId: newId(), inputId: INPUT_ID, text: 'x' });
    const { turnId, child } = await started(w, cwd);
    w.turns.handle({ type: 'turn.input', turnId, inputId: INPUT_ID, text: 'x' });
    expect(w.logs.messages()).toEqual(
      expect.arrayContaining(['turn.input for no live turn; dropped', 'turn.input not taken; dropped']),
    );
    await settle();
    expect(child.input).toBe('Deploy it');
    w.turns.handle({ type: 'turn.stop', turnId });
    w.turns.handle({ type: 'turn.input', turnId, inputId: INPUT_ID, text: 'x' });
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.logs.messages().filter((m) => m === 'turn.input not taken; dropped')).toHaveLength(2);
  });

  it('plays Claude Code’s echo of a message through the real driver and parser', async () => {
    const { host, cwd } = fakeHarnessHost({
      drivers: { claude_code: new ClaudeCodeDriver({ command: FAKE_COMMAND }) },
    });
    const w = turnsWorld({ host });
    const { turnId, child } = await started(w, cwd);
    w.turns.handle({ type: 'turn.input', turnId, inputId: INPUT_ID, text: 'Use staging' });
    await settle();
    const [prompt, message] = child.input
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(prompt.message.content[0].text).toBe('Deploy it');
    expect(message).toMatchObject({ uuid: INPUT_ID, message: { content: [{ text: 'Use staging' }] } });
    const output = [
      { type: 'system', subtype: 'init', session_id: CLAUDE_SESSION_ID, model: 'claude-opus-5-5' },
      { type: 'user', isReplay: true, uuid: prompt.uuid, message: prompt.message },
      { type: 'user', isReplay: true, uuid: INPUT_ID, message: message.message },
      { type: 'result', subtype: 'success', is_error: false, result: 'On staging.' },
    ];
    child.stdout?.write(`${output.map((line) => JSON.stringify(line)).join('\n')}\n`);
    await vi.waitFor(() => expect(child.inputClosed).toBe(true));
    child.exit(0);
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.events().map((item) => item.event.type)).toEqual(['session', 'init', 'input', 'result']);
    expect(w.events()[2]?.event).toEqual({ type: 'input', text: 'Use staging', inputId: INPUT_ID });
  });
});
