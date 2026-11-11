import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it } from 'vitest';
import { nodePrivateFs } from '../../../src/turns/files.ts';
import { RUN_RETENTION_MS, RunFolder, type RunMeta } from '../../../src/turns/runs/folder.ts';
import { JournalReader } from '../../../src/turns/runs/journal.ts';
import { connectKeeper, spawnKeeper } from '../../../src/turns/runs/kept.ts';
import { findRuns } from '../../../src/turns/runs/reattach.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { tempDir } from '../../fixtures/runner.ts';
import { FakeSpawn } from '../../fixtures/spawn.ts';
import { FakeTime } from '../../fixtures/time.ts';

const metaOf = (turnId: string, cwd = '/home/agent'): RunMeta => ({
  v: 1,
  turnId,
  harness: 'claude_code',
  cwd,
  pid: 4242,
  startedAt: 1,
  stdinOpen: false,
  privateDir: null,
  artifacts: null,
  ask: null,
});

describe('a run folder', () => {
  it('is made 0700 under its root, named by its turn, and reads back its meta, exit, events and inputs', () => {
    const root = join(tempDir(), 'runs');
    const turnId = newId();
    const folder = RunFolder.create(root, turnId);
    expect(RunFolder.create(root, turnId).dir).toBe(folder.dir);
    expect(folder.meta()).toBeUndefined();
    expect(folder.exit()).toBeUndefined();
    expect(folder.changedAt()).toBe(0);
    expect([folder.events(), folder.inputs()]).toEqual([[], []]);
    folder.writeMeta(metaOf(turnId));
    expect(folder.meta()).toEqual(metaOf(turnId));
    expect(folder.changedAt()).toBeGreaterThan(0);
    folder.appendEvents([]);
    folder.appendEvents([{ s: 1, o: 10, e: { type: 'text', text: 'hi' } }]);
    appendFileSync(folder.path('events'), '{"s":2,"o":1'); // a write cut short
    expect(folder.events()).toEqual([{ s: 1, o: 10, e: { type: 'text', text: 'hi' } }]);
    folder.appendInput({ id: turnId, text: 'Use staging' });
    folder.appendInput({ end: true });
    expect(folder.inputs()).toEqual([{ id: turnId, text: 'Use staging' }, { end: true }]);
    writeFileSync(folder.path('exit'), '{"code":0,"signal":null}');
    expect(folder.exit()).toEqual({ code: 0, signal: null });
    expect(RunFolder.list(root).map((found) => found.dir)).toEqual([folder.dir]);
    folder.remove();
    folder.remove();
    expect(RunFolder.list(root)).toEqual([]);
    expect(RunFolder.list(join(root, 'none'))).toEqual([]);
  });

  it('says nothing of a meta or an exit that is not one', () => {
    const folder = RunFolder.create(join(tempDir(), 'runs'), newId());
    writeFileSync(folder.path('meta'), '{"v":2}');
    writeFileSync(folder.path('exit'), '{"code":"x"}');
    expect([folder.meta(), folder.exit()]).toEqual([undefined, undefined]);
    writeFileSync(folder.path('meta'), 'not json');
    writeFileSync(folder.path('exit'), 'not json');
    expect([folder.meta(), folder.exit()]).toEqual([undefined, undefined]);
  });
});

describe('a journal', () => {
  it('reads whole lines with the offset after each, up to a limit, and the last line without its newline', () => {
    const path = join(tempDir(), 'out');
    writeFileSync(path, 'one\r\ntwo\nthr');
    const reader = new JournalReader(path, nodePrivateFs().readAt);
    expect(reader.lines(5)).toEqual([{ line: 'one', end: 5 }]);
    expect(reader.lines()).toEqual([{ line: 'two', end: 9 }]);
    expect(reader.offset).toBe(9);
    appendFileSync(path, 'ee\n');
    expect(reader.lines()).toEqual([{ line: 'three', end: 15 }]);
    appendFileSync(path, 'four');
    expect(reader.lines()).toEqual([]);
    expect(reader.rest()).toEqual({ line: 'four', end: 19 });
    expect(reader.rest()).toBeUndefined();
    expect(new JournalReader(join(path, 'none'), nodePrivateFs().readAt).lines()).toEqual([]);
  });
});

describe('the runner’s hold on a keeper', () => {
  it('says a keeper that cannot start ended with why, and writes nothing to it then', () => {
    const spawn = new FakeSpawn();
    const run = { dir: '/runs/a', command: 'claude', args: [], cwd: '/home', env: {} };
    const kept = spawnKeeper(spawn.spawn, { command: 'node-missing', args: [] }, run);
    const gone: (string | undefined)[] = [];
    kept.gone((error) => gone.push(error));
    spawn.calls[0]?.child.fail('spawn node-missing ENOENT');
    expect(gone).toEqual(['spawn node-missing ENOENT']);
    expect([kept.alive, kept.write('x')]).toEqual([false, false]);
    kept.gone((error) => gone.push(error ?? 'already'));
    expect(gone.at(-1)).toBe('already');
  });

  it('finds no keeper where none listens, or one that does not greet with a pid', async () => {
    const time = new FakeTime();
    const dir = tempDir();
    expect(await connectKeeper(join(dir, 'k.sock'), time)).toBeUndefined();
    const { createServer } = await import('node:net');
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(join(dir, 's.sock'), resolve));
    const waiting = connectKeeper(join(dir, 's.sock'), time);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await time.advance(2_000);
    expect(await waiting).toBeUndefined();
    const liar = createServer((socket) => socket.write('{"pid":"me"}\n'));
    await new Promise<void>((resolve) => liar.listen(join(dir, 'l.sock'), resolve));
    expect(await connectKeeper(join(dir, 'l.sock'), time)).toBeUndefined();
    silent.close();
    liar.close();
  });
});

describe('the run folders found at start', () => {
  it('drop a folder without its meta and an ended turn kept past its retention, and keep the rest', async () => {
    const root = join(tempDir(), 'runs');
    mkdirSync(root, { recursive: true });
    const broken = RunFolder.create(root, newId());
    const old = RunFolder.create(root, newId());
    old.writeMeta(metaOf(newId()));
    writeFileSync(old.path('exit'), '{"code":0,"signal":null}');
    const past = (Date.now() - RUN_RETENTION_MS - 60_000) / 1000;
    utimesSync(old.path('exit'), past, past);
    const recent = RunFolder.create(root, newId());
    const recentId = newId();
    recent.writeMeta(metaOf(recentId));
    const logs = memoryLog();
    const found = await findRuns(root, { timers: new FakeTime(), now: Date.now(), log: logs.log });
    expect(found.map((run) => [run.meta.turnId, run.kept])).toEqual([[recentId, undefined]]);
    expect(RunFolder.list(root).map((folder) => folder.dir)).toEqual([recent.dir]);
    expect(logs.messages()).toEqual(
      expect.arrayContaining([
        'a run folder without its meta; removed',
        'an ended turn kept past its retention; removed',
      ]),
    );
    expect(broken.meta()).toBeUndefined();
  });
});
