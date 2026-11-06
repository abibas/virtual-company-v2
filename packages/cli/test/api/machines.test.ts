import { describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/api/client.ts';
import { createEnrollmentToken, getPublicConfig } from '../../src/api/machines.ts';

const SERVER = 'http://mwc.test';
const KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';

/** A fetch answering `body` with `status`, recording each call's method and URL. */
function answering(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    return Response.json(body, { status });
  };
  return { fetch, calls };
}

describe('the machines API', () => {
  it("posts for a company's enrollment token and takes the 201", async () => {
    const token = { id: 'e1', token: 'mwc_et_x', expiresAt: '2026-11-06T13:00:00.000Z' };
    const api = answering(token, 201);
    expect(await createEnrollmentToken(api.fetch, SERVER, KEY, 'c 1')).toEqual({ ok: true, body: token });
    expect(api.calls).toEqual([`POST ${SERVER}/api/companies/c%201/machines/enrollment-tokens`]);
    expect(await createEnrollmentToken(answering({ id: 'e1' }, 201).fetch, SERVER, KEY, 'c')).toMatchObject({
      ok: false,
      code: 'bad_response',
    });
  });

  it('reads the public address from /api/config, null when the server has none or does not say', async () => {
    const api = answering({ apiUrl: 'http://localhost:9950', publicUrl: 'https://corp.ngrok.app' });
    expect(await getPublicConfig(api.fetch, SERVER, KEY)).toEqual({
      ok: true,
      body: { apiUrl: 'http://localhost:9950', publicUrl: 'https://corp.ngrok.app' },
    });
    expect(api.calls).toEqual([`GET ${SERVER}/api/config`]);
    const older = answering({ apiUrl: 'http://localhost:9950' });
    expect(await getPublicConfig(older.fetch, SERVER, KEY)).toMatchObject({ body: { publicUrl: null } });
    expect(await getPublicConfig(answering({}, 503).fetch, SERVER, KEY)).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});
