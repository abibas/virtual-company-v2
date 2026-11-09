import { newId } from '@mwc/shared/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeFoldersFs } from '../../fixtures/folders.ts';
import { cleanUpLinks, fakeServer } from '../../fixtures/link.ts';
import { startRunner, stopRunners } from '../../fixtures/runner.ts';

afterEach(async () => {
  await stopRunners();
  await cleanUpLinks();
});

describe("the runner's folder browser on the wire", () => {
  it('says it browses folders and answers fs.list and fs.mkdir with fs.result', async () => {
    const server = await fakeServer();
    const { fs, tree } = fakeFoldersFs(['/', '/work']);
    startRunner(server, { folders: { fs, home: '/home/runner', root: '/work' } });
    expect((await server.frames.next('runner.hello')).caps.folders).toBe(true);
    await server.frames.next('runner.heartbeat');
    const made = newId();
    server.send({ type: 'fs.mkdir', cmdId: made, path: '/work/scout' });
    expect(await server.frames.next('fs.result')).toEqual({
      type: 'fs.result',
      cmdId: made,
      ok: true,
      path: '/work/scout',
    });
    const listed = newId();
    server.send({ type: 'fs.list', cmdId: listed, path: null });
    expect(await server.frames.next('fs.result')).toMatchObject({
      cmdId: listed,
      ok: true,
      path: '/work',
      entries: [{ name: 'scout', git: false, claudeMd: false }],
    });
    expect(tree.made).toEqual(['/work/scout']);
  });

  it('without a folder host says so and answers unsupported', async () => {
    const server = await fakeServer();
    startRunner(server);
    expect((await server.frames.next('runner.hello')).caps.folders).toBe(false);
    await server.frames.next('runner.heartbeat');
    const cmdId = newId();
    server.send({ type: 'fs.list', cmdId, path: '/' });
    expect(await server.frames.next('fs.result')).toEqual({
      type: 'fs.result',
      cmdId,
      ok: false,
      error: 'unsupported: this runner does not browse folders',
    });
  });
});
