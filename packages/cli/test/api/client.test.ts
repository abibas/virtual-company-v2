import { describe, expect, it } from 'vitest';
import { apiGet, type Fetch, isObject } from '../../src/api/client.ts';

const SERVER = 'http://mwc.test';
const KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';

/** A fetch that answers every call with `body` and records the URLs and headers it was given. */
function answering(body: unknown, status = 200) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, headers: new Headers(init.headers) });
    return Response.json(body, { status });
  };
  return { fetch, calls };
}

const isNamed = (body: unknown): body is { name: string } => isObject(body) && typeof body.name === 'string';

describe('apiGet', () => {
  it('gets <server><path> with the key as the bearer and gives the body its guard accepts', async () => {
    const api = answering({ name: 'Acme' });
    expect(await apiGet(api.fetch, SERVER, KEY, '/api/x?y=1', isNamed)).toEqual({
      ok: true,
      body: { name: 'Acme' },
    });
    expect(api.calls.map((c) => [c.url, c.headers.get('authorization'), c.headers.get('accept')])).toEqual([
      [`${SERVER}/api/x?y=1`, `Bearer ${KEY}`, 'application/json'],
    ]);
  });

  it('refuses a 200 whose body the guard does not accept, and passes refusals on', async () => {
    expect(await apiGet(answering({ name: 7 }).fetch, SERVER, KEY, '/api/x', isNamed)).toEqual({
      ok: false,
      status: 0,
      code: 'bad_response',
      message: `${SERVER} does not answer like the mwc API`,
    });
    const refused = answering({ error: { code: 'forbidden', message: 'Admins only', requestId: 'r' } }, 403);
    expect(await apiGet(refused.fetch, SERVER, KEY, '/api/x', isNamed)).toEqual({
      ok: false,
      status: 403,
      code: 'forbidden',
      message: 'Admins only',
    });
  });

  it('tells objects from everything else', () => {
    expect([{}, [], null, 'x', 1].map(isObject)).toEqual([true, true, false, false, false]);
  });
});
