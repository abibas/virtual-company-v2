import type { Fetch } from '@mwc/cli/api/client';
import { saveLogin } from '@mwc/cli/credentials';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOT_LOGGED_IN } from '../../src/auth.ts';
import {
  callTool,
  connect,
  keyEnv,
  type McpWorld,
  mcpWorld,
  RUNNER_KEY,
  SERVER,
  tempConfig,
  UNKNOWN_KEY,
} from '../fixtures/world.ts';

let w: McpWorld;
beforeAll(async () => {
  w = await mcpWorld();
});
afterAll(() => w.t.close());

describe('me', () => {
  it('answers who the key acts as and its company, as text and as JSON', async () => {
    const r = await callTool(await connect(keyEnv(w), w.fetch), 'me');
    expect(r.isError).toBe(false);
    const prefix = w.key.slice(0, 11);
    expect(r.texts[0]).toBe(
      `You are Olga <olga@acme.test> on ${SERVER}, with the key ${prefix}... (env).\n` +
        'Company: Acme (acme), your role owner, membership active.',
    );
    expect(JSON.parse(r.texts[1] ?? '')).toEqual({
      server: SERVER,
      user: { id: expect.any(String), email: 'olga@acme.test', displayName: 'Olga' },
      key: { prefix, source: 'env' },
      companies: [{ id: w.company.id, slug: 'acme', name: 'Acme', role: 'owner', status: 'active' }],
    });
    expect(r.texts.join('')).not.toContain(w.key.slice(11));
  });

  it('reads the saved login of mwc login when the environment has no key', async () => {
    const config = tempConfig();
    saveLogin(config.path, { server: SERVER, companyId: w.company.id, companySlug: 'acme', key: w.key });
    const r = await callTool(await connect(config.env, w.fetch), 'me');
    expect(r.texts[0]).toMatch(/\(mwc login\)\.\n/);
    expect(JSON.parse(r.texts[1] ?? '').key.source).toBe('mwc login');
  });

  it('says so when the key has no company left, and names a person by their email when they have no name', async () => {
    const me = { id: 'u1', email: 'ann@acme.test', displayName: null, imageUrl: null };
    const alone: Fetch = async () =>
      Response.json({ user: me, memberships: [], session: { via: 'api_key' } });
    const r = await callTool(await connect(keyEnv(w), alone), 'me');
    expect(r.texts[0]).toBe(
      `You are ann@acme.test <ann@acme.test> on ${SERVER}, with the key ${w.key.slice(0, 11)}... (env).\n` +
        "The key's company is not available any more (deleted, or you are no longer a member).",
    );
  });

  it('answers tool errors for no login, a key that is not personal and a key the server refuses', async () => {
    expect(await callTool(await connect(tempConfig().env, w.fetch), 'me')).toEqual({
      isError: true,
      texts: [NOT_LOGGED_IN],
    });
    const runner = await callTool(await connect(keyEnv(w, RUNNER_KEY), w.fetch), 'me');
    expect(runner).toEqual({
      isError: true,
      texts: ['the key from MWC_API_KEY is not a personal API key (mwc_pk_ and 32 letters or digits)'],
    });
    const refused = await callTool(await connect(keyEnv(w, UNKNOWN_KEY), w.fetch), 'me');
    expect(refused.isError).toBe(true);
    expect(refused.texts[0]).toMatch(/refused the key \(.+\)\. Make a new key and run mwc login again\.$/);
    const away = await callTool(
      await connect(keyEnv(w), () => Promise.reject(new Error('ECONNREFUSED'))),
      'me',
    );
    expect(away).toEqual({ isError: true, texts: [`cannot reach ${SERVER}: ECONNREFUSED`] });
  });
});
