import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cachedScanDeps } from '../src/banned.ts';
import {
  type CheckStep,
  checkSteps,
  runCheck,
  spawnStep,
  structureCheck,
  WORKSPACE_GROUPS,
  workspacePackages,
} from '../src/check.ts';
import { REPO_ROOT } from '../src/io.ts';
import { STRUCTURE_RULES } from '../src/structure/rules.ts';
import { capture } from './fixtures/io.ts';
import { CLEAN, scanOf } from './fixtures/tree.ts';

describe('checkSteps', () => {
  it('runs biome, a typecheck per package, then the tests with coverage', () => {
    const steps = checkSteps(new Set(), ['packages/cli', 'packages/shared']);
    expect(steps.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'structure',
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
      'structure',
      'typecheck packages/cli',
      'typecheck packages/db',
      'db drift',
      'tests',
    ]);
    expect(steps[5]).toMatchObject({
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

  it('adds the web build with --full, run from apps/web on Node, and no frontend tests', () => {
    const full = checkSteps(new Set(['full']), ['apps/web'], { docker: true, postgresRunning: false });
    expect(full.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'structure',
      'typecheck apps/web',
      'tests',
      'web build',
    ]);
    expect(full.at(-1)).toEqual({
      label: 'web build',
      command: process.execPath,
      args: ['node_modules/vite/bin/vite.js', 'build'],
      cwd: 'apps/web',
    });
    expect(checkSteps(new Set(), ['apps/web']).map((s) => s.label)).not.toContain('web build');
    expect(checkSteps(new Set(['full']), ['packages/cli']).map((s) => s.label)).not.toContain('web build');
  });

  it('runs the db and server tests on the dev Postgres with --full, starting and stopping it', () => {
    const dirs = ['apps/server', 'apps/web', 'packages/db'];
    const full = checkSteps(new Set(['full']), dirs, { docker: true, postgresRunning: false });
    expect(full.map((s) => s.label).slice(dirs.length + 5)).toEqual([
      'postgres',
      'tests on postgres',
      'web build',
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
      '--coverage.reportsDirectory=.cache/coverage/postgres',
    ]);
  });

  it('leaves a running dev Postgres alone, drops coverage with --fast, and skips the lane without Docker', () => {
    const dirs = ['packages/db'];
    const running = checkSteps(new Set(['full', 'fast']), dirs, { docker: true, postgresRunning: true });
    expect(running.map((s) => s.label)).toEqual([
      'biome',
      'banned names',
      'structure',
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

/** What runCheck reads besides its steps: an in-memory tree and no coverage summary. */
const quiet = () => ({ scan: scanOf(CLEAN).deps, coverage: () => undefined });

describe('runCheck', () => {
  it('runs every step even after a failure and lists the failed ones', () => {
    const c = capture();
    const ran: string[] = [];
    const code = runCheck(new Set(), c.io, {
      ...quiet(),
      packageDirs: ['packages/a', 'packages/b'],
      runStep: (step: CheckStep) => {
        ran.push(step.label);
        return step.label !== 'typecheck packages/a' && step.label !== 'tests';
      },
    });
    expect(code).toBe(1);
    expect(ran).toEqual([
      'biome',
      'banned names',
      'structure',
      'typecheck packages/a',
      'typecheck packages/b',
      'tests',
    ]);
    expect(c.out()).toContain('▶ typecheck packages/b');
    expect(c.err()).toContain('✗ mwc check failed: typecheck packages/a, tests');
  });

  it('passes when every step passes, and says when --full skips the Postgres lane', () => {
    const c = capture();
    expect(runCheck(new Set(['full']), c.io, { ...quiet(), packageDirs: [], runStep: () => true })).toBe(0);
    expect(c.out()).toContain('Docker is not available, so the Postgres lane is skipped');
    expect(c.out()).toContain('✓ mwc check passed');
  });

  it('asks about Docker only for --full and plans the Postgres lane from the answer', () => {
    let asked = 0;
    const ran: string[] = [];
    const deps = {
      ...quiet(),
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

describe('the closing structure warnings', () => {
  const coverage = JSON.stringify({
    [`${REPO_ROOT}/packages/db/src/schema/users.ts`]: {
      lines: { total: 10, covered: 8, skipped: 0, pct: 80 },
      branches: { total: 2, covered: 2, skipped: 0, pct: 100 },
    },
  });

  it('end the run before the verdict, from the shared listing, with the coverage of the last run', () => {
    const scan = scanOf(CLEAN);
    const c = capture();
    const steps: string[] = [];
    const code = runCheck(new Set(), c.io, {
      scan: cachedScanDeps(scan.deps),
      coverage: () => coverage,
      packageDirs: [],
      runStep: (step, io) => steps.push(step.label) > 0 && (step.run?.(io) ?? true),
    });
    expect(code).toBe(0);
    const out = c.out();
    expect(out).toContain('Structure warnings (never a failure): 2 near-limit, 1 low-coverage.');
    expect(out).toContain('  low-coverage  packages/db/src/schema/users.ts: 80% lines, 100% branches');
    expect(out.indexOf('Structure warnings')).toBeLessThan(out.indexOf('✓ mwc check passed'));
    expect(out.indexOf('▶ tests')).toBeLessThan(out.indexOf('Structure warnings'));
    expect(scan.listings()).toBe(1);
  });

  it('never change the exit code, and --fast leaves coverage out (it has no coverage run)', () => {
    const c = capture();
    const deps = {
      scan: scanOf(CLEAN).deps,
      coverage: () => coverage,
      packageDirs: [],
      runStep: () => false,
    };
    expect(runCheck(new Set(['fast']), c.io, deps)).toBe(1);
    expect(c.out()).toContain('Structure warnings (never a failure): 2 near-limit. The worst of each:');
    expect(c.out()).not.toContain('low-coverage');
    const clean = capture();
    const none = { ...deps, scan: scanOf({ 'README.md': '# Readme\n' }).deps, runStep: () => true };
    expect(runCheck(new Set(['fast']), clean.io, none)).toBe(0);
    expect(clean.out()).toContain('Structure warnings: none');
  });
});

describe('the in-process steps: banned names and structure', () => {
  it('run in this process: spawnStep calls run instead of starting a process', () => {
    const steps = checkSteps(new Set(['fast']), []).filter((s) => s.run);
    expect(steps.map((s) => [s.label, s.args])).toEqual([
      ['banned names', ['packages/cli/src/mwc.ts', 'banned']],
      ['structure', ['packages/cli/src/mwc.ts', 'structure']],
    ]);
    const c = capture();
    expect(
      spawnStep({ label: 'inline', command: 'mwc-no-such-command', args: [], run: () => true }, c.io),
    ).toBe(true);
    expect(c.err()).toBe('');
  });

  it('share one file listing and read each file once', () => {
    const scan = scanOf(CLEAN);
    const steps = checkSteps(new Set(['fast']), [], undefined, cachedScanDeps(scan.deps));
    const c = capture();
    for (const step of steps.filter((s) => s.run)) expect(step.run?.(c.io)).toBe(true);
    expect(scan.listings()).toBe(1);
    expect(Math.max(...scan.reads.values())).toBe(1);
    expect(c.out()).toContain(`no banned names in ${Object.keys(CLEAN).length} files`);
    expect(c.out()).toContain(`structure ok in ${Object.keys(CLEAN).length} files`);
  });

  it('structureCheck names each broken rule on stderr, then the hint', () => {
    const c = capture();
    const scan = scanOf({ ...CLEAN, 'packages/db/src/a.test.ts': '' });
    expect(structureCheck(c.io, scan.deps)).toBe(false);
    expect(c.err()).toBe(
      'packages/db/src/a.test.ts: [tests] a test under src/: move it to packages/db/test/a.test.ts (test/ mirrors src/)\n' +
        `${STRUCTURE_RULES.hint}\n`,
    );
    expect(c.out()).toBe('');
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
    expect(dirs).toContain('apps/server');
  });

  it('looks in packages, connectors and apps, and takes a missing group as empty', () => {
    expect(WORKSPACE_GROUPS).toEqual(['packages', 'connectors', 'apps']);
    const root = mkdtempSync(join(tmpdir(), 'mwc-workspace-'));
    try {
      for (const dir of ['connectors/jira', 'apps/server', 'packages/notes']) {
        mkdirSync(join(root, dir), { recursive: true });
      }
      writeFileSync(join(root, 'connectors/jira/tsconfig.json'), '{}');
      writeFileSync(join(root, 'apps/server/tsconfig.json'), '{}');
      expect(workspacePackages(root)).toEqual(['connectors/jira', 'apps/server']);
      rmSync(join(root, 'connectors'), { recursive: true });
      expect(workspacePackages(root)).toEqual(['apps/server']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns nothing for a folder without packages or apps', () => {
    expect(workspacePackages(import.meta.dirname)).toEqual([]);
  });
});
