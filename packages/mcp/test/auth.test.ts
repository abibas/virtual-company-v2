import { mkdirSync, writeFileSync } from 'node:fs';
import { saveLogin } from '@mwc/cli/credentials';
import { describe, expect, it } from 'vitest';
import { NOT_LOGGED_IN, resolveAuth } from '../src/auth.ts';
import { callTool, connect, tempConfig } from './fixtures/world.ts';

const KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';
const SAVED_KEY = 'mwc_pk_Hh2KjL4mNn6PpQ8rRs0TtU1vVw3XxY5z';
const SAVED = { server: 'http://saved.test', companyId: 'c1', companySlug: 'acme', key: SAVED_KEY };

/** A config folder with one saved login (`SAVED`). */
function savedConfig() {
  const config = tempConfig();
  saveLogin(config.path, SAVED);
  return config;
}

describe('resolveAuth', () => {
  it('takes MWC_SERVER_URL and MWC_API_KEY from the environment over the saved login', () => {
    const { env } = savedConfig();
    expect(resolveAuth({ ...env, MWC_SERVER_URL: 'http://env.test/', MWC_API_KEY: ` ${KEY} ` })).toEqual({
      ok: true,
      value: { server: 'http://env.test', key: KEY, source: 'env' },
    });
  });

  it("accepts the CLI's MWC_SERVER as well, MWC_SERVER_URL winning", () => {
    const env = { MWC_API_KEY: KEY, MWC_SERVER: 'http://cli.test', ...tempConfig().env };
    expect(resolveAuth(env)).toMatchObject({ ok: true, value: { server: 'http://cli.test' } });
    expect(resolveAuth({ ...env, MWC_SERVER_URL: 'http://url.test' })).toMatchObject({
      value: { server: 'http://url.test' },
    });
  });

  it('never reads the credentials file when the environment has both, so a broken one is no trouble', () => {
    const config = tempConfig();
    mkdirSync(config.dir, { recursive: true });
    writeFileSync(config.path, '{ broken');
    const env = { ...config.env, MWC_SERVER_URL: 'http://env.test', MWC_API_KEY: KEY };
    expect(resolveAuth(env)).toMatchObject({ ok: true, value: { source: 'env' } });
    expect(resolveAuth({ ...config.env, MWC_API_KEY: KEY })).toEqual({
      ok: false,
      message: expect.stringMatching(/is not valid JSON/),
    });
  });

  it('uses the saved login of mwc login otherwise, and its server for a key from the environment', () => {
    const { env } = savedConfig();
    expect(resolveAuth(env)).toEqual({
      ok: true,
      value: { server: SAVED.server, key: SAVED_KEY, source: 'file', saved: SAVED },
    });
    expect(resolveAuth({ ...env, MWC_API_KEY: KEY })).toEqual({
      ok: true,
      value: { server: SAVED.server, key: KEY, source: 'env' },
    });
  });

  it('says how to log in when there is no login, and why a server URL is refused', () => {
    expect(resolveAuth(tempConfig().env)).toEqual({ ok: false, message: NOT_LOGGED_IN });
    expect(resolveAuth({ ...tempConfig().env, MWC_SERVER_URL: 'http://env.test' })).toEqual({
      ok: false,
      message: NOT_LOGGED_IN,
    });
    expect(resolveAuth({ ...tempConfig().env, MWC_SERVER_URL: 'ftp://x', MWC_API_KEY: KEY })).toEqual({
      ok: false,
      message: 'the server URL must start with http:// or https://, not ftp://',
    });
  });

  it('turns a login problem into a tool error, never a crash', async () => {
    const config = tempConfig();
    mkdirSync(config.dir, { recursive: true });
    writeFileSync(config.path, '[]');
    const client = await connect(config.env, () => Promise.reject(new Error('fetch was called')));
    const r = await callTool(client, 'org_chart');
    expect(r.isError).toBe(true);
    expect(r.texts[0]).toMatch(/is not an mwc credentials file/);
  });
});
