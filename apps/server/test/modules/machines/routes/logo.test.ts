import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MachineStatsListView } from '../../../../src/modules/machines/schemas/stats.ts';
import type { MachineView } from '../../../../src/modules/machines/schemas.ts';
import { GIF, JPEG, PNG, pngOfSize, SVG, sha256, WEBP } from '../../../fixtures/companies/logos.ts';
import {
  deleteMachineLogo,
  getMachineLogo,
  machineLogoRow,
  putMachineLogo,
} from '../../../fixtures/machines/logos.ts';
import { auditOf, DEVBOX, enroll, machinesPath } from '../../../fixtures/machines/machines.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
let member: Person;
let viewer: Person;
let other: MembersCompany;
const token = (person: Person) => `fake:${person.subject}`;

beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  admin = await addMember(w, company, 'admin');
  member = await addMember(w, company, 'member');
  viewer = await addMember(w, company, 'viewer');
  other = await membersCompany(w);
});
afterAll(() => w.t.close());

/** A machine of its own in the company, so a test's logo does not meet another's. */
async function freshMachine(co: MembersCompany = company) {
  const { machineId } = await enroll(w, co);
  return { companyId: co.companyId, machineId };
}

const MISSING = '019a5b2e-0000-7000-8000-000000000000';

describe('PUT /api/companies/:companyId/machines/:machineId/logo', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
  ] as const)(
    'stores a %s image for the owner, told by its first bytes, and audits it',
    async (_, bytes, type) => {
      const path = await freshMachine();
      const res = await putMachineLogo(w, token(company.owner), path, {
        bytes,
        name: 'logo.bin',
        type: 'application/octet-stream',
      });
      const hash = sha256(bytes);
      expect(res).toMatchObject({
        status: 200,
        body: { logo: { version: hash.slice(0, 16), contentType: type, size: bytes.length } },
      });
      const row = await machineLogoRow(w.t.db, path.machineId);
      expect(row).toMatchObject({
        companyId: company.companyId,
        contentType: type,
        sha256: hash,
        updatedByPrincipalId: company.owner.principalId,
      });
      expect([...(row?.bytes ?? [])]).toEqual([...bytes]);
      expect(await auditOf(w.t.db, 'machine', path.machineId)).toContain('update logo');
    },
  );

  it('replaces the logo for an admin', async () => {
    const path = await freshMachine();
    expect((await putMachineLogo(w, token(company.owner), path, { bytes: PNG })).status).toBe(200);
    expect(await putMachineLogo(w, token(admin), path, { bytes: JPEG, type: 'image/png' })).toMatchObject({
      status: 200,
      body: { logo: { contentType: 'image/jpeg' } },
    });
    expect(await machineLogoRow(w.t.db, path.machineId)).toMatchObject({
      sha256: sha256(JPEG),
      updatedByPrincipalId: admin.principalId,
    });
    const logos = (await auditOf(w.t.db, 'machine', path.machineId)).filter((row) => row === 'update logo');
    expect(logos).toHaveLength(2);
  });

  it('refuses an SVG, a GIF and text (415), an empty file (400) and one over 1 MB (413), as the company logo', async () => {
    const path = await freshMachine();
    for (const bytes of [SVG, GIF, new TextEncoder().encode('hello')]) {
      expect(await putMachineLogo(w, token(admin), path, { bytes })).toMatchObject({
        status: 415,
        body: { error: { code: 'logo_type_unsupported' } },
      });
    }
    expect(await putMachineLogo(w, token(admin), path, { bytes: new Uint8Array() })).toMatchObject({
      status: 400,
      body: { error: { code: 'logo_empty' } },
    });
    const tooLarge = { status: 413, body: { error: { code: 'logo_too_large' } } };
    expect(
      await putMachineLogo(w, token(admin), path, { bytes: pngOfSize(LOGO_MAX_BYTES + 1) }),
    ).toMatchObject(tooLarge);
    expect(
      await putMachineLogo(w, token(admin), path, { bytes: pngOfSize(2 * LOGO_MAX_BYTES) }),
    ).toMatchObject(tooLarge);
    expect(await machineLogoRow(w.t.db, path.machineId)).toBeUndefined();
    expect(await putMachineLogo(w, token(admin), path, { bytes: pngOfSize(LOGO_MAX_BYTES) })).toMatchObject({
      status: 200,
      body: { logo: { size: LOGO_MAX_BYTES } },
    });
  });

  it("refuses a member and a viewer (403), another company's or a removed machine (404) and no credential (401)", async () => {
    const path = await freshMachine();
    for (const person of [member, viewer]) {
      expect(await putMachineLogo(w, token(person), path, { bytes: PNG })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    const theirs = await freshMachine(other);
    for (const machineId of [theirs.machineId, MISSING, 'not-a-uuid']) {
      expect(
        await putMachineLogo(
          w,
          token(company.owner),
          { companyId: company.companyId, machineId },
          { bytes: PNG },
        ),
      ).toMatchObject({ status: 404, body: { error: { code: 'machine_not_found' } } });
    }
    expect(await putMachineLogo(w, token(other.owner), path, { bytes: PNG })).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
    expect((await putMachineLogo(w, undefined, path, { bytes: PNG })).status).toBe(401);
    expect(await machineLogoRow(w.t.db, path.machineId)).toBeUndefined();
    expect(await machineLogoRow(w.t.db, theirs.machineId)).toBeUndefined();
    expect((await as(w, company.owner)('DELETE', machinesPath(company, `/${path.machineId}`))).status).toBe(
      204,
    );
    expect(await putMachineLogo(w, token(company.owner), path, { bytes: PNG })).toMatchObject({
      status: 404,
      body: { error: { code: 'machine_not_found' } },
    });
  });
});

describe('GET /api/companies/:companyId/machines/:machineId/logo', () => {
  it('sends the image to any member, cached for good by its version, with a 304 for its ETag', async () => {
    const path = await freshMachine();
    await putMachineLogo(w, token(admin), path, { bytes: PNG });
    const hash = sha256(PNG);
    const res = await getMachineLogo(w, token(viewer), path);
    expect(res.status).toBe(200);
    expect([...res.bytes]).toEqual([...PNG]);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    const versioned = await getMachineLogo(w, token(member), path, { v: hash.slice(0, 16) });
    expect(versioned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const again = await getMachineLogo(w, token(viewer), path, { ifNoneMatch: `"${hash}"` });
    expect(again.status).toBe(304);
    expect(again.bytes).toHaveLength(0);
  });

  it("is a 404 for a machine without a logo, another company's or an unknown machine, and a non-member", async () => {
    const path = await freshMachine();
    expect(await getMachineLogo(w, token(viewer), path)).toMatchObject({
      status: 404,
      body: { error: { code: 'logo_not_found' } },
    });
    const theirs = await freshMachine(other);
    await putMachineLogo(w, token(other.owner), theirs, { bytes: PNG });
    for (const machineId of [theirs.machineId, MISSING]) {
      expect(
        await getMachineLogo(w, token(company.owner), { companyId: company.companyId, machineId }),
      ).toMatchObject({ status: 404, body: { error: { code: 'machine_not_found' } } });
    }
    expect((await getMachineLogo(w, token(other.owner), path)).status).toBe(404);
    expect((await getMachineLogo(w, undefined, path)).status).toBe(401);
  });
});

describe('DELETE /api/companies/:companyId/machines/:machineId/logo', () => {
  it('removes the logo for an admin, audited, and is fine when there is none', async () => {
    const path = await freshMachine();
    await putMachineLogo(w, token(company.owner), path, { bytes: PNG });
    expect(await deleteMachineLogo(w, token(admin), path)).toEqual({ status: 204, body: null });
    expect(await machineLogoRow(w.t.db, path.machineId)).toBeUndefined();
    expect(await deleteMachineLogo(w, token(admin), path)).toEqual({ status: 204, body: null });
    const logos = (await auditOf(w.t.db, 'machine', path.machineId)).filter((row) => row === 'update logo');
    expect(logos).toHaveLength(2);
  });

  it("refuses a member and a viewer (403), another company's machine (404) and no credential (401)", async () => {
    const path = await freshMachine();
    await putMachineLogo(w, token(company.owner), path, { bytes: PNG });
    for (const person of [member, viewer]) {
      expect((await deleteMachineLogo(w, token(person), path)).status).toBe(403);
    }
    const theirs = await freshMachine(other);
    await putMachineLogo(w, token(other.owner), theirs, { bytes: PNG });
    expect(
      await deleteMachineLogo(w, token(company.owner), {
        companyId: company.companyId,
        machineId: theirs.machineId,
      }),
    ).toMatchObject({ status: 404, body: { error: { code: 'machine_not_found' } } });
    expect((await deleteMachineLogo(w, undefined, path)).status).toBe(401);
    expect(await machineLogoRow(w.t.db, path.machineId)).toBeDefined();
    expect(await machineLogoRow(w.t.db, theirs.machineId)).toBeDefined();
  });
});

describe("the machine's logo in the machines, a machine and the home board's stats", () => {
  it('names the version of a machine with a logo and null for one without', async () => {
    const co = await membersCompany(w);
    const mac = await enroll(w, co);
    const box = await enroll(w, co, DEVBOX);
    await putMachineLogo(
      w,
      token(co.owner),
      { companyId: co.companyId, machineId: mac.machineId },
      { bytes: WEBP },
    );
    const version = sha256(WEBP).slice(0, 16);
    const list = (await as(w, co.owner)('GET', machinesPath(co))).body as { machines: MachineView[] };
    const logos = Object.fromEntries(list.machines.map((machine) => [machine.id, machine.logo]));
    expect(logos).toEqual({ [mac.machineId]: { version }, [box.machineId]: null });
    expect(await as(w, co.owner)('GET', machinesPath(co, `/${mac.machineId}`))).toMatchObject({
      status: 200,
      body: { logo: { version } },
    });
    expect(
      await as(w, co.owner)('PATCH', machinesPath(co, `/${mac.machineId}`), { name: 'Logo Mac' }),
    ).toMatchObject({ status: 200, body: { logo: { version } } });
    const stats = (await as(w, co.owner)('GET', machinesPath(co, '/stats'))).body as MachineStatsListView;
    const statLogos = Object.fromEntries(stats.machines.map((machine) => [machine.machineId, machine.logo]));
    expect(statLogos).toEqual({ [mac.machineId]: { version }, [box.machineId]: null });
  });
});
