import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ArtifactView } from '../../../../src/modules/tasks/schemas/artifacts.ts';
import type { BoardView } from '../../../../src/modules/tasks/schemas/board.ts';
import { type ChatsWorld, chatsWorld } from '../../../fixtures/chats/world.ts';
import { as, membersCompany } from '../../../fixtures/members/members.ts';
import { fileFrames, finish, runScene, stepStateIs, utf8 } from '../../../fixtures/runs.ts';
import { flowsPath, makeTask, stepOf, tasksPath } from '../../../fixtures/tasks.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** A task whose Develop turn left a file, a skipped file and its note. */
async function withArtifacts() {
  const s = await runScene(w);
  const task = await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
  const start = await s.runner.frames.next('turn.start');
  for (const frame of fileFrames(start.turnId, 0, 'notes/Über plan.md', utf8('# Plan'))) s.runner.send(frame);
  s.runner.send({
    type: 'turn.artifacts',
    turnId: start.turnId,
    files: 1,
    skipped: [{ path: 'a.zip', size: 9, reason: 'binary' }],
  });
  finish(s.runner, start, 'Planned.');
  await stepStateIs(w.t.db, task.id, 'ended_without_handoff');
  return { ...s, task };
}

describe('GET …/tasks/:taskId/artifacts', () => {
  it('lists them oldest first, without bytes, for viewers too, by key or id', async () => {
    const s = await withArtifacts();
    const res = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${s.task.key}/artifacts`));
    expect(res.status).toBe(200);
    const { artifacts } = res.body as { artifacts: ArtifactView[] };
    expect(artifacts.map((a) => [a.name, a.kind, a.size, a.note])).toEqual([
      ['notes/Über plan.md', 'file', 6, null],
      ['a.zip', 'skipped', 9, 'Not collected: neither text nor an image'],
      ['hand-off note', 'note', 8, null],
    ]);
    expect(artifacts[0]).toMatchObject({
      step: { id: stepOf(s.flow, 'Develop').id, name: 'Develop' },
      round: 1,
      contentType: 'text/markdown; charset=utf-8',
      createdBy: { name: 'Developer', kind: 'agent' },
    });
    expect(JSON.stringify(artifacts)).not.toContain('bytes');
    const byId = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${s.task.id}/artifacts`));
    expect((byId.body as { artifacts: unknown[] }).artifacts).toHaveLength(3);
    const detail = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${s.task.key}`));
    expect(detail.body).toMatchObject({ artifacts: 2 });
  });

  it('downloads one as an attachment with its type and hash; a skipped file has no bytes', async () => {
    const s = await withArtifacts();
    const list = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${s.task.key}/artifacts`));
    const [file, skipped, note] = (list.body as { artifacts: ArtifactView[] }).artifacts;
    const res = await w.t.app.request(tasksPath(s.c, `/${s.task.key}/artifacts/${file?.id}/content`), {
      headers: { authorization: `Bearer fake:${s.c.viewer.subject}` },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# Plan');
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="_ber plan.md"; filename*=UTF-8''%C3%9Cber%20plan.md`,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('etag')).toBe(`"${file?.sha256}"`);
    const handoff = await w.t.app.request(tasksPath(s.c, `/${s.task.key}/artifacts/${note?.id}/content`), {
      headers: { authorization: `Bearer fake:${s.c.viewer.subject}` },
    });
    expect(handoff.headers.get('content-disposition')).toContain('filename="hand-off-note.md"');
    const none = await as(w, s.c.viewer)(
      'GET',
      tasksPath(s.c, `/${s.task.key}/artifacts/${skipped?.id}/content`),
    );
    expect(none).toMatchObject({ status: 404, body: { error: { code: 'artifact_not_found' } } });
    const malformed = await as(w, s.c.viewer)('GET', tasksPath(s.c, `/${s.task.key}/artifacts/nope/content`));
    expect(malformed).toMatchObject({ status: 404, body: { error: { code: 'artifact_not_found' } } });
  });

  it('is the same 404 for another company’s task as for none, and refuses outsiders', async () => {
    const s = await withArtifacts();
    const other = await membersCompany(w);
    const theirs = await as(w, other.owner)('GET', tasksPath(other, `/${s.task.id}/artifacts`));
    expect(theirs).toMatchObject({ status: 404, body: { error: { code: 'task_not_found' } } });
    const list = await as(w, s.c.owner)('GET', tasksPath(s.c, `/${s.task.key}/artifacts`));
    const [file] = (list.body as { artifacts: ArtifactView[] }).artifacts;
    const download = await as(w, other.owner)(
      'GET',
      tasksPath(other, `/${s.task.id}/artifacts/${file?.id}/content`),
    );
    expect(download).toMatchObject({ status: 404, body: { error: { code: 'task_not_found' } } });
    const outsider = await as(w, other.owner)('GET', tasksPath(s.c, `/${s.task.key}/artifacts`));
    expect(outsider).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    expect((await as(w, s.c.owner)('GET', tasksPath(s.c, '/T-99/artifacts'))).status).toBe(404);
    expect((await as(w, s.c.owner)('GET', tasksPath(s.c, '/nope/artifacts'))).body).toMatchObject({
      error: { code: 'task_not_found' },
    });
    const malformed = await as(w, s.c.owner)('GET', tasksPath(s.c, `/nope/artifacts/${file?.id}/content`));
    expect(malformed.body).toMatchObject({ error: { code: 'task_not_found' } });
  });

  it('counts them on the board’s cards, skipped files left out', async () => {
    const s = await withArtifacts();
    const board = await as(w, s.c.viewer)('GET', flowsPath(s.c, `/${s.flow.id}/board`));
    const develop = (board.body as BoardView).columns.find((column) => column.title === 'Develop');
    expect(develop?.cards).toEqual([expect.objectContaining({ key: s.task.key, artifacts: 2 })]);
  });
});
