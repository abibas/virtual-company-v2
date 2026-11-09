import { describe, expect, it } from 'vitest';
import {
  manualUpdate,
  portOf,
  runnerBusy,
  runnerFacts,
  updateFailed,
  updateUnsupported,
} from '../../../../src/modules/machines/rules/runner.ts';

const OLD = 'ab'.repeat(32);
const NEW = 'cd'.repeat(32);
const BUILT_AT = '2026-11-09T16:40:00.000Z';
const connected = (build: string | null, caps = { terminal: true, selfUpdate: true }) => ({
  version: '0.5.0',
  builtAt: BUILT_AT,
  build,
  caps,
});

describe("a machine's runner facts", () => {
  it('is current when its build is the served one, out of date when another', () => {
    expect(runnerFacts(connected(NEW), NEW, '0.1.0')).toEqual({
      version: '0.5.0',
      builtAt: BUILT_AT,
      build: NEW,
      current: true,
      terminal: true,
      selfUpdate: true,
    });
    expect(runnerFacts(connected(OLD, { terminal: false, selfUpdate: false }), NEW, '0.1.0')).toEqual({
      version: '0.5.0',
      builtAt: BUILT_AT,
      build: OLD,
      current: false,
      terminal: false,
      selfUpdate: false,
    });
  });

  it('does not know when either side is unknown: an old or source runner, nothing served, or offline', () => {
    expect(runnerFacts(connected(null), NEW, '0.1.0').current).toBeNull();
    expect(runnerFacts(connected(OLD), null, '0.1.0').current).toBeNull();
    expect(runnerFacts(undefined, NEW, '0.1.0')).toEqual({
      version: '0.1.0',
      builtAt: null,
      build: null,
      current: null,
      terminal: false,
      selfUpdate: false,
    });
  });
});

describe('the command that updates a runner by hand', () => {
  it("rebuilds a container's image in the repository", () => {
    expect(manualUpdate({ kind: 'container', provider: 'none' }, 'http://localhost:9950')).toEqual({
      command: 'docker compose -f deploy/compose.yml --profile runner up -d --build runner-local',
      where: 'in the repository folder: it rebuilds the container with the new runner',
    });
  });

  it("reinstalls the devbox's runner from This Mac with the install's own forward, without a token", () => {
    expect(manualUpdate({ kind: 'vm', provider: 'airia_devbox' }, 'http://localhost:9960').command).toBe(
      "airia devbox ssh -- -R 127.0.0.1:9954:127.0.0.1:9960 'curl -fsSL http://127.0.0.1:9954/api/runner/install.sh | sh -s -- --server http://127.0.0.1:9960 --via http://127.0.0.1:9954'",
    );
  });

  it('pipes install.sh from the API on This Mac and any other machine, without a token', () => {
    const mac = manualUpdate({ kind: 'laptop', provider: 'none' }, 'http://localhost:9950');
    expect(mac.command).toBe(
      'curl -fsSL http://localhost:9950/api/runner/install.sh | sh -s -- --server http://localhost:9950',
    );
    expect(mac.where).toMatch(/^in a Terminal on that machine/);
    expect(manualUpdate({ kind: 'vm', provider: 'none' }, 'https://corp.example.test').command).toContain(
      '--server https://corp.example.test',
    );
  });

  it('reads the port of an address, or its protocol', () => {
    expect([portOf('http://localhost:9950'), portOf('http://corp'), portOf('https://corp')]).toEqual([
      9950, 80, 443,
    ]);
  });
});

describe('the refusals of an update', () => {
  it('names the command and where to run it, the runner busy, and a failure cut short', () => {
    expect(updateUnsupported({ command: 'run me', where: 'on the machine' })).toEqual({
      ok: false,
      status: 409,
      code: 'update_unsupported',
      message: 'This runner cannot update itself from here. Run this on the machine.',
      command: 'run me',
    });
    expect(runnerBusy('1 live run')).toMatchObject({ status: 409, code: 'runner_busy' });
    expect(updateFailed('x'.repeat(900)).message).toHaveLength('The runner was not updated: '.length + 500);
  });
});
