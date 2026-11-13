import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FAKE_SESSION_MISSING, fakeTurnSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it, vi } from 'vitest';
import { RunFolder } from '../../../src/turns/runs/folder.ts';
import { missingSession } from '../../../src/turns/turn/end.ts';
import { FAKE_COMMAND, fakeHarnessHost, startTurn, turnsWorld } from '../../fixtures/turns.ts';

/** A lost conversation (docs/harness.md "A lost conversation"): the runner ends the turn `session_missing`. */
describe('a turn whose resumed conversation is not on the machine', () => {
  const resumed = (cwd: string) => fakeTurnSpec('claude_code', { cwd, sessionId: 'bbd9c214' });

  it('ends session_missing with the harness’s own line, and sends no failing result', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.printErr(`starting\n${FAKE_SESSION_MISSING}: bbd9c214\n`);
      child.finish('', 1);
    });
    startTurn(w, resumed(cwd));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({
      ok: false,
      exitCode: 1,
      error: `session_missing: ${FAKE_SESSION_MISSING}: bbd9c214`,
    });
    expect(w.events().filter((item) => item.event.type === 'result')).toEqual([]);
  });

  it('is any other failure without those words: the failing result and no error code, as before', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => {
      child.printErr('API Error: 500\n');
      child.finish('', 1);
    });
    startTurn(w, resumed(cwd));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ ok: false, exitCode: 1 });
    expect(w.ends()[0]).not.toHaveProperty('error');
    expect(w.events().map((item) => item.event)).toEqual([
      expect.objectContaining({ type: 'result', ok: false }),
    ]);
  });
});

describe('missingSession', () => {
  const folder = { path: () => '/nowhere/err' };
  const parts = (words?: string) => ({
    folder: folder as unknown as RunFolder,
    sessionMissing: (output: string) => (output.includes('gone') ? (words ?? 'gone') : undefined),
  });
  const readAt = () => ({ size: 0, data: new Uint8Array() });
  const failed = { type: 'result', ok: false, error: 'conversation gone' } as const;

  it('reads a failing result’s words too, and only after a failed exit of a process that started', () => {
    const exit = { code: 1, signal: null };
    expect(missingSession(parts(), readAt, { exit, spawnError: undefined, result: failed })).toBe('gone');
    expect(
      missingSession(parts(), readAt, { exit, spawnError: undefined, result: undefined }),
    ).toBeUndefined();
    const ok = { type: 'result', ok: true } as const;
    expect(missingSession(parts(), readAt, { exit, spawnError: undefined, result: ok })).toBeUndefined();
    const clean = { code: 0, signal: null };
    expect(
      missingSession(parts(), readAt, { exit: clean, spawnError: undefined, result: failed }),
    ).toBeUndefined();
    expect(missingSession(parts(), readAt, { exit, spawnError: 'ENOENT', result: failed })).toBeUndefined();
    expect(
      missingSession(parts(), readAt, { exit: undefined, spawnError: undefined, result: failed }),
    ).toBeUndefined();
    const keeperFailed = { code: 1, signal: null, error: 'spawn ENOENT' };
    expect(
      missingSession(parts(), readAt, { exit: keeperFailed, spawnError: undefined, result: failed }),
    ).toBeUndefined();
    expect(
      missingSession({ folder: parts().folder, sessionMissing: undefined }, readAt, {
        exit,
        spawnError: undefined,
        result: failed,
      }),
    ).toBeUndefined();
  });
});

describe('a turn started after the server’s events (afterSeq)', () => {
  it('numbers its events after them, and a runner that takes it back goes on from there', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    const turnId = newId();
    w.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }), afterSeq: 5 });
    await vi.waitFor(() => expect(w.spawn.calls).toHaveLength(1));
    const [name] = readdirSync(host.runs);
    expect(new RunFolder(join(host.runs, name as string)).meta()?.afterSeq).toBe(5);
    await w.turns.stop();
    // The next runner finds no keeper: the turn is lost, and its failing result is numbered after 5.
    const next = turnsWorld({ host });
    await next.turns.reattach();
    expect(next.turns.held()).toEqual([{ turnId, lastSeq: 6, ended: true }]);
  });

  it('numbers from 1 without it', async () => {
    const { host, cwd } = fakeHarnessHost();
    const w = turnsWorld({ host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish('', 1));
    startTurn(w, fakeTurnSpec('claude_code', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.events().map((item) => item.seq)).toEqual([1]);
    const [name] = readdirSync(host.runs);
    expect(new RunFolder(join(host.runs, name as string)).meta()).not.toHaveProperty('afterSeq');
  });
});
