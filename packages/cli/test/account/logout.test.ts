import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logout } from '../../src/account/logout.ts';
import { parseArgs } from '../../src/args.ts';
import { readCredentials, saveLogin } from '../../src/credentials.ts';
import { ACME, KEY, OTHER_KEY, REMOTE, SERVER, tempConfig } from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';

const run = (argv: string[], env: Record<string, string>) => {
  const c = capture({ env });
  return { ...c, code: logout(parseArgs(['logout', ...argv]), c.io) };
};

function twoLogins() {
  const config = tempConfig();
  saveLogin(config.path, {
    server: REMOTE,
    companyId: ACME.companyId,
    companySlug: ACME.slug,
    key: OTHER_KEY,
  });
  saveLogin(config.path, { server: SERVER, companyId: ACME.companyId, companySlug: ACME.slug, key: KEY });
  return config;
}

describe('mwc logout', () => {
  it("removes the current server's login and keeps the others", () => {
    const config = twoLogins();
    const r = run([], config.env);
    expect(r.code).toBe(0);
    expect(r.out()).toBe(
      `Logged out of ${SERVER}: its key is removed from ${config.path}.\n` +
        'The key still works until it expires; revoke it from your API keys if it may have leaked.\n',
    );
    expect(r.out()).not.toContain(KEY.slice(11));
    const file = readCredentials(config.path);
    expect(Object.keys(file.servers)).toEqual([REMOTE]);
    expect(file.current).toBe(REMOTE);
  });

  it('removes the server named by --server or MWC_SERVER', () => {
    const config = twoLogins();
    expect(run(['--server', `${REMOTE}/`], config.env).code).toBe(0);
    expect(Object.keys(readCredentials(config.path).servers)).toEqual([SERVER]);
    expect(run([], { ...config.env, MWC_SERVER: SERVER }).code).toBe(0);
    expect(readCredentials(config.path).servers).toEqual({});
  });

  it('is not an error when not logged in', () => {
    const config = tempConfig();
    const none = run([], config.env);
    expect(none).toMatchObject({ code: 0 });
    expect(none.out()).toBe('Not logged in; nothing to remove.\n');
    const other = run(['--server', REMOTE], twoLogins().env);
    expect(other.code).toBe(0);
    expect(run(['--server', 'https://elsewhere.example.com'], config.env).out()).toBe(
      'Not logged in to https://elsewhere.example.com; nothing to remove.\n',
    );
  });

  it('exits 1 for a broken file or a bad server URL, and 2 for --server without a value', () => {
    const config = tempConfig();
    mkdirSync(config.dir);
    writeFileSync(config.path, '[]');
    const broken = run([], config.env);
    expect(broken.code).toBe(1);
    expect(broken.err()).toMatch(/^mwc logout: .* is not an mwc credentials file/);
    expect(run(['--server', 'ftp://x'], tempConfig().env).code).toBe(1);
    const empty = run(['--server'], config.env);
    expect(empty.code).toBe(2);
    expect(empty.err()).toBe('mwc logout: --server needs a value\n');
  });
});
