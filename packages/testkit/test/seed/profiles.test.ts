import { migrateToLatest } from '@mwc/db/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../src/db.ts';
import { seedAgent, seedCompany, seedProfile } from '../../src/seed.ts';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
  await migrateToLatest(testDb.handle);
});
afterAll(() => testDb.close());

describe('seedProfile', () => {
  it("makes a person's Claude profile on the provider's defaults, or what it is given, for an agent to use", async () => {
    const { company, owner } = await seedCompany(testDb.handle);
    const plain = await seedProfile(testDb.handle, owner.user.id);
    expect(plain).toMatchObject({
      ownerUserId: owner.user.id,
      provider: 'claude',
      credentialId: null,
      model: null,
      effort: null,
    });
    expect(plain.name).toMatch(/^Profile [0-9a-f]{8}$/);
    const codex = await seedProfile(testDb.handle, owner.user.id, {
      name: 'Codex',
      provider: 'openai',
      model: 'gpt-6.1-sol',
      effort: 'ultra',
    });
    expect(codex).toMatchObject({ name: 'Codex', provider: 'openai', model: 'gpt-6.1-sol', effort: 'ultra' });
    const { agent } = await seedAgent(testDb.handle, company.id, { reportsTo: null, profileId: codex.id });
    expect(agent.profileId).toBe(codex.id);
  });
});
