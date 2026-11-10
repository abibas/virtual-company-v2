import { agentIcons, agents, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { LOGO_MAX_BYTES } from '@mwc/shared/logos';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentView, OrgChartView } from '../../../../src/modules/org/schemas.ts';
import {
  GIF,
  JPEG,
  logoForm,
  PNG,
  pngOfSize,
  SVG,
  sha256,
  type Upload,
  WEBP,
} from '../../../fixtures/companies/logos.ts';
import { addMember, as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { agentsPath, chartPath, fieldAudit, makeAgent } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, bearer, type Person } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
let member: Person;
let viewer: Person;
let other: MembersCompany;

beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  admin = await addMember(w, company, 'admin');
  member = await addMember(w, company, 'member');
  viewer = await addMember(w, company, 'viewer');
  other = await membersCompany(w);
});
afterAll(() => w.t.close());

const MISSING = '019a5b2e-0000-7000-8000-000000000000';
const iconPath = (co: MembersCompany, agentId: string, query = '') =>
  `${agentsPath(co, agentId)}/icon${query}`;
const headers = (person: Person | undefined, extra: Record<string, string> = {}) => ({
  ...(person === undefined ? {} : bearer(`fake:${person.subject}`)),
  ...extra,
});

async function jsonOf(res: Response) {
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text) };
}

/** `PUT .../icon` with an upload, as `person` (none: no credential). */
async function putIcon(person: Person | undefined, agentId: string, upload: Upload, co = company) {
  const init = { method: 'PUT', body: logoForm(upload), headers: headers(person) };
  return jsonOf(await w.t.app.request(iconPath(co, agentId), init));
}

/** `GET .../icon`, with the bytes. */
async function getIcon(
  person: Person | undefined,
  agentId: string,
  options: { v?: string; etag?: string } = {},
) {
  const query = options.v === undefined ? '' : `?v=${options.v}`;
  const extra = options.etag === undefined ? {} : { 'if-none-match': options.etag };
  const res = await w.t.app.request(iconPath(company, agentId, query), { headers: headers(person, extra) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const json = res.headers.get('content-type')?.startsWith('application/json');
  return {
    status: res.status,
    bytes,
    headers: res.headers,
    body: json ? JSON.parse(new TextDecoder().decode(bytes)) : null,
  };
}

const patchIcon = (person: Person, agentId: string, body: unknown, co = company) =>
  as(w, person)('PATCH', iconPath(co, agentId), body);
const deleteIcon = (person: Person, agentId: string, co = company) =>
  as(w, person)('DELETE', iconPath(co, agentId));

const iconRow = async (db: DbHandle, agentId: string) =>
  (await rawDb(db).select().from(agentIcons).where(eq(agentIcons.agentId, agentId)))[0];
const agentRow = async (db: DbHandle, agentId: string) =>
  (await rawDb(db).select().from(agents).where(eq(agents.id, agentId)))[0];

const freshAgent = async (co = company) => (await makeAgent(w, co, co.owner, { name: 'Icon agent' })).id;
const versionOf = (bytes: Uint8Array) => sha256(bytes).slice(0, 16);

describe('PUT /api/companies/:companyId/agents/:agentId/icon', () => {
  it.each([
    ['PNG', PNG, 'image/png'],
    ['JPEG', JPEG, 'image/jpeg'],
    ['WebP', WEBP, 'image/webp'],
    ['GIF', GIF, 'image/gif'],
  ] as const)('stores a %s image, told by its first bytes, and audits it', async (_, bytes, type) => {
    const agentId = await freshAgent();
    const res = await putIcon(admin, agentId, { bytes, name: 'icon.bin', type: 'application/octet-stream' });
    expect(res).toEqual({ status: 200, body: { icon: { kind: 'image', version: versionOf(bytes) } } });
    const row = await iconRow(w.t.db, agentId);
    expect(row).toMatchObject({
      contentType: type,
      sha256: sha256(bytes),
      updatedByPrincipalId: admin.principalId,
    });
    expect([...(row?.bytes ?? [])]).toEqual([...bytes]);
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'image', iconEmoji: null });
    const audit = (await fieldAudit(w.t.db, 'agent', agentId, 'icon')).map((row) => [
      row[0],
      row[1],
      row[2],
      row[4],
      row[5],
    ]);
    expect(audit).toEqual([
      [
        company.companyId,
        'update',
        admin.principalId,
        { kind: 'face' },
        { kind: 'image', sha256: sha256(bytes) },
      ],
    ]);
  });

  it('replaces an emoji and an earlier image', async () => {
    const agentId = await freshAgent();
    expect((await patchIcon(admin, agentId, { kind: 'emoji', emoji: '🤖' })).status).toBe(200);
    expect((await putIcon(company.owner, agentId, { bytes: PNG })).status).toBe(200);
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'image', iconEmoji: null });
    expect(await putIcon(admin, agentId, { bytes: JPEG })).toMatchObject({
      status: 200,
      body: { icon: { version: versionOf(JPEG) } },
    });
    expect(await iconRow(w.t.db, agentId)).toMatchObject({
      sha256: sha256(JPEG),
      updatedByPrincipalId: admin.principalId,
    });
    const changes = (await fieldAudit(w.t.db, 'agent', agentId, 'icon')).map((row) => row[5]);
    expect(changes).toEqual([
      { kind: 'emoji', emoji: '🤖' },
      { kind: 'image', sha256: sha256(PNG) },
      { kind: 'image', sha256: sha256(JPEG) },
    ]);
  });

  it('refuses an SVG and text (415), an empty file (400) and one over 1 MB (413), and takes exactly 1 MB', async () => {
    const agentId = await freshAgent();
    for (const bytes of [
      SVG,
      new TextEncoder().encode('hello'),
      Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x30, 0x61]),
    ]) {
      expect(await putIcon(admin, agentId, { bytes })).toMatchObject({
        status: 415,
        body: { error: { code: 'icon_type_unsupported' } },
      });
    }
    expect(await putIcon(admin, agentId, { bytes: new Uint8Array() })).toMatchObject({
      status: 400,
      body: { error: { code: 'icon_empty' } },
    });
    const tooLarge = { status: 413, body: { error: { code: 'icon_too_large' } } };
    expect(await putIcon(admin, agentId, { bytes: pngOfSize(LOGO_MAX_BYTES + 1) })).toMatchObject(tooLarge);
    expect(await putIcon(admin, agentId, { bytes: pngOfSize(2 * LOGO_MAX_BYTES) })).toMatchObject(tooLarge);
    expect(await iconRow(w.t.db, agentId)).toBeUndefined();
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'face' });
    expect((await putIcon(admin, agentId, { bytes: pngOfSize(LOGO_MAX_BYTES) })).status).toBe(200);
  });

  it("refuses a member and a viewer (403), another company's or an unknown agent (404) and no credential (401)", async () => {
    const agentId = await freshAgent();
    for (const person of [member, viewer]) {
      expect(await putIcon(person, agentId, { bytes: PNG })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
    }
    const theirs = await freshAgent(other);
    for (const id of [theirs, MISSING, 'not-a-uuid']) {
      expect(await putIcon(company.owner, id, { bytes: PNG })).toMatchObject({
        status: 404,
        body: { error: { code: 'agent_not_found' } },
      });
    }
    expect(await putIcon(other.owner, agentId, { bytes: PNG })).toMatchObject({
      status: 404,
      body: { error: { code: 'not_found' } },
    });
    expect((await putIcon(undefined, agentId, { bytes: PNG })).status).toBe(401);
    expect(await iconRow(w.t.db, agentId)).toBeUndefined();
    expect(await iconRow(w.t.db, theirs)).toBeUndefined();
  });
});

describe('PATCH /api/companies/:companyId/agents/:agentId/icon', () => {
  it('sets an emoji, removing the image, then the face, and audits each change once', async () => {
    const agentId = await freshAgent();
    await putIcon(admin, agentId, { bytes: PNG });
    expect(await patchIcon(admin, agentId, { kind: 'emoji', emoji: ' 👩‍💻 ' })).toMatchObject({
      status: 200,
      body: { icon: { kind: 'emoji', emoji: '👩‍💻' } },
    });
    expect(await iconRow(w.t.db, agentId)).toBeUndefined();
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'emoji', iconEmoji: '👩‍💻' });
    expect((await patchIcon(admin, agentId, { kind: 'emoji', emoji: '👩‍💻' })).status).toBe(200);
    expect(await patchIcon(company.owner, agentId, { kind: 'face' })).toMatchObject({
      status: 200,
      body: { icon: { kind: 'face' } },
    });
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'face', iconEmoji: null });
    const changes = (await fieldAudit(w.t.db, 'agent', agentId, 'icon')).map((row) => [row[4], row[5]]);
    expect(changes).toEqual([
      [{ kind: 'face' }, { kind: 'image', sha256: sha256(PNG) }],
      [
        { kind: 'image', sha256: sha256(PNG) },
        { kind: 'emoji', emoji: '👩‍💻' },
      ],
      [{ kind: 'emoji', emoji: '👩‍💻' }, { kind: 'face' }],
    ]);
  });

  it.each([
    ['two emoji', { kind: 'emoji', emoji: '🤖🤖' }],
    ['a letter', { kind: 'emoji', emoji: 'A' }],
    ['nothing', { kind: 'emoji', emoji: '' }],
    ['a long run', { kind: 'emoji', emoji: `🤖${'́'.repeat(16)}` }],
    ['no emoji', { kind: 'emoji' }],
    ['an image', { kind: 'image', version: 'abc' }],
    ['another kind', { kind: 'photo' }],
  ])('refuses %s (400)', async (_, body) => {
    const agentId = await freshAgent();
    expect(await patchIcon(admin, agentId, body)).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'face', iconEmoji: null });
  });

  it("refuses a member (403) and another company's agent (404)", async () => {
    const agentId = await freshAgent();
    expect((await patchIcon(member, agentId, { kind: 'emoji', emoji: '🤖' })).status).toBe(403);
    const theirs = await freshAgent(other);
    expect(await patchIcon(company.owner, theirs, { kind: 'emoji', emoji: '🤖' })).toMatchObject({
      status: 404,
      body: { error: { code: 'agent_not_found' } },
    });
    expect(await agentRow(w.t.db, theirs)).toMatchObject({ iconKind: 'face' });
  });
});

describe('GET /api/companies/:companyId/agents/:agentId/icon', () => {
  it('sends the image to any member, cached for good by its version, with a 304 for its ETag', async () => {
    const agentId = await freshAgent();
    await putIcon(admin, agentId, { bytes: GIF });
    const hash = sha256(GIF);
    const res = await getIcon(viewer, agentId);
    expect(res.status).toBe(200);
    expect([...res.bytes]).toEqual([...GIF]);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(res.headers.get('etag')).toBe(`"${hash}"`);
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    const versioned = await getIcon(member, agentId, { v: versionOf(GIF) });
    expect(versioned.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect((await getIcon(viewer, agentId, { etag: `"${hash}"` })).status).toBe(304);
  });

  it("is a 404 for an agent whose icon is not an image, another company's or an unknown agent, and a non-member", async () => {
    const agentId = await freshAgent();
    expect(await getIcon(viewer, agentId)).toMatchObject({
      status: 404,
      body: { error: { code: 'icon_not_found' } },
    });
    const theirs = await freshAgent(other);
    await putIcon(other.owner, theirs, { bytes: PNG }, other);
    for (const id of [theirs, MISSING]) {
      expect(await getIcon(company.owner, id)).toMatchObject({
        status: 404,
        body: { error: { code: 'agent_not_found' } },
      });
    }
    expect((await getIcon(other.owner, agentId)).status).toBe(404);
    expect((await getIcon(undefined, agentId)).status).toBe(401);
  });
});

describe('DELETE /api/companies/:companyId/agents/:agentId/icon', () => {
  it('goes back to the face, removing the image, audited, and is fine when it already is', async () => {
    const agentId = await freshAgent();
    await putIcon(admin, agentId, { bytes: PNG });
    expect(await deleteIcon(admin, agentId)).toMatchObject({ status: 204 });
    expect(await iconRow(w.t.db, agentId)).toBeUndefined();
    expect(await agentRow(w.t.db, agentId)).toMatchObject({ iconKind: 'face' });
    expect(await deleteIcon(admin, agentId)).toMatchObject({ status: 204 });
    expect(await fieldAudit(w.t.db, 'agent', agentId, 'icon')).toHaveLength(2);
  });

  it("refuses a viewer (403) and another company's agent (404)", async () => {
    const agentId = await freshAgent();
    await putIcon(admin, agentId, { bytes: PNG });
    expect((await deleteIcon(viewer, agentId)).status).toBe(403);
    const theirs = await freshAgent(other);
    await putIcon(other.owner, theirs, { bytes: PNG }, other);
    expect(await deleteIcon(company.owner, theirs)).toMatchObject({
      status: 404,
      body: { error: { code: 'agent_not_found' } },
    });
    expect(await iconRow(w.t.db, agentId)).toBeDefined();
    expect(await iconRow(w.t.db, theirs)).toBeDefined();
  });
});

describe("the agent's icon in the agents, an agent and the chart", () => {
  it('names the face, the emoji, or the image by its version wherever the agent is shown', async () => {
    const co = await membersCompany(w);
    const face = await freshAgent(co);
    const emoji = await freshAgent(co);
    const image = await freshAgent(co);
    await patchIcon(co.owner, emoji, { kind: 'emoji', emoji: '🇺🇦' }, co);
    await putIcon(co.owner, image, { bytes: WEBP }, co);
    const expected = {
      [face]: { kind: 'face' },
      [emoji]: { kind: 'emoji', emoji: '🇺🇦' },
      [image]: { kind: 'image', version: versionOf(WEBP) },
    };
    const list = (await as(w, co.owner)('GET', agentsPath(co))).body as { agents: AgentView[] };
    expect(Object.fromEntries(list.agents.map((agent) => [agent.id, agent.icon]))).toEqual(expected);
    expect(await as(w, co.owner)('GET', agentsPath(co, image))).toMatchObject({
      status: 200,
      body: { icon: expected[image] },
    });
    expect(await as(w, co.owner)('PATCH', agentsPath(co, emoji), { name: 'Renamed' })).toMatchObject({
      status: 200,
      body: { icon: expected[emoji] },
    });
    const chart = (await as(w, co.owner)('GET', chartPath(co))).body as OrgChartView;
    const icons = Object.fromEntries(
      chart.nodes.flatMap((node) => (node.kind === 'agent' ? [[node.agent.agentId, node.agent.icon]] : [])),
    );
    expect(icons).toEqual(expected);
  });

  it('keeps the image of an archived agent, readable', async () => {
    const agentId = await freshAgent();
    await putIcon(admin, agentId, { bytes: PNG });
    expect((await as(w, admin)('PATCH', agentsPath(company, agentId), { status: 'archived' })).status).toBe(
      200,
    );
    expect((await getIcon(viewer, agentId)).status).toBe(200);
  });
});
