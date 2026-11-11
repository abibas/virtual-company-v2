import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatPath, chatsWorld, ended } from '../../../fixtures/chats/world.ts';
import { as } from '../../../fixtures/members/members.ts';
import {
  artifactsOf,
  conversationsOf,
  endTurn,
  fileFrames,
  finish,
  runScene,
  stepStateIs,
  taskRow,
  utf8,
} from '../../../fixtures/runs.ts';
import { flowsPath, makeTask, moved, stepOf } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A scene with a task at Develop and its first turn started. */
async function atDevelop() {
  const s = await runScene(w);
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const start = await s.runner.frames.next('turn.start');
  return { ...s, task, start };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('the files a step’s turn leaves', () => {
  it('keeps each collected file with the step and round, typed from its bytes, and what was left out', async () => {
    const s = await atDevelop();
    const big = new Uint8Array(200 * 1024).fill(0x61);
    for (const frame of [
      ...fileFrames(s.start.turnId, 0, 'notes.md', utf8('# Notes')),
      ...fileFrames(s.start.turnId, 1, 'shots/login.png', PNG, { contentType: 'text/plain' }),
      ...fileFrames(s.start.turnId, 2, 'big.log', big),
    ])
      s.runner.send(frame);
    s.runner.send({
      type: 'turn.artifacts',
      turnId: s.start.turnId,
      files: 3,
      skipped: [
        { path: 'build.zip', size: 4096, reason: 'binary' },
        { path: 'huge.log', size: 5 * 1024 * 1024, reason: 'too_large' },
      ],
    });
    finish(s.runner, s.start, 'Done.');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    const rows = await artifactsOf(w.t.db, s.task.id);
    expect(rows.map((a) => [a.name, a.kind, a.contentType, a.size, a.round, a.stepName, a.note])).toEqual([
      ['notes.md', 'file', 'text/markdown; charset=utf-8', 7, 1, 'Develop', null],
      ['shots/login.png', 'file', 'image/png', 12, 1, 'Develop', null],
      ['big.log', 'file', 'text/plain; charset=utf-8', 200 * 1024, 1, 'Develop', null],
      ['build.zip', 'skipped', null, 4096, 1, 'Develop', 'Not collected: neither text nor an image'],
      [
        'huge.log',
        'skipped',
        null,
        5 * 1024 * 1024,
        1,
        'Develop',
        'Not collected: over the 2.0 MB a file may be',
      ],
      ['hand-off note', 'note', 'text/markdown; charset=utf-8', 5, 1, 'Develop', null],
    ]);
    expect(
      rows.every((a) => a.chatId !== null && a.turnId === s.start.turnId && a.createdBy === s.c.developer),
    ).toBe(true);
    expect(new TextDecoder().decode(rows[2]?.bytes as Uint8Array)).toBe('a'.repeat(200 * 1024));
  });

  it('drops a file whose bytes do not match its hash, a binary one, and one whose parts disagree', async () => {
    const s = await atDevelop();
    const id = s.start.turnId;
    for (const frame of [
      ...fileFrames(id, 0, 'lie.md', utf8('true'), { sha256: 'f'.repeat(64) }),
      ...fileFrames(id, 1, 'blob.bin', new Uint8Array([0x00, 0xff, 0x00])),
      { ...fileFrames(id, 2, 'short.md', utf8('abc'))[0], size: 4 },
      ...fileFrames(id, 3, 'kept.md', utf8('kept')),
    ])
      s.runner.send(frame as never);
    finish(s.runner, s.start, 'Done.');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    expect((await artifactsOf(w.t.db, s.task.id)).map((a) => a.name)).toEqual(['kept.md', 'hand-off note']);
    expect(
      w.logs.filter((line) => line.msg === 'a collected file was dropped').map((line) => line.why),
    ).toEqual(['hash_mismatch', 'binary', 'mismatch']);
  });

  it('replaces a file collected again in the same round, and keeps a new round apart', async () => {
    const s = await atDevelop();
    for (const frame of fileFrames(s.start.turnId, 0, 'notes.md', utf8('one'))) s.runner.send(frame);
    finish(s.runner, s.start, 'First.');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    await moved(w, s.c, s.c.manager, s.task.key, { action: 'start' });
    const again = await s.runner.frames.next('turn.start');
    for (const frame of fileFrames(again.turnId, 0, 'notes.md', utf8('two!'))) s.runner.send(frame);
    finish(s.runner, again, 'Second.');
    await ended(w.t.db, again.turnId);
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    const rows = await artifactsOf(w.t.db, s.task.id);
    expect(rows.map((a) => [a.name, a.size, a.turnId])).toEqual([
      ['notes.md', 4, again.turnId],
      ['hand-off note', 7, again.turnId],
    ]);
  });

  it('copes with a runner older than artifacts: no frames, only the hand-off note; none for an empty reply', async () => {
    const s = await atDevelop();
    finish(s.runner, s.start, 'Only words.');
    await stepStateIs(w.t.db, s.task.id, 'ended_without_handoff');
    expect((await artifactsOf(w.t.db, s.task.id)).map((a) => a.name)).toEqual(['hand-off note']);
    await moved(w, s.c, s.c.manager, s.task.key, { action: 'start' });
    const silent = await s.runner.frames.next('turn.start');
    endTurn(s.runner, silent.turnId);
    await ended(w.t.db, silent.turnId);
    expect((await artifactsOf(w.t.db, s.task.id)).length).toBe(1);
  });

  it('keeps a placeholder name for a step removed since; a reply in its conversation gets no outputs folder', async () => {
    const s = await atDevelop();
    await moved(w, s.c, s.c.manager, s.task.key, { action: 'hand_on', force: true });
    await s.runner.frames.next('turn.start');
    const steps = s.flow.steps
      .filter((step) => step.name !== 'Develop')
      .map((step) => ({
        id: step.id,
        name: step.name,
        kind: step.kind,
        assigneePrincipalId: step.assignee.principalId,
      }));
    expect((await as(w, s.c.owner)('PUT', flowsPath(s.c, `/${s.flow.id}/steps`), { steps })).status).toBe(
      200,
    );
    s.runner.send({ type: 'turn.artifacts', turnId: s.start.turnId, files: 0, skipped: [] });
    finish(s.runner, s.start, 'Late reply.');
    await ended(w.t.db, s.start.turnId);
    await expect
      .poll(async () => (await artifactsOf(w.t.db, s.task.id)).map((a) => [a.stepName, a.name]))
      .toEqual([['a removed step', 'hand-off note']]);
    const develop = (await conversationsOf(w.t.db, s.task.id))[0];
    await as(w, s.c.owner)('POST', chatPath(s.c, develop?.id as string, '/turns'), { prompt: 'More?' });
    const reply = await s.runner.frames.next('turn.start');
    expect(reply.spec.artifacts).toBeUndefined();
    finish(s.runner, reply, 'Nothing more.');
    await ended(w.t.db, reply.turnId);
    expect((await taskRow(w.t.db, s.task.id)).stepState).toBe('working');
  });
});
