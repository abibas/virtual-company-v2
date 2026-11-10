import { fixedClock } from '@mwc/testkit';
import { describe, expect, it } from 'vitest';
import {
  INSTALL_KEPT_MS,
  INSTALLS_KEPT,
  toolInstalls,
} from '../../../../../src/modules/machines/service/tools/installs.ts';

const fields = (machineId: string) => ({
  companyId: 'c1',
  machineId,
  tool: 'codex' as const,
  version: '0.163.0',
  principalId: 'p1',
});
const DONE = { ok: true, tools: null, error: null };

describe("an app's installs", () => {
  it('reads one of its machine only, and keeps its output', () => {
    const clock = fixedClock();
    const installs = toolInstalls(clock);
    const install = installs.start(fields('m1'));
    installs.output(install, 'added 1 package');
    expect(install.lines).toEqual(['added 1 package']);
    expect(installs.get('c1', 'm1', install.id)).toBe(install);
    expect(installs.get('c1', 'm2', install.id)).toBeUndefined();
    expect(installs.get('c2', 'm1', install.id)).toBeUndefined();
    installs.finish(install, { ok: false, tools: null, error: 'failed: npm exited with code 1' });
    expect(install).toMatchObject({ status: 'failed', error: 'failed: npm exited with code 1' });
  });

  it('forgets ended installs after an hour, and keeps the newest ones only; never a running one', () => {
    const clock = fixedClock();
    const installs = toolInstalls(clock);
    const running = installs.start(fields('m0'));
    const old = installs.start(fields('m1'));
    installs.finish(old, DONE);
    clock.advance(INSTALL_KEPT_MS + 1);
    expect(installs.get('c1', 'm1', old.id)).toBeUndefined();
    const ended = Array.from({ length: INSTALLS_KEPT + 1 }, (_, i) => {
      const install = installs.start(fields(`m${i + 2}`));
      installs.finish(install, DONE);
      return install;
    });
    installs.start(fields('another'));
    expect(installs.get('c1', 'm2', ended[0]?.id as string)).toBeUndefined();
    expect(installs.get('c1', 'm3', ended[1]?.id as string)).toBeDefined();
    expect(installs.get('c1', 'm0', running.id)).toBe(running);
  });
});
