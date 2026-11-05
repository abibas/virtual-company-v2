import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/account/api.ts';
import { whoami } from '../../src/account/whoami.ts';
import { parseArgs } from '../../src/args.ts';
import { saveLogin } from '../../src/credentials.ts';
import {
  ACME,
  fakeApi,
  KEY,
  meBody,
  noFetch,
  OTHER_KEY,
  REFUSED,
  REMOTE,
  RUNNER_KEY,
  SERVER,
  tempConfig,
} from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';

const run = async (argv: string[], env: Record<string, string>, fetch: Fetch = fakeApi().fetch) => {
  const c = capture({ env });
  const code = await whoami(parseArgs(['whoami', ...argv]), c.io, { fetch });
  return { ...c, code };
};
const GLOBEX = { ...ACME, companyId: '019a4f0c-9999-7000-8000-000000000002', slug: 'globex', name: 'Globex' };

function loggedIn() {
  const config = tempConfig();
  saveLogin(config.path, { server: SERVER, companyId: ACME.companyId, companySlug: ACME.slug, key: KEY });
  return config;
}

describe('mwc whoami', () => {
  it('prints the user, company, role and key prefix of the saved login, never the key', async () => {
    const config = loggedIn();
    const api = fakeApi();
    const r = await run([], config.env, api.fetch);
    expect(r.code).toBe(0);
    expect(api.calls).toMatchObject([{ url: `${SERVER}/api/me`, authorization: `Bearer ${KEY}` }]);
    expect(r.out()).toBe(
      `server   ${SERVER}\n` +
        'user     Olga <olga@example.test>\n' +
        `company  Acme (acme, ${ACME.companyId})\n` +
        'role     admin\n' +
        `key      mwc_pk_Tq3Z... (saved in ${config.path})\n`,
    );
    expect(r.out() + r.err()).not.toContain(KEY.slice(11));
  });

  it('names a person who has not given a name by their email', async () => {
    const config = loggedIn();
    const body = meBody();
    const api = fakeApi({
      [KEY]: { status: 200, body: { ...body, user: { ...body.user, displayName: null } } },
    });
    const r = await run([], config.env, api.fetch);
    expect(r.code).toBe(0);
    expect(r.out()).toContain('user     olga@example.test\n');
  });

  it('lets MWC_SERVER and MWC_API_KEY take precedence over the saved login', async () => {
    const config = loggedIn();
    const api = fakeApi({ [OTHER_KEY]: { status: 200, body: meBody(GLOBEX) } });
    const r = await run([], { ...config.env, MWC_SERVER: REMOTE, MWC_API_KEY: OTHER_KEY }, api.fetch);
    expect(r.code).toBe(0);
    expect(api.calls).toMatchObject([{ url: `${REMOTE}/api/me`, authorization: `Bearer ${OTHER_KEY}` }]);
    expect(r.out()).toContain(`company  Globex (globex, ${GLOBEX.companyId})\n`);
    expect(r.out()).toContain('key      mwc_pk_Hh2K... (from MWC_API_KEY)\n');
    const keyOnly = await run([], { ...config.env, MWC_API_KEY: OTHER_KEY }, api.fetch);
    expect(keyOnly.code).toBe(0);
    expect(api.calls.at(-1)?.url).toBe(`${SERVER}/api/me`);
  });

  it('picks a saved server with --server, and shows a membership that is not active', async () => {
    const config = loggedIn();
    saveLogin(config.path, {
      server: REMOTE,
      companyId: GLOBEX.companyId,
      companySlug: 'globex',
      key: OTHER_KEY,
    });
    const api = fakeApi({ [KEY]: { status: 200, body: meBody({ ...ACME, status: 'suspended' }) } });
    const r = await run(['--server', SERVER], config.env, api.fetch);
    expect(r.code).toBe(0);
    expect(r.out()).toContain('role     admin (suspended)\n');
  });

  it('says so when not logged in, without calling anything (exit 1)', async () => {
    const config = tempConfig();
    const nothing = await run([], config.env, noFetch);
    expect(nothing.code).toBe(1);
    expect(nothing.err()).toBe(
      'mwc whoami: not logged in. Run mwc login --server <url> --company <id|slug>, or set MWC_SERVER and ' +
        'MWC_API_KEY.\n',
    );
    const saved = loggedIn();
    const elsewhere = await run(['--server', REMOTE], saved.env, noFetch);
    expect(elsewhere.code).toBe(1);
    expect(elsewhere.err()).toMatch(/^mwc whoami: not logged in/);
  });

  it('exits 1 with a clear message when the server refuses the key (401)', async () => {
    const config = loggedIn();
    const r = await run([], config.env, fakeApi({ [KEY]: REFUSED }).fetch);
    expect(r.code).toBe(1);
    expect(r.err()).toBe(
      `mwc whoami: ${SERVER} refused the key (The API key was revoked). Make a new key and run mwc login again.\n`,
    );
    expect(r.out()).toBe('');
  });

  it('exits 1 for a company that is gone, a server error, a key of the wrong kind and a broken file', async () => {
    const config = loggedIn();
    const gone = await run([], config.env, fakeApi({ [KEY]: { status: 200, body: meBody(ACME, []) } }).fetch);
    expect(gone.code).toBe(1);
    expect(gone.err()).toMatch(/the key's company is not available any more/);
    const down = await run([], config.env, () => Promise.reject(new Error('ECONNREFUSED')));
    expect(down.err()).toBe(`mwc whoami: cannot reach ${SERVER}: ECONNREFUSED\n`);
    const runner = await run([], { ...config.env, MWC_API_KEY: RUNNER_KEY }, noFetch);
    expect(runner.code).toBe(1);
    expect(runner.err()).toBe('mwc whoami: the key from MWC_API_KEY is not a personal API key\n');
    const broken = tempConfig();
    mkdirSync(broken.dir);
    writeFileSync(broken.path, '{');
    const corrupt = await run([], broken.env, noFetch);
    expect(corrupt.code).toBe(1);
    expect(corrupt.err()).toMatch(/is not valid JSON/);
  });

  it('refuses --server without a value (exit 2)', async () => {
    const r = await run(['--server'], loggedIn().env, noFetch);
    expect(r.code).toBe(2);
    expect(r.err()).toBe('mwc whoami: --server needs a value\n');
  });
});
