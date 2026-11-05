import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { hc } from 'hono/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppType } from '../../../../src/app.ts';
import {
  type AuthWorld,
  addPerson,
  authWorld,
  bearer,
  type Person,
  seedApiKey,
} from '../../../fixtures/auth.ts';
import {
  deleteLogo,
  GIF,
  getLogo,
  JPEG,
  logoForm,
  logoRow,
  PNG,
  pngOfSize,
  putLogo,
  SVG,
  sha256,
  WEBP,
} from '../../../fixtures/logos.ts';
import { addMember, type MembersCompany, membersCompany } from '../../../fixtures/members.ts';

let w: AuthWorld;
let company: MembersCompany;
let member: Person;
let viewer: Person;
let outsider: Person;
const token = (person: Person) => `fake:${person.subject}`;

beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  member = await addMember(w, company, 'member');
  viewer = await addMember(w, company, 'viewer');
  const other = await membersCompany(w);
  outsider = other.owner;
});
afterAll(() => w.t.close());

/** A company of its own (with its owner), so a test's logo does not meet another's. */
const freshCompany = () => membersCompany(w);

describe('PUT /api/companies/:companyId/logo', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ] as const)('stores a %s image, told by its first bytes', async (_, bytes, contentType) => {
    const co = await freshCompany();
    const res = await putLogo(w, token(co.owner), co.companyId, {
      bytes,
      name: 'logo.bin',
      type: 'application/octet-stream',
    });
    const hash = sha256(bytes);
    expect(res).toMatchObject({
      status: 200,
      body: {
        logo: { version: hash.slice(0, 16), contentType, size: bytes.length, updatedAt: expect.any(String) },
      },
    });
    const row = await logoRow(w.t.db, co.companyId);
    expect(row).toMatchObject({
      contentType,
      size: bytes.length,
      sha256: hash,
      updatedByPrincipalId: co.owner.principalId,
    });
    expect([...(row?.bytes ?? [])]).toEqual([...bytes]);
  });

  it('replaces the logo for an admin, and trusts neither the declared type nor the name', async () => {
    const co = await freshCompany();
    const second = await addMember(w, co, 'admin');
    expect((await putLogo(w, token(co.owner), co.companyId, { bytes: PNG })).status).toBe(200);
    const res = await putLogo(w, token(second), co.companyId, {
      bytes: JPEG,
      name: 'logo.png',
      type: 'image/png',
    });
    expect(res).toMatchObject({
      status: 200,
      body: { logo: { contentType: 'image/jpeg', size: JPEG.length } },
    });
    expect(await logoRow(w.t.db, co.companyId)).toMatchObject({
      contentType: 'image/jpeg',
      sha256: sha256(JPEG),
      updatedByPrincipalId: second.principalId,
    });
  });

  it.each([
    ['an SVG', SVG, 'logo.svg', 'image/svg+xml'],
    ['an SVG declared as a PNG', SVG, 'logo.png', 'image/png'],
    ['a GIF', GIF, 'logo.gif', 'image/gif'],
    [
      'a PNG name over bytes that only start like a JPEG',
      Uint8Array.from([0xff, 0xd8, 0x00, 0x10]),
      'logo.png',
      'image/png',
    ],
    ['a WebP signature cut short', WEBP.subarray(0, 10), 'logo.webp', 'image/webp'],
    ['text', new TextEncoder().encode('hello, logo'), 'logo.png', 'image/png'],
  ] as const)('refuses %s with 415 logo_type_unsupported', async (_, bytes, name, type) => {
    const co = await freshCompany();
    expect(await putLogo(w, token(co.owner), co.companyId, { bytes, name, type })).toMatchObject({
      status: 415,
      body: { error: { code: 'logo_type_unsupported' } },
    });
    expect(await logoRow(w.t.db, co.companyId)).toBeUndefined();
  });

  it('takes a logo of exactly 1 MB and refuses one byte more, before parsing as well as after', async () => {
    const co = await freshCompany();
    const largest = await putLogo(w, token(co.owner), co.companyId, { bytes: pngOfSize(LOGO_MAX_BYTES) });
    expect(largest).toMatchObject({ status: 200, body: { logo: { size: LOGO_MAX_BYTES } } });
    const tooLarge = { status: 413, body: { error: { code: 'logo_too_large' } } };
    // Within the multipart allowance: the form is parsed, then the file is refused.
    expect(
      await putLogo(w, token(co.owner), co.companyId, { bytes: pngOfSize(LOGO_MAX_BYTES + 1) }),
    ).toMatchObject(tooLarge);
    // Far over: the body limit stops it while reading, before any parsing.
    expect(
      await putLogo(w, token(co.owner), co.companyId, { bytes: pngOfSize(2 * LOGO_MAX_BYTES) }),
    ).toMatchObject(tooLarge);
    // A declared length over the limit is refused without reading the body.
    const declared = await putLogo(w, token(co.owner), co.companyId, new Uint8Array(16), {
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(2 * LOGO_MAX_BYTES),
      },
    });
    expect(declared).toMatchObject(tooLarge);
    expect((await logoRow(w.t.db, co.companyId))?.size).toBe(LOGO_MAX_BYTES);
  });

  it('refuses an empty file with 400 logo_empty, a form without a file with 400, and a body that is not a form with 415', async () => {
    const co = await freshCompany();
    expect(await putLogo(w, token(co.owner), co.companyId, { bytes: new Uint8Array() })).toMatchObject({
      status: 400,
      body: { error: { code: 'logo_empty' } },
    });
    const noFile = new FormData();
    noFile.append('logo', 'not a file');
    expect(await putLogo(w, token(co.owner), co.companyId, noFile)).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
    const asText = new FormData();
    asText.append('file', 'a string, not a file');
    expect((await putLogo(w, token(co.owner), co.companyId, asText)).status).toBe(400);
    const json = await putLogo(w, token(co.owner), co.companyId, JSON.stringify({ file: 'x' }), {
      headers: { 'content-type': 'application/json' },
    });
    expect(json).toMatchObject({ status: 415, body: { error: { code: 'unsupported_media_type' } } });
    expect(await logoRow(w.t.db, co.companyId)).toBeUndefined();
  });

  it('refuses a member and a viewer (403), anyone outside the company (404) and no credential (401)', async () => {
    for (const person of [member, viewer]) {
      expect(await putLogo(w, token(person), company.companyId, { bytes: PNG })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    for (const id of [company.companyId, 'not-an-id', '0190f5f0-0000-7000-8000-000000000000']) {
      expect(await putLogo(w, token(outsider), id, { bytes: PNG })).toMatchObject({
        status: 404,
        body: { error: { code: 'not_found' } },
      });
    }
    expect((await putLogo(w, undefined, company.companyId, { bytes: PNG })).status).toBe(401);
    expect(await logoRow(w.t.db, company.companyId)).toBeUndefined();
  });

  it("uploads with an admin's API key, and refuses a member's", async () => {
    const co = await freshCompany();
    const keyAdmin = await addMember(w, co, 'admin');
    const { key } = await seedApiKey(w.t.db, { companyId: co.companyId, principalId: keyAdmin.principalId });
    expect(await putLogo(w, key, co.companyId, { bytes: WEBP })).toMatchObject({
      status: 200,
      body: { logo: { contentType: 'image/webp' } },
    });
    const keyMember = await addPerson(w.t.db, w.fake, co.companyId, { role: 'member' });
    const theirs = await seedApiKey(w.t.db, { companyId: co.companyId, principalId: keyMember.principalId });
    expect((await putLogo(w, theirs.key, co.companyId, { bytes: PNG })).status).toBe(403);
    expect((await logoRow(w.t.db, co.companyId))?.updatedByPrincipalId).toBe(keyAdmin.principalId);
  });
});

describe('GET /api/companies/:companyId/logo', () => {
  let co: MembersCompany;
  let reader: Person;
  const hash = sha256(JPEG);
  beforeAll(async () => {
    co = await freshCompany();
    reader = await addMember(w, co, 'viewer');
    await putLogo(w, token(co.owner), co.companyId, { bytes: JPEG, name: 'logo.png', type: 'image/png' });
  });

  it('sends the image with its stored type and the safety headers to any member, a viewer included', async () => {
    const res = await getLogo(w, token(reader), co.companyId);
    expect(res.status).toBe(200);
    expect([...res.bytes]).toEqual([...JPEG]);
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'image/jpeg',
      etag: `"${hash}"`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      'content-disposition': 'inline',
      'cache-control': 'private, no-cache',
    });
  });

  it('may be cached for good when asked for by its current version, and is revalidated otherwise', async () => {
    const current = await getLogo(w, token(reader), co.companyId, { v: hash.slice(0, 16) });
    expect(current.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const stale = await getLogo(w, token(reader), co.companyId, { v: sha256(PNG).slice(0, 16) });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('answers 304 to an If-None-Match that names the logo, and the image to one that does not', async () => {
    for (const ifNoneMatch of [`"${hash}"`, `W/"${hash}"`, `"other", "${hash}"`, '*']) {
      const res = await getLogo(w, token(reader), co.companyId, { ifNoneMatch });
      expect(res.status, ifNoneMatch).toBe(304);
      expect(res.bytes).toHaveLength(0);
      expect(res.headers.get('etag')).toBe(`"${hash}"`);
      expect(res.headers.get('cache-control')).toBe('private, no-cache');
    }
    const cached = await getLogo(w, token(reader), co.companyId, {
      ifNoneMatch: `"${hash}"`,
      v: hash.slice(0, 16),
    });
    expect(cached.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const changed = await getLogo(w, token(reader), co.companyId, { ifNoneMatch: `"${sha256(PNG)}"` });
    expect(changed.status).toBe(200);
  });

  it('is 404 logo_not_found without a logo, 404 not_found outside the company and 401 without a credential', async () => {
    const empty = await freshCompany();
    const res = await w.t.app.request(`/api/companies/${empty.companyId}/logo`, {
      headers: { authorization: `Bearer ${token(empty.owner)}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'logo_not_found' } });
    expect((await getLogo(w, token(outsider), co.companyId)).status).toBe(404);
    expect((await getLogo(w, undefined, co.companyId)).status).toBe(401);
  });

  it("reads with a viewer's API key", async () => {
    const { key } = await seedApiKey(w.t.db, { companyId: co.companyId, principalId: reader.principalId });
    const res = await getLogo(w, key, co.companyId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });
});

describe('DELETE /api/companies/:companyId/logo', () => {
  it('removes the logo for an admin, and is a 204 again when there is none', async () => {
    const co = await freshCompany();
    const remover = await addMember(w, co, 'admin');
    await putLogo(w, token(co.owner), co.companyId, { bytes: PNG });
    expect(await deleteLogo(w, token(remover), co.companyId)).toEqual({ status: 204, body: null });
    expect(await logoRow(w.t.db, co.companyId)).toBeUndefined();
    expect((await getLogo(w, token(remover), co.companyId)).status).toBe(404);
    expect(await deleteLogo(w, token(co.owner), co.companyId)).toEqual({ status: 204, body: null });
  });

  it('refuses a member and a viewer (403), anyone outside the company (404) and no credential (401)', async () => {
    const co = await freshCompany();
    await putLogo(w, token(co.owner), co.companyId, { bytes: PNG });
    for (const role of ['member', 'viewer'] as const) {
      const person = await addMember(w, co, role);
      expect(await deleteLogo(w, token(person), co.companyId)).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    expect((await deleteLogo(w, token(outsider), co.companyId)).status).toBe(404);
    expect((await deleteLogo(w, undefined, co.companyId)).status).toBe(401);
    expect(await logoRow(w.t.db, co.companyId)).toBeDefined();
  });
});

describe('the logo routes for clients', () => {
  it("takes the upload of the web's typed client, $put({ param, form: { file } })", async () => {
    const co = await freshCompany();
    const client = hc<AppType>('http://api.test', {
      fetch: (input: string | URL | Request, init?: RequestInit) => w.t.app.request(input, init),
      headers: bearer(token(co.owner)),
    });
    const logo = client.api.companies[':companyId'].logo;
    const file = new File([JPEG], 'logo.jpg', { type: 'image/jpeg' });
    const res = await logo.$put({ param: { companyId: co.companyId }, form: { file } });
    if (res.status !== 200) throw new Error(`PUT logo answered ${res.status}`);
    const { logo: stored } = await res.json();
    expect(stored).toMatchObject({ version: sha256(JPEG).slice(0, 16), contentType: 'image/jpeg' });
    const read = await logo.$get({ param: { companyId: co.companyId }, query: { v: stored.version } });
    expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await logo.$delete({ param: { companyId: co.companyId } })).status).toBe(204);
  });

  it('documents the multipart upload, the image and the refusals', async () => {
    const doc = (await (await w.t.app.request('/api/openapi.json')).json()) as {
      paths: Record<string, Record<string, { requestBody?: unknown; responses: Record<string, unknown> }>>;
    };
    const logo = doc.paths['/api/companies/{companyId}/logo'];
    expect(Object.keys(logo ?? {}).sort()).toEqual(['delete', 'get', 'put']);
    expect(logo?.put?.requestBody).toMatchObject({
      content: { 'multipart/form-data': { schema: { $ref: '#/components/schemas/LogoUpload' } } },
    });
    expect(Object.keys(logo?.put?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '413', '415']),
    );
    expect(Object.keys(logo?.get?.responses ?? {})).toEqual(expect.arrayContaining(['200', '304', '404']));
    expect(logoForm({ bytes: PNG }).get('file')).toBeInstanceOf(File);
  });
});
