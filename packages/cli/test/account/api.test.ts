import { describe, expect, it } from 'vitest';
import { getMe } from '../../src/account/api.ts';
import { ACME, fakeApi, KEY, meBody, REFUSED, SERVER } from '../fixtures/account.ts';

describe('getMe', () => {
  it('calls GET <server>/api/me with the key as the bearer and a timeout', async () => {
    const api = fakeApi();
    expect(await getMe(api.fetch, SERVER, KEY)).toEqual({ ok: true, me: meBody() });
    expect(api.calls).toEqual([{ url: `${SERVER}/api/me`, authorization: `Bearer ${KEY}`, signal: true }]);
  });

  it("returns the server's refusal: its status, code and message", async () => {
    expect(await getMe(fakeApi({ [KEY]: REFUSED }).fetch, SERVER, KEY)).toEqual({
      ok: false,
      status: 401,
      code: 'unauthenticated',
      message: 'The API key was revoked',
    });
  });

  it('makes a code and a message from the status when the error body is not ours', async () => {
    for (const body of ['<html>oops</html>', { error: 'nope' }, { error: { code: 7 } }]) {
      expect(await getMe(fakeApi({ [KEY]: { status: 502, body } }).fetch, SERVER, KEY)).toEqual({
        ok: false,
        status: 502,
        code: 'http_502',
        message: 'the server answered 502',
      });
    }
  });

  it('says when the server cannot be reached or does not answer like this API', async () => {
    const down = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9950'));
    expect(await getMe(down, SERVER, KEY)).toEqual({
      ok: false,
      status: 0,
      code: 'unreachable',
      message: `cannot reach ${SERVER}: connect ECONNREFUSED 127.0.0.1:9950`,
    });
    const refused = () => Promise.reject(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }));
    expect(await getMe(refused, SERVER, KEY)).toMatchObject({
      code: 'unreachable',
      message: `cannot reach ${SERVER}: fetch failed (ECONNREFUSED)`,
    });
    for (const body of [
      'not json',
      { user: {} },
      { ...meBody(), memberships: [{ companyId: ACME.companyId }] },
      {
        ...meBody(),
        session: null,
      },
    ]) {
      expect(await getMe(fakeApi({ [KEY]: { status: 200, body } }).fetch, SERVER, KEY)).toMatchObject({
        ok: false,
        status: 0,
        code: 'bad_response',
      });
    }
  });
});
