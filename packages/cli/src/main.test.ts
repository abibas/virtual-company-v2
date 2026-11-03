import { resolve } from 'node:path';
import { slotFromPath } from '@mwc/shared/ports';
import { describe, expect, it } from 'vitest';
import { type CheckStep, checkSteps, type MainIo, main, runCheck, workspacePackages } from './main.ts';

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
      'typecheck packages/cli',
      'typecheck packages/shared',
      'tests',
    ]);
    expect(steps.at(-1)?.args).toContain('--coverage');
  });

  it('drops coverage with --fast', () => {
    expect(checkSteps(new Set(['fast']), []).at(-1)?.args).not.toContain('--coverage');
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
    expect(ran).toEqual(['biome', 'typecheck packages/a', 'typecheck packages/b', 'tests']);
    expect(c.out()).toContain('▶ typecheck packages/b');
    expect(c.err()).toContain('✗ mwc check failed: typecheck packages/a, tests');
  });

  it('passes when every step passes and mentions the --full lanes', () => {
    const c = capture();
    expect(runCheck(new Set(['full']), c.io, { packageDirs: [], runStep: () => true })).toBe(0);
    expect(c.out()).toContain('--full: the Postgres and e2e lanes');
    expect(c.out()).toContain('✓ mwc check passed');
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
