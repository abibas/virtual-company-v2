import { slotFromPath } from '@mwc/shared/ports';
import { describe, expect, it } from 'vitest';
import { readCredentials } from '../src/credentials.ts';
import { main } from '../src/main.ts';
import { ACME, fakeApi, KEY, piped, SERVER, tempConfig } from './fixtures/account.ts';
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

  it('lists the early warnings with structure --report, and exits 0 even with warnings', () => {
    const c = capture();
    const coverage = () => undefined;
    expect(main(['structure', '--report'], c.io, { scan: scanOf(CLEAN).deps, coverage })).toBe(0);
    expect(c.out()).toMatch(/^Structure report: 2 warnings in \d+ files\./);
    const broken = capture();
    const scan = scanOf({ ...CLEAN, 'tools/x.ts': '' }).deps;
    expect(main(['structure', '--report'], broken.io, { scan, coverage })).toBe(0);
    expect(broken.err()).toBe('');
  });

  it('lists structure and its --report in the help', () => {
    const c = capture();
    main(['help'], c.io);
    expect(c.out()).toContain('  structure [--report] ');
  });

  it('logs in, tells who it is and logs out through the account commands', async () => {
    const config = tempConfig();
    const api = fakeApi();
    const account = { fetch: api.fetch, stdin: piped(KEY) };
    const login = capture({ env: config.env });
    expect(await main(['login', '--server', SERVER, '--company', ACME.slug], login.io, { account })).toBe(0);
    expect(readCredentials(config.path).current).toBe(SERVER);
    const who = capture({ env: config.env });
    expect(await main(['whoami'], who.io, { account })).toBe(0);
    expect(who.out()).toContain('role     admin\n');
    expect(main(['logout'], capture({ env: config.env }).io)).toBe(0);
    expect(readCredentials(config.path).servers).toEqual({});
    expect(api.calls).toHaveLength(2);
  });

  it('uses the real fetch and standard input by default (nothing to call when not logged in)', async () => {
    const config = tempConfig();
    const who = capture({ env: config.env });
    expect(await main(['whoami'], who.io)).toBe(1);
    expect(who.err()).toMatch(/^mwc whoami: not logged in/);
    const login = capture({ env: config.env });
    expect(await main(['login'], login.io)).toBe(2);
  });

  it('runs org tree, agents list and machine enroll-token through the account fetch (here: not logged in, then usage errors)', async () => {
    const config = tempConfig();
    const account = { fetch: fakeApi().fetch, stdin: piped() };
    for (const argv of [
      ['org', 'tree'],
      ['agents', 'list'],
      ['machine', 'enroll-token'],
    ]) {
      const c = capture({ env: config.env });
      expect(await main(argv, c.io, { account })).toBe(1);
      expect(c.err()).toMatch(new RegExp(`^mwc ${argv.join(' ')}: not logged in`));
    }
    const org = capture({ env: config.env });
    expect(await main(['org'], org.io)).toBe(2);
    expect(org.err()).toMatch(/^mwc org: expected "tree"/);
    const agents = capture({ env: config.env });
    expect(await main(['agents', 'show'], agents.io)).toBe(2);
    expect(agents.err()).toMatch(/^mwc agents: expected "list", got "show"/);
  });

  it('lists the account and org commands in the help', () => {
    const c = capture();
    main(['help'], c.io);
    for (const command of [
      '  login --server URL --company ID|SLUG',
      '  whoami [--server URL]',
      '  logout [--server URL]',
      '  org tree [--company SLUG] [--json]',
      '  agents list [--company SLUG] [--status active|paused|archived|all] [--json]',
      '  machine enroll-token [--company SLUG] [--server URL]',
    ]) {
      expect(c.out()).toContain(command);
    }
  });
});
