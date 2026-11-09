import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTerminalSpec } from '@mwc/harness-core/fake';
import { newId } from '@mwc/shared/ids';
import type { TerminalRunnerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it, vi } from 'vitest';
import { TerminalSessions } from '../../../src/terminal/sessions.ts';
import { type HarnessCli, harnessHost } from '../../../src/turns/drivers.ts';
import { nodePrivateFs } from '../../../src/turns/files.ts';
import { memoryLog } from '../../fixtures/log.ts';
import { FakePtySpawner } from '../../fixtures/pty.ts';
import { tempDir } from '../../fixtures/runner.ts';
import { FakeTime } from '../../fixtures/time.ts';

const CODEX = '/home/u/.nvm/versions/node/v24.21.0/bin/codex';

/** Terminals whose harness host had no CLI at start and finds Codex once `gate` opens (or never). */
function world(found: HarnessCli | undefined, gate?: Promise<void>) {
  const root = tempDir();
  const cwd = join(root, 'agent');
  mkdirSync(cwd);
  const harness = harnessHost(
    {
      clis: {},
      env: {},
      fs: nodePrivateFs(),
      stateDir: join(root, 'state'),
      find: async () => {
        await gate;
        return found;
      },
    },
    memoryLog().log,
  );
  const spawner = new FakePtySpawner();
  const sent: TerminalRunnerFrame[] = [];
  const sessions = new TerminalSessions({
    host: {
      spawn: spawner.spawn,
      env: { PATH: '/usr/bin' },
      home: root,
      platform: 'linux',
      exists: () => false,
    },
    harness,
    timers: new FakeTime(),
    log: memoryLog().log,
    send: (frame) => sent.push(frame) > 0,
    buffered: () => 0,
    count: () => {},
  });
  const open = (sessionId = newId()) => {
    sessions.handle({
      type: 'terminal.open',
      sessionId,
      cols: 80,
      rows: 24,
      harness: fakeTerminalSpec('codex', { cwd }),
    });
    return sessionId;
  };
  const exits = () => sent.filter((frame) => frame.type === 'terminal.exit');
  return { sessions, spawner, sent, open, exits };
}

describe("a chat's terminal whose harness was missing at start", () => {
  it('looks for it again and opens its TUI by its full path, its folder first on the PATH', async () => {
    const w = world({ path: CODEX, version: 'codex-cli 0.200.0' });
    w.open();
    await vi.waitFor(() => expect(w.spawner.spawned).toHaveLength(1));
    const [spawned] = w.spawner.spawned;
    expect(spawned?.file).toBe(CODEX);
    expect(spawned?.options.env.PATH).toBe('/home/u/.nvm/versions/node/v24.21.0/bin:/usr/bin');
  });

  it('is unsupported when it is still not found', async () => {
    const w = world(undefined);
    const sessionId = w.open();
    await vi.waitFor(() =>
      expect(w.exits()).toEqual([{ type: 'terminal.exit', sessionId, code: null, error: 'unsupported' }]),
    );
  });

  it('does not open one closed, or ended with the others, while it searches; other frames meanwhile are ignored', async () => {
    const { promise: gate, resolve } = Promise.withResolvers<void>();
    const w = world({ path: CODEX, version: 'codex-cli 0.200.0' }, gate);
    const closed = w.open();
    w.open(closed);
    w.sessions.handle({ type: 'terminal.resize', sessionId: closed, cols: 90, rows: 30 });
    w.sessions.handle({ type: 'terminal.close', sessionId: closed });
    const lost = w.open();
    await w.sessions.closeAll('link_lost');
    await w.sessions.closeAll('runner_stopping');
    resolve();
    await vi.waitFor(() => expect(w.exits()).toHaveLength(2));
    expect(w.exits()).toEqual([
      { type: 'terminal.exit', sessionId: closed, code: null },
      { type: 'terminal.exit', sessionId: lost, code: null, error: 'link_lost' },
    ]);
    expect(w.spawner.spawned).toEqual([]);
  });
});
