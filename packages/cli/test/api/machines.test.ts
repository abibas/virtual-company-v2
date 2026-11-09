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

  it("reads the API's own address, whether it drives the devboxes and its compose file from /api/config, and nothing else of it", async () => {
    const api = answering({ apiUrl: 'http://localhost:9950', publicUrl: 'https://corp.example.com' });
    expect(await getPublicConfig(api.fetch, SERVER, KEY)).toEqual({
      ok: true,
      body: { apiUrl: 'http://localhost:9950', localPower: false, composeFile: null },
    });
    expect(api.calls).toEqual([`GET ${SERVER}/api/config`]);
    const driving = answering({ apiUrl: 'http://localhost:9950', localPower: true });
    expect(await getPublicConfig(driving.fetch, SERVER, KEY)).toMatchObject({ body: { localPower: true } });
    const dev = answering({ apiUrl: 'http://localhost:9950', composeFile: '/r/deploy/compose.yml' });
    expect(await getPublicConfig(dev.fetch, SERVER, KEY)).toMatchObject({
      body: { composeFile: '/r/deploy/compose.yml' },
    });
    expect(await getPublicConfig(answering({}, 503).fetch, SERVER, KEY)).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});
