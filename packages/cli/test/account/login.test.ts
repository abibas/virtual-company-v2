import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type AccountDeps, login } from '../../src/account/login.ts';
import { parseArgs } from '../../src/args.ts';
import { readCredentials } from '../../src/credentials.ts';
import {
  ACME,
  fakeApi,
  KEY,
  meBody,
  noFetch,
  OTHER_KEY,
  piped,
  REFUSED,
  REMOTE,
  RUNNER_KEY,
  SERVER,
  tempConfig,
  terminal,
  untouchedStdin,
} from '../fixtures/account.ts';
import { capture } from '../fixtures/io.ts';

const run = (argv: string[], env: Record<string, string>, deps: Partial<AccountDeps> = {}) => {
  const c = capture({ env });
  const code = login(parseArgs(['login', ...argv]), c.io, {
    fetch: deps.fetch ?? fakeApi().fetch,
    stdin: deps.stdin ?? untouchedStdin(),
  });
  return { ...c, code };
};
const loginTo = ['--server', SERVER, '--company', ACME.slug];
const saved = { server: SERVER, companyId: ACME.companyId, companySlug: ACME.slug, key: KEY };

describe('mwc login', () => {
  it('checks the key from MWC_API_KEY with GET /api/me and saves it, never printing it', async () => {
    const config = tempConfig();
    const api = fakeApi();
    const r = run(loginTo, { ...config.env, MWC_API_KEY: KEY }, { fetch: api.fetch });
    expect(await r.code).toBe(0);
    expect(api.calls).toEqual([{ url: `${SERVER}/api/me`, authorization: `Bearer ${KEY}`, signal: true }]);
    expect(readCredentials(config.path)).toEqual({
      version: 1,
      current: SERVER,
      servers: { [SERVER]: saved },
    });
    expect(statSync(config.path).mode & 0o777).toBe(0o600);
    expect(statSync(config.dir).mode & 0o777).toBe(0o700);
    expect(r.out()).toBe(
      `Logged in to ${SERVER} as Olga <olga@example.test>\n` +
        '  company  Acme (acme), role admin\n' +
        `  key      mwc_pk_Tq3Z... saved in ${config.path}\n`,
    );
    expect(r.out() + r.err()).not.toContain(KEY.slice(11));
  });

  it('reads the key piped in, or typed at a hidden prompt, and finds the company by id too', async () => {
    const config = tempConfig();
    const byId = ['--server', `${SERVER}/`, '--company', ACME.companyId];
    expect(await run(byId, config.env, { stdin: piped(`${KEY}\n`) }).code).toBe(0);
    expect(readCredentials(config.path).servers[SERVER]).toEqual(saved);
    const { stdin } = terminal();
    stdin.write(`${KEY}\r`);
    const typed = run(loginTo, config.env, { stdin });
    expect(await typed.code).toBe(0);
    expect(typed.err()).toBe('Paste your personal API key (mwc_pk_..., input hidden): \n');
  });

  it('takes the server from MWC_SERVER when --server is left out', async () => {
    const config = tempConfig();
    const r = run(['--company', 'acme'], { ...config.env, MWC_SERVER: SERVER, MWC_API_KEY: KEY });
    expect(await r.code).toBe(0);
    expect(readCredentials(config.path).current).toBe(SERVER);
  });

  it('keeps the logins of other servers and makes the new one current', async () => {
    const config = tempConfig();
    const api = fakeApi({
      [KEY]: { status: 200, body: meBody() },
      [OTHER_KEY]: { status: 200, body: meBody() },
    });
    await run(loginTo, { ...config.env, MWC_API_KEY: KEY }, { fetch: api.fetch }).code;
    const remote = ['--server', REMOTE, '--company', 'acme'];
    expect(await run(remote, { ...config.env, MWC_API_KEY: OTHER_KEY }, { fetch: api.fetch }).code).toBe(0);
    const file = readCredentials(config.path);
    expect(file.current).toBe(REMOTE);
    expect(Object.keys(file.servers)).toEqual([SERVER, REMOTE]);
  });

  it('warns when the key would travel over plain http to another machine', async () => {
    const config = tempConfig();
    const remote = ['--server', 'http://corp.example.com', '--company', 'acme'];
    const r = run(remote, { ...config.env, MWC_API_KEY: KEY });
    expect(await r.code).toBe(0);
    expect(r.err()).toBe(
      'mwc login: warning: http://corp.example.com is plain http, so the key travels unencrypted\n',
    );
    const local = run(loginTo, { ...config.env, MWC_API_KEY: KEY });
    expect(await local.code).toBe(0);
    expect(local.err()).toBe('');
  });
});

describe('mwc login refuses', () => {
  it('a key of another company, and a key whose company is gone, saving nothing', async () => {
    const config = tempConfig();
    const other = run(['--server', SERVER, '--company', 'globex'], { ...config.env, MWC_API_KEY: KEY });
    expect(await other.code).toBe(1);
    expect(other.err()).toBe(`mwc login: this key belongs to acme (${ACME.companyId}), not globex\n`);
    const gone = fakeApi({ [KEY]: { status: 200, body: meBody(ACME, []) } });
    const none = run(loginTo, { ...config.env, MWC_API_KEY: KEY }, { fetch: gone.fetch });
    expect(await none.code).toBe(1);
    expect(none.err()).toMatch(/the key's company is not available/);
    expect(existsSync(config.path)).toBe(false);
  });

  it('a membership that is not active', async () => {
    const config = tempConfig();
    const suspended = fakeApi({ [KEY]: { status: 200, body: meBody({ ...ACME, status: 'suspended' }) } });
    const r = run(loginTo, { ...config.env, MWC_API_KEY: KEY }, { fetch: suspended.fetch });
    expect(await r.code).toBe(1);
    expect(r.err()).toBe('mwc login: your membership in acme is suspended\n');
  });

  it('a key the server refuses (401), and a server that is down or not this API', async () => {
    const config = tempConfig();
    const refused = run(
      loginTo,
      { ...config.env, MWC_API_KEY: KEY },
      { fetch: fakeApi({ [KEY]: REFUSED }).fetch },
    );
    expect(await refused.code).toBe(1);
    expect(refused.err()).toBe(`mwc login: ${SERVER} refused the key: The API key was revoked\n`);
    const down = run(
      loginTo,
      { ...config.env, MWC_API_KEY: KEY },
      { fetch: () => Promise.reject(new Error('ECONNREFUSED')) },
    );
    expect(await down.code).toBe(1);
    expect(down.err()).toBe(`mwc login: cannot reach ${SERVER}: ECONNREFUSED\n`);
    const odd = fakeApi({
      [KEY]: { status: 500, body: { error: { code: 'internal', message: 'Internal server error' } } },
    });
    const failing = run(loginTo, { ...config.env, MWC_API_KEY: KEY }, { fetch: odd.fetch });
    expect(await failing.code).toBe(1);
    expect(failing.err()).toBe('mwc login: Internal server error\n');
    expect(existsSync(config.path)).toBe(false);
  });

  it('no key, and anything that is not a personal key, before calling the server', async () => {
    const config = tempConfig();
    const empty = run(loginTo, config.env, { stdin: piped(''), fetch: noFetch });
    expect(await empty.code).toBe(1);
    expect(empty.err()).toBe('mwc login: no API key: set MWC_API_KEY or pipe the key in\n');
    for (const key of [RUNNER_KEY, 'sk-not-ours', `${KEY}x`]) {
      const r = run(loginTo, { ...config.env, MWC_API_KEY: key }, { fetch: noFetch });
      expect(await r.code).toBe(1);
      expect(r.err()).toMatch(/that is not a personal API key/);
    }
  });

  it('the key as an argument (exit 2), without echoing it', async () => {
    const config = tempConfig();
    for (const argv of [
      [...loginTo, '--key', KEY],
      [...loginTo, `--api-key=${KEY}`],
      [...loginTo, '--token'],
      [...loginTo, KEY],
    ]) {
      const r = run(argv, config.env, { fetch: noFetch });
      expect(await r.code).toBe(2);
      expect(r.err()).toMatch(/never pass the key as an argument: it would stay in your shell history/);
      expect(r.err()).not.toContain(KEY.slice(7));
    }
  });

  it('missing or empty options and a server URL that is not one (exit 2)', async () => {
    const config = tempConfig();
    for (const argv of [
      [],
      ['--server', SERVER],
      ['--company', 'acme'],
      ['--server', '--company', 'acme'],
      ['--server', SERVER, '--company'],
    ]) {
      const r = run(argv, { ...config.env, MWC_API_KEY: KEY }, { fetch: noFetch });
      expect(await r.code).toBe(2);
      expect(r.err()).toContain('usage: mwc login --server <url> --company <id|slug>');
    }
    const bad = run(['--server', 'ftp://x', '--company', 'acme'], { ...config.env, MWC_API_KEY: KEY });
    expect(await bad.code).toBe(2);
    expect(bad.err()).toMatch(/must start with http/);
  });

  it('a credentials file it cannot write, saying why', async () => {
    const config = tempConfig();
    mkdirSync(config.root, { recursive: true });
    writeFileSync(config.dir, 'a file where the folder should be');
    const r = run(loginTo, { ...config.env, MWC_API_KEY: KEY });
    expect(await r.code).toBe(1);
    expect(r.err()).toMatch(/^mwc login: cannot save the login: /);
    expect(readFileSync(config.dir, 'utf8')).toBe('a file where the folder should be');
  });
});
