import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../fixtures/chats/world.ts';
import { artifactsOf, type RunScene, utf8 } from '../../../fixtures/runs.ts';
import { makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';
import { attachFile, toolCall, toolScene } from '../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

async function atDevelop(s: RunScene) {
  const task = await makeTask(w, s.c, s.c.owner, {
    flowId: s.flow.id,
    stepId: stepOf(s.flow, 'Develop').id,
    description: 'The login form accepts an empty password.',
  });
  return { task, start: await s.runner.frames.next('turn.start') };
}

describe('task_read', () => {
  it('gives the task as the step sees it, then where it is and the move recorded so far', async () => {
    const s = await toolScene(w);
    const { start } = await atDevelop(s);
    const read = await toolCall(s.runner, start.turnId, 'task_read');
    expect(read.ok).toBe(true);
    expect(read.text).toMatch(/^# T-1 · Fix the login\n\nYou are working on task T-1 at step 1, "Develop"/);
    expect(read.text).toContain('The login form accepts an empty password.');
    expect(read.text).toContain('Flow: DEVBOX delivery · Lead: DEVBOX Coordinator');
    expect(read.text).toContain('call task_hand_on');
    expect(read.text).toContain(
      '## Now\n\nT-1 is active at "Develop" (working), round 1.\nNo move recorded in this turn yet.',
    );
    await toolCall(s.runner, start.turnId, 'task_hand_on', { summary: 'Done.' });
    const again = await toolCall(s.runner, start.turnId, 'task_read');
    expect(again.text).toContain('Recorded in this turn: Developer will hand on to "Code review".');
  });
});

describe('task_attach', () => {
  it('keeps a note, a link and a file of the outputs folder with the task now, in the step’s round', async () => {
    const s = await toolScene(w);
    const { task, start } = await atDevelop(s);
    expect(
      await toolCall(s.runner, start.turnId, 'task_attach', { name: 'Plan', text: '1. Check the form.' }),
    ).toEqual(
      expect.objectContaining({ ok: true, text: 'Attached "Plan" to T-1 (Develop, round 1) as a note.' }),
    );
    expect(
      await toolCall(s.runner, start.turnId, 'task_attach', {
        name: 'PR',
        url: 'https://github.test/acme/pull/7',
      }),
    ).toMatchObject({ ok: true, text: 'Attached "PR" to T-1 (Develop, round 1) as a link.' });
    expect(await attachFile(s.runner, start.turnId, 'logs/test.log', utf8('3 passed'))).toMatchObject({
      ok: true,
      text: 'Attached "logs/test.log" to T-1 (Develop, round 1) as a file.',
    });
    const rows = await artifactsOf(w.t.db, task.id);
    expect(rows.map((row) => [row.name, row.kind, row.round, row.note, row.size, row.createdBy])).toEqual([
      ['Plan', 'note', 1, null, 18, s.c.developer],
      ['PR', 'link', 1, 'https://github.test/acme/pull/7', 0, s.c.developer],
      ['logs/test.log', 'file', 1, null, 8, s.c.developer],
    ]);
    expect(rows[0]).toMatchObject({ contentType: 'text/markdown; charset=utf-8', turnId: start.turnId });
    expect(rows[2]).toMatchObject({ contentType: 'text/plain; charset=utf-8' });
  });

  it('refuses what it cannot keep: a bad input, a file that did not arrive, a task that moved on', async () => {
    const s = await toolScene(w);
    const { task, start } = await atDevelop(s);
    const refused = (input: Record<string, unknown>) =>
      toolCall(s.runner, start.turnId, 'task_attach', input);
    expect((await refused({ name: 'Two', text: 'a', url: 'https://x.test' })).text).toContain(
      'give exactly one of text, path or url',
    );
    expect((await refused({ text: 'a' })).text).toContain('name: a note or a link needs a name');
    expect((await refused({ name: 'hand-off note', text: 'a' })).text).toContain(
      '"hand-off note" is the step\'s own',
    );
    expect((await refused({ path: '../secrets.txt' })).text).toContain('path:');
    expect((await refused({ name: 'x', url: 'file:///etc/passwd' })).ok).toBe(false);
    expect(await refused({ path: 'notes.md' })).toMatchObject({
      ok: false,
      text: 'The file notes.md did not arrive from the runner: nothing was attached.',
    });
    expect(
      await attachFile(s.runner, start.turnId, 'bad.md', utf8('x'), { sha256: 'a'.repeat(64) }),
    ).toMatchObject({
      ok: false,
      text: 'The file bad.md did not arrive from the runner: nothing was attached.',
    });
    await moved(w, s.c, s.c.manager, task.key, { action: 'hand_on', force: true });
    expect(await refused({ name: 'Late', text: 'x' })).toMatchObject({
      ok: false,
      text: 'The task is no longer at your step: nothing was attached.',
    });
    expect(await artifactsOf(w.t.db, task.id)).toEqual([]);
  });
});
