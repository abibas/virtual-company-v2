import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fakeTurnSpec } from '@mwc/harness-core/fake';
import type { Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it, vi } from 'vitest';
import { type FindHarness, type HarnessCli, harnessHost } from '../../src/turns/drivers.ts';
import { nodePrivateFs } from '../../src/turns/files.ts';
import { memoryLog } from '../fixtures/log.ts';
import { tempDir } from '../fixtures/runner.ts';
import { answerLines, turnsWorld } from '../fixtures/turns.ts';

const CLAUDE = '/home/u/.local/bin/claude';
const FOUND: HarnessCli = { path: CLAUDE, version: '2.1.400 (Claude Code)' };

/** The real harness host with no CLI at start and a `find` that answers what `found` holds, counting its calls. */
function missingAtStart(found: () => HarnessCli | undefined, gate?: Promise<void>) {
  const root = tempDir();
  const cwd = join(root, 'agent');
  mkdirSync(cwd);
  const logs = memoryLog();
  const searched: Harness[] = [];
  const find: FindHarness = async (harness) => {
    searched.push(harness);
    await gate;
    return found();
  };
  const host = harnessHost(
    { clis: {}, env: { PATH: '/usr/bin' }, fs: nodePrivateFs(), stateDir: join(root, 'state'), find },
    logs.log,
  );
  return { host, cwd, logs, searched };
}

describe('a harness missing when the runner started', () => {
  it('is looked for again on a turn: found now, the turn runs it by its full path, its folder first on the PATH', async () => {
    const { host, cwd, logs, searched } = missingAtStart(() => FOUND);
    expect(host.versions).toEqual({ claude_code: null, codex: null });
    const w = turnsWorld({ host });
    w.spawn.when(CLAUDE, (child) => child.finish(answerLines('4'), 0));
    const turnId = newId();
    w.turns.handle({ type: 'turn.start', turnId, spec: fakeTurnSpec('claude_code', { cwd }) });
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ turnId, ok: true });
    expect(w.spawn.calls[0]?.options.env?.PATH).toBe('/home/u/.local/bin:/usr/bin');
    expect(host.versions).toEqual({ claude_code: '2.1.400 (Claude Code)', codex: null });
    expect(logs.messages()).toContain('harness found');
    // Found once, it is not looked for again.
    expect(await host.findAgain?.('claude_code')).toBe(true);
    expect(searched).toEqual(['claude_code']);
  });

  it('is still unsupported when it is not found now', async () => {
    const { host, cwd, searched } = missingAtStart(() => undefined);
    const w = turnsWorld({ host });
    w.turns.handle({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('codex', { cwd }) });
    await vi.waitFor(() => expect(w.ends()).toHaveLength(1));
    expect(w.ends()[0]).toMatchObject({ ok: false, error: 'unsupported' });
    expect(searched).toEqual(['codex']);
    expect(w.spawn.calls).toEqual([]);
  });

  it('shares one search between turns; a turn stopped, or every turn ended, while it searches is not started', async () => {
    const { promise: gate, resolve } = Promise.withResolvers<void>();
    const { host, cwd, searched } = missingAtStart(() => FOUND, gate);
    const w = turnsWorld({ host, slots: 4 });
    const [stopped, lost, again] = [newId(), newId(), newId()];
    const spec = fakeTurnSpec('claude_code', { cwd });
    w.turns.handle({ type: 'turn.start', turnId: stopped, spec });
    w.turns.handle({ type: 'turn.start', turnId: stopped, spec });
    w.turns.handle({ type: 'turn.stop', turnId: stopped });
    w.turns.handle({ type: 'turn.start', turnId: lost, spec });
    await w.turns.stopAll('link_lost');
    w.turns.handle({ type: 'turn.start', turnId: again, spec });
    await w.turns.stop();
    resolve();
    await vi.waitFor(() => expect(w.ends()).toHaveLength(3));
    expect(w.ends().map((end) => [end.turnId, end.error])).toEqual([
      [stopped, 'stopped'],
      [lost, 'link_lost'],
      [again, 'runner_stopping'],
    ]);
    expect(searched).toEqual(['claude_code']);
    expect(w.spawn.calls).toEqual([]);
  });

  it('is not looked for without a way to find it, or once the runner stops', async () => {
    const root = tempDir();
    const host = harnessHost(
      { clis: {}, env: {}, fs: nodePrivateFs(), stateDir: join(root, 'state') },
      memoryLog().log,
    );
    expect(host.findAgain).toBeUndefined();
    const { host: finding, cwd, searched } = missingAtStart(() => FOUND);
    const w = turnsWorld({ host: finding });
    await w.turns.stop();
    w.turns.handle({ type: 'turn.start', turnId: newId(), spec: fakeTurnSpec('claude_code', { cwd }) });
    expect(w.ends()[0]).toMatchObject({ error: 'runner_stopping' });
    expect(searched).toEqual([]);
  });
});
