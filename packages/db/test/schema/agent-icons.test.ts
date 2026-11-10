import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import { agentIcons, agents, type Company, type NewAgentIcon } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertAgent, insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;

/** The six bytes every GIF starts with, and a few more. */
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
});
afterAll(() => testDb.close());

function icon(companyId: string, agentId: string, values: Partial<NewAgentIcon> = {}) {
  return handle.db
    .insert(agentIcons)
    .values({
      companyId,
      agentId,
      contentType: 'image/gif',
      bytes: GIF,
      size: GIF.length,
      sha256: hash(GIF),
      ...values,
    })
    .returning();
}

const iconsOf = (agentId: string) =>
  handle.db.select().from(agentIcons).where(eq(agentIcons.agentId, agentId));

describe('agent_icons', () => {
  it('keeps the bytes as they were sent, with who set them', async () => {
    const agent = await insertAgent(handle, acme.id);
    const admin = await insertPrincipal(handle, acme.id);
    const [row] = await icon(acme.id, agent.id, { updatedByPrincipalId: admin.id });
    expect(row).toMatchObject({
      companyId: acme.id,
      agentId: agent.id,
      contentType: 'image/gif',
      size: 10,
      sha256: hash(GIF),
      updatedByPrincipalId: admin.id,
    });
    const [read] = await handle.db
      .select()
      .from(agentIcons)
      .where(and(eq(agentIcons.companyId, acme.id), eq(agentIcons.agentId, agent.id)));
    expect([...(read?.bytes ?? [])]).toEqual([...GIF]);
  });

  it("holds one icon per agent and refuses an unknown agent or another company's", async () => {
    const agent = await insertAgent(handle, acme.id);
    const theirs = await insertAgent(handle, globex.id);
    await icon(acme.id, agent.id);
    expect(await pgError(icon(acme.id, agent.id))).toMatchObject({
      code: '23505',
      constraint: 'agent_icons_pkey',
    });
    for (const agentId of [MISSING_ID, theirs.id]) {
      expect(await pgError(icon(acme.id, agentId))).toMatchObject({
        code: '23503',
        constraint: 'agent_icons_agent_fk',
      });
    }
  });

  it('refuses another type, an empty or oversized image and a hash that is not 64 lower-case hex digits', async () => {
    const agent = await insertAgent(handle, acme.id);
    const checks: [Partial<NewAgentIcon>, string][] = [
      // @ts-expect-error contentType is typed as AgentIconContentType; the database refuses it as well
      [{ contentType: 'image/svg+xml' }, 'agent_icons_content_type_check'],
      [{ size: 0 }, 'agent_icons_size_check'],
      [{ size: 1_048_577 }, 'agent_icons_size_check'],
      [{ sha256: hash(GIF).toUpperCase() }, 'agent_icons_sha256_check'],
      [{ sha256: 'abc' }, 'agent_icons_sha256_check'],
    ];
    for (const [values, constraint] of checks) {
      expect(await pgError(icon(acme.id, agent.id, values))).toMatchObject({ code: '23514', constraint });
    }
    expect((await icon(acme.id, agent.id, { size: 1_048_576 }))[0]?.size).toBe(1_048_576);
  });

  it("refuses another company's principal as the one who set it", async () => {
    const agent = await insertAgent(handle, acme.id);
    const outsider = await insertPrincipal(handle, globex.id);
    expect(await pgError(icon(acme.id, agent.id, { updatedByPrincipalId: outsider.id }))).toMatchObject({
      code: '23503',
      constraint: 'agent_icons_updated_by_principal_fk',
    });
  });

  it('goes with its agent when the agent row is deleted, and stays while it is archived', async () => {
    const kept = await insertAgent(handle, acme.id);
    await icon(acme.id, kept.id);
    await handle.db.update(agents).set({ status: 'archived' }).where(eq(agents.id, kept.id));
    expect(await iconsOf(kept.id)).toHaveLength(1);
    const gone = await insertAgent(handle, acme.id);
    await icon(acme.id, gone.id);
    await handle.db.delete(agents).where(eq(agents.id, gone.id));
    expect(await iconsOf(gone.id)).toEqual([]);
  });
});
