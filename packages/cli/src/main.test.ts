import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { slotFromPath } from '@mwc/shared/ports';
import { describe, expect, it } from 'vitest';
import {
  type CheckStep,
  checkSteps,
  type MainIo,
  main,
  runCheck,
  spawnStep,
  workspacePackages,
} from './main.ts';

function capture(extra: Partial<Pick<MainIo, 'cwd' | 'env'>> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: MainIo = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cwd: extra.cwd ?? '/repo',
    ...(extra.env ? { env: extra.env } : {}),
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

describe('main', () => {
  it('runs dev through its dependency and returns its exit code', async () => {
    const seen: string[][] = [];
    const code = await main(['dev', '--down'], capture().io, {
      dev: async (flags) => {
        seen.push([...flags]);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(seen).toEqual([['down']]);
  });

  it('prints help for no command and for help', () => {
    for (const argv of [[], ['help']]) {
      const c = capture();
      expect(main(argv, c.io)).toBe(0);
      expect(c.out()).toContain('mwc commands:');
      expect(c.err()).toBe('');
    }
  });

  it('returns 2 for an unknown command and names it on stderr', () => {
    const c = capture();
    expect(main(['deploy'], c.io)).toBe(2);
    expect(c.err()).toMatch(/^unknown command: deploy\n/);
    expect(c.out()).toBe('');
  });

  it('prints the port map', () => {
    const c = capture();
    expect(main(['ports'], c.io)).toBe(0);
    expect(c.out()).toContain('"api": 9950');
    expect(c.out()).toContain('"postgres": 9952');
    expect(c.out()).toContain('worktree slots: 9960–9989');
  });

  it('prints the ports of a slot', () => {
    const c = capture();
    expect(main(['ports', '--slot', '3'], c.io)).toBe(0);
    expect(c.out()).toBe('slot 3: api 9969, web 9970, postgres 9971\n');
  });

  it.each(['10', 'abc', '-1', '1.5', ''])(
    'rejects --slot %j with one line on stderr and exit code 2',
    (value) => {
      const c = capture();
      expect(main(['ports', '--slot', value], c.io)).toBe(2);
      expect(c.out()).toBe('');
      expect(c.err().trimEnd().split('\n')).toHaveLength(1);
      expect(c.err()).toContain('--slot must be a whole number in 0..9');
    },
  );

  it('rejects --slot without a value', () => {
    const c = capture();
    expect(main(['ports', '--slot'], c.io)).toBe(2);
    expect(c.err()).toBe('mwc ports: --slot needs a value\n');
  });

  it('resolves --path against INIT_CWD when pnpm sets it', () => {
    const c = capture({ cwd: '/repo', env: { INIT_CWD: '/work/trees' } });
    expect(main(['ports', '--path', 'feature-x'], c.io)).toBe(0);
    const slot = slotFromPath('/work/trees/feature-x');
    expect(c.out()).toMatch(new RegExp(`^slot ${slot}: api ${9960 + 3 * slot}, `));
  });

  it('resolves --path against cwd without INIT_CWD, and keeps absolute paths', () => {
    const relative = capture({ cwd: '/repo', env: {} });
    main(['ports', '--path', 'feature-x'], relative.io);
    expect(relative.out()).toMatch(new RegExp(`^slot ${slotFromPath('/repo/feature-x')}: `));

    const absolute = capture({ cwd: '/repo', env: { INIT_CWD: '/elsewhere' } });
    main(['ports', '--path', '/abs/tree'], absolute.io);
    expect(absolute.out()).toMatch(new RegExp(`^slot ${slotFromPath('/abs/tree')}: `));
  });
});

describe('checkSteps', () => {
  it('runs biome, a typecheck per package, then the tests with coverage', () => {
    const steps = checkSteps(new Set(), ['packages/cli', 'packages/shared']);
    expect(steps.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'typecheck packages/cli',
      'typecheck packages/shared',
      'tests',
    ]);
    expect(steps.at(-1)?.args).toContain('--coverage');
  });

  it('checks db drift (migrations and schema diagram) after the typechecks when packages/db exists', () => {
    const steps = checkSteps(new Set(), ['packages/cli', 'packages/db']);
    expect(steps.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'typecheck packages/cli',
      'typecheck packages/db',
      'db drift',
      'tests',
    ]);
    expect(steps[4]).toMatchObject({
      command: process.execPath,
      args: ['packages/db/scripts/check-drift.ts'],
    });
  });

  it('points the db drift step at a script that runs both drift checks', () => {
    const [step] = checkSteps(new Set(), ['packages/db']).filter((s) => s.label === 'db drift');
    const script = readFileSync(resolve(import.meta.dirname, '../../..', step?.args[0] ?? ''), 'utf8');
    expect(script).toContain('checkMigrations()');
    expect(script).toContain('checkDiagram()');
  });

  it('drops coverage with --fast', () => {
    expect(checkSteps(new Set(['fast']), []).at(-1)?.args).not.toContain('--coverage');
  });

  it('adds the web build and the Playwright smoke with --full, run from apps/web on Node', () => {
    const full = checkSteps(new Set(['full']), ['apps/web'], { docker: true, postgresRunning: false });
    expect(full.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'typecheck apps/web',
      'tests',
      'web build',
      'e2e',
    ]);
    expect(full.slice(-2)).toEqual([
      {
        label: 'web build',
        command: process.execPath,
        args: ['node_modules/vite/bin/vite.js', 'build'],
        cwd: 'apps/web',
      },
      {
        label: 'e2e',
        command: process.execPath,
        args: ['node_modules/@playwright/test/cli.js', 'test'],
        cwd: 'apps/web',
      },
    ]);
    expect(checkSteps(new Set(), ['apps/web']).map((s) => s.label)).not.toContain('e2e');
    expect(checkSteps(new Set(['full']), ['packages/cli']).map((s) => s.label)).not.toContain('e2e');
  });

  it('runs the db and server tests on the dev Postgres with --full, starting and stopping it', () => {
    const dirs = ['apps/server', 'apps/web', 'packages/db'];
    const full = checkSteps(new Set(['full']), dirs, { docker: true, postgresRunning: false });
    expect(full.map((s) => s.label).slice(dirs.length + 4)).toEqual([
      'postgres',
      'tests on postgres',
      'web build',
      'e2e',
      'postgres down',
    ]);
    const tests = full.find((s) => s.label === 'tests on postgres');
    expect(tests?.env).toEqual({
      TEST_DB: 'postgres',
      TEST_DATABASE_URL: 'postgres://mwc:mwc@localhost:9952/mwc',
    });
    expect(tests?.args).toEqual([
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reportsDirectory=coverage/postgres',
    ]);
  });

  it('leaves a running dev Postgres alone, drops coverage with --fast, and skips the lane without Docker', () => {
    const dirs = ['packages/db'];
    const running = checkSteps(new Set(['full', 'fast']), dirs, { docker: true, postgresRunning: true });
    expect(running.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'typecheck packages/db',
      'db drift',
      'tests',
      'tests on postgres',
    ]);
    expect(running.at(-1)?.args).toEqual(['exec', 'vitest', 'run']);
    const noDocker = checkSteps(new Set(['full']), dirs, { docker: false, postgresRunning: false });
    expect(noDocker.map((s) => s.label)).not.toContain('tests on postgres');
    expect(checkSteps(new Set(['full']), dirs).map((s) => s.label)).not.toContain('postgres');
  });

  it('points the --full steps at files the web package really has', () => {
    const root = resolve(import.meta.dirname, '../../..');
    for (const step of checkSteps(new Set(['full']), ['apps/web']).filter((s) => s.cwd)) {
      expect(existsSync(resolve(root, step.cwd ?? '', step.args[0] ?? ''))).toBe(true);
    }
  });
});

describe('runCheck', () => {
  it('runs every step even after a failure and lists the failed ones', () => {
    const c = capture();
    const ran: string[] = [];
    const code = runCheck(new Set(), c.io, {
      packageDirs: ['packages/a', 'packages/b'],
      runStep: (step: CheckStep) => {
        ran.push(step.label);
        return step.label !== 'typecheck packages/a' && step.label !== 'tests';
      },
    });
    expect(code).toBe(1);
    expect(ran).toEqual(['biome', 'banned names', 'typecheck packages/a', 'typecheck packages/b', 'tests']);
    expect(c.out()).toContain('▶ typecheck packages/b');
    expect(c.err()).toContain('✗ mwc check failed: typecheck packages/a, tests');
  });

  it('passes when every step passes, and says when --full skips the Postgres lane', () => {
    const c = capture();
    expect(runCheck(new Set(['full']), c.io, { packageDirs: [], runStep: () => true })).toBe(0);
    expect(c.out()).toContain('Docker is not available, so the Postgres lane is skipped');
    expect(c.out()).toContain('✓ mwc check passed');
  });

  it('asks about Docker only for --full and plans the Postgres lane from the answer', () => {
    let asked = 0;
    const ran: string[] = [];
    const deps = {
      packageDirs: ['packages/db'],
      runStep: (step: CheckStep) => ran.push(step.label) > 0,
      lane: () => {
        asked++;
        return { docker: true, postgresRunning: false };
      },
    };
    runCheck(new Set(), capture().io, deps);
    expect(asked).toBe(0);
    ran.length = 0;
    const c = capture();
    expect(runCheck(new Set(['full']), c.io, deps)).toBe(0);
    expect(asked).toBe(1);
    expect(ran.slice(-3)).toEqual(['postgres', 'tests on postgres', 'postgres down']);
    expect(c.out()).not.toContain('skipped');
  });
});

describe('the banned names step', () => {
  it('runs in this process: spawnStep calls run instead of starting a process', () => {
    const [step] = checkSteps(new Set(['fast']), []).filter((s) => s.label === 'banned names');
    expect(step?.run).toBeTypeOf('function');
    expect(step?.args).toEqual(['packages/cli/src/mwc.ts', 'banned']);
    const c = capture();
    expect(
      spawnStep({ label: 'inline', command: 'mwc-no-such-command', args: [], run: () => true }, c.io),
    ).toBe(true);
    expect(c.err()).toBe('');
  });
});

describe('spawnStep (one real node process)', () => {
  it('runs the step in its cwd with its env added, and reports a missing command', () => {
    const c = capture();
    const probe = [
      "const cwdOk = process.cwd().endsWith('packages/cli');",
      "const envOk = process.env.MWC_PROBE === 'yes' && Boolean(process.env.PATH);",
      'process.exit(cwdOk && envOk ? 0 : 1);',
    ].join(' ');
    const step: CheckStep = {
      label: 'probe',
      command: process.execPath,
      args: ['-e', probe],
      cwd: 'packages/cli',
      env: { MWC_PROBE: 'yes' },
    };
    expect(spawnStep(step, c.io)).toBe(true);
    expect(spawnStep({ label: 'missing', command: 'mwc-no-such-command', args: [] }, c.io)).toBe(false);
    expect(c.err()).toContain('missing: ');
  });
});

describe('workspacePackages', () => {
  it('finds the packages with a tsconfig.json in this repo', () => {
    const dirs = workspacePackages(resolve(import.meta.dirname, '../../..'));
    expect(dirs).toContain('packages/cli');
    expect(dirs).toContain('packages/shared');
  });

  it('returns nothing for a folder without packages or apps', () => {
    expect(workspacePackages(import.meta.dirname)).toEqual([]);
  });
});
