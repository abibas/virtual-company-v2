import { existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it, vi } from 'vitest';
import {
  answerLines,
  codexHost,
  FAKE_COMMAND,
  startTurn as start,
  turnsWorld,
} from '../../fixtures/turns.ts';

describe("a Codex turn's private folder", () => {
  it('holds the login 0600 only while the process runs, and sends back the login it rewrote', async () => {
    const { host, cwd, stateDir } = codexHost();
    const w = turnsWorld({ host });
    let during: { mode: number; folderMode: number } | undefined;
    w.spawn.when(FAKE_COMMAND, (child) => {
      const home = w.spawn.calls[0]?.options.env?.CODEX_HOME as string;
      during = {
        mode: statSync(join(home, 'auth.json')).mode & 0o777,
        folderMode: statSync(home).mode & 0o777,
      };
      writeFileSync(join(home, 'auth.json'), '{"tokens":{"access_token":"fresh"}}');
      child.finish(answerLines(), 0);
    });
    const turnId = start(w, fakeTurnSpec('codex', { cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    const home = w.spawn.calls[0]?.options.env?.CODEX_HOME as string;
    expect(home.startsWith(join(stateDir, 'codex'))).toBe(true);
    expect(during).toEqual({ mode: 0o600, folderMode: 0o700 });
    expect(existsSync(join(home, 'auth.json'))).toBe(false);
    expect(existsSync(home)).toBe(true);
    expect(w.ends()[0]).toEqual({
      type: 'turn.end',
      turnId,
      ok: true,
      exitCode: 0,
      authJson: '{"tokens":{"access_token":"fresh"}}',
    });
    expect(JSON.stringify(w.logs.entries)).not.toContain('fresh');
  });

  it('sends nothing back when the login is the same, or rewritten into something that is not a login', async () => {
    const same = codexHost();
    const w = turnsWorld({ host: same.host });
    w.spawn.when(FAKE_COMMAND, (child) => child.finish(answerLines(), 0));
    start(w, fakeTurnSpec('codex', { cwd: same.cwd }));
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).not.toHaveProperty('authJson');
    const broken = codexHost();
    const b = turnsWorld({ host: broken.host });
    b.spawn.when(FAKE_COMMAND, (child) => {
      writeFileSync(join(b.spawn.calls[0]?.options.env?.CODEX_HOME as string, 'auth.json'), 'not json');
      child.finish(answerLines(), 0);
    });
    start(b, fakeTurnSpec('codex', { cwd: broken.cwd }));
    await vi.waitFor(() => expect(b.ends()).toHaveLength(1));
    expect(b.ends()[0]).not.toHaveProperty('authJson');
    expect(b.logs.messages('warn')).toEqual([
      'the harness rewrote its login into something that is not one; not sent back',
    ]);
  });
});
