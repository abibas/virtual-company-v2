import { slotFromPath } from '@mwc/shared/ports';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.ts';
import { capture } from './fixtures/io.ts';
import { CLEAN, scanOf } from './fixtures/tree.ts';

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

  it('runs the structure rules alone: 0 when they hold, 1 with the broken ones on stderr', () => {
    const clean = capture();
    expect(main(['structure'], clean.io, { scan: scanOf(CLEAN).deps })).toBe(0);
    expect(clean.out()).toMatch(/^structure ok in \d+ files\n$/);
    const broken = capture();
    expect(main(['structure'], broken.io, { scan: scanOf({ ...CLEAN, 'tools/x.ts': '' }).deps })).toBe(1);
    expect(broken.err()).toContain('tools/x.ts: [layout] tools/ is not a known top-level entry');
    expect(main(['help'], capture().io)).toBe(0);
  });

  it('lists structure in the help', () => {
    const c = capture();
    main(['help'], c.io);
    expect(c.out()).toContain('  structure ');
  });
});
