import { randomBytes } from 'node:crypto';
import type { CredentialKind, Harness } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queryRows, type RawDbHandle } from '../../src/handle.ts';
import { migrateToLatest, migrationStatus } from '../../src/migrate.ts';
import {
  type AccessProfile,
  accessProfiles,
  agents,
  auditLog,
  chats,
  credentials,
  memberships,
} from '../../src/schema/index.ts';
import { createTestDb, type TestDb, testDbKind } from '../../src/testing.ts';
import { journal, migrateUpTo } from '../fixtures/migrations.ts';
import {
  insertAgent,
  insertCompany,
  insertMachine,
  insertPrincipal,
  insertUser,
  unique,
} from '../fixtures/rows.ts';

/**
 * The data step of migration `0015_profile_provider` (the `-- custom:` part of `migrations/0015_profile_provider.sql`):
 * access profiles stop being bundles (a Claude slot, an OpenAI slot, a gateway) and get one provider each. A profile
 * with only a Claude subscription, or none, is a Claude profile; with only an OpenAI one, an OpenAI profile (its
 * gateway let go); with both, it stays Claude and a new OpenAI profile "<name> · OpenAI" takes the OpenAI subscription,
 * its `codex` agents and chats, and the OpenAI default of members whose default it was. Agents and chats left on a
 * profile of another provider than their harness lose it; each member's default moves to its provider's column. The
 * rows are seeded at `0014_chat_turn_queue`, with the columns the tables had then.
 */

const BY = 'migration:0015_profile_provider';
let testDb: TestDb;
let handle: RawDbHandle;

beforeAll(async () => {
  testDb = await createTestDb();
  handle = testDb.handle;
  await migrateUpTo(handle, '0014_chat_turn_queue');
});
afterAll(() => testDb.close());

/** One of the owner's sealed credentials of `kind` (random bytes stand in for a seal). */
async function credential(ownerUserId: string, kind: CredentialKind): Promise<string> {
  const [row] = await handle.db
    .insert(credentials)
    .values({
      ownerUserId,
      kind,
      label: unique(kind),
      keyVersion: 1,
      iv: new Uint8Array(randomBytes(12)),
      authTag: new Uint8Array(randomBytes(16)),
      ciphertext: new Uint8Array(randomBytes(24)),
    })
    .returning();
  return row?.id as string;
}

interface Slots {
  readonly claude?: string | null;
  readonly openai?: string | null;
  readonly gateway?: string | null;
}

/** A profile written with the columns `access_profiles` had at `0014`: its three slots. */
async function bundle(ownerUserId: string, name: string, slots: Slots = {}): Promise<string> {
  const id = newId();
  await queryRows(
    handle,
    sql`insert into access_profiles (id, owner_user_id, name, claude_credential_id, openai_credential_id,
          gateway_credential_id)
        values (${id}, ${ownerUserId}, ${name}, ${slots.claude ?? null}, ${slots.openai ?? null},
                ${slots.gateway ?? null})`,
  );
  return id;
}

/** A member of the company with the single default profile memberships had at `0014`. */
async function member(companyId: string, userId: string, defaultProfileId: string | null): Promise<string> {
  const id = newId();
  const principal = await insertPrincipal(handle, companyId);
  await queryRows(
    handle,
    sql`insert into memberships (id, company_id, principal_id, user_id, role, granted_role, default_profile_id)
        values (${id}, ${companyId}, ${principal.id}, ${userId}, 'admin', 'admin', ${defaultProfileId})`,
  );
  return id;
}

describe(`0015_profile_provider on ${testDbKind()}: one provider per access profile`, () => {
  const ids: Record<string, string> = {};
  let companyId: string;

  async function agentOn(name: string, harness: Harness, profileId: string) {
    ids[name] = (await insertAgent(handle, companyId, { harness, profileId })).id;
  }

  async function chatOn(name: string, harness: Harness, profileId: string, setBy: string) {
    const agent = await insertAgent(handle, companyId, { harness });
    const machine = await insertMachine(handle, companyId);
    const creator = await insertPrincipal(handle, companyId);
    const [row] = await handle.db
      .insert(chats)
      .values({
        companyId,
        agentId: agent.id,
        harness,
        machineId: machine.id,
        profileId,
        profileSetBy: setBy,
        createdBy: creator.id,
      })
      .returning();
    ids[name] = row?.id as string;
  }

  beforeAll(async () => {
    const ihor = (await insertUser(handle)).id;
    const other = (await insertUser(handle)).id;
    companyId = (await insertCompany(handle)).id;
    const sub = (kind: CredentialKind) => credential(ihor, kind);
    ids.claude = await sub('claude_oauth');
    ids.openai = await sub('codex_oauth');
    ids.gateway = await sub('gateway');
    ids.otherOpenai = await credential(other, 'openai_api_key');

    ids.claudeOnly = await bundle(ihor, 'Claude only', { claude: ids.claude, gateway: ids.gateway });
    ids.openaiOnly = await bundle(ihor, 'OpenAI only', { openai: ids.openai, gateway: ids.gateway });
    ids.gatewayOnly = await bundle(ihor, 'Gateway only', { gateway: ids.gateway });
    ids.empty = await bundle(ihor, 'Empty');
    ids.work = await bundle(ihor, 'Work', { claude: ids.claude, openai: ids.openai, gateway: ids.gateway });
    // "Home · OpenAI" is taken, so Home's new profile is "Home · OpenAI 2".
    ids.taken = await bundle(ihor, 'Home · OpenAI', { claude: ids.claude });
    ids.home = await bundle(ihor, 'Home', { claude: ids.claude, openai: ids.openai });
    ids.long = await bundle(ihor, 'L'.repeat(80), { claude: ids.claude, openai: ids.openai });
    // Another person's "Work" gets its own "Work · OpenAI": names are unique per owner.
    ids.othersWork = await bundle(other, 'Work', {
      claude: await credential(other, 'claude_setup_token'),
      openai: ids.otherOpenai,
    });

    await agentOn('claudeAgentOnClaudeOnly', 'claude_code', ids.claudeOnly);
    await agentOn('codexAgentOnClaudeOnly', 'codex', ids.claudeOnly);
    await agentOn('codexAgentOnOpenaiOnly', 'codex', ids.openaiOnly);
    await agentOn('claudeAgentOnOpenaiOnly', 'claude_code', ids.openaiOnly);
    await agentOn('codexAgentOnEmpty', 'codex', ids.empty);
    await agentOn('claudeAgentOnWork', 'claude_code', ids.work);
    await agentOn('codexAgentOnWork', 'codex', ids.work);
    await agentOn('secondCodexOnWork', 'codex', ids.work);
    await chatOn('claudeChatOnWork', 'claude_code', ids.work, ihor);
    await chatOn('codexChatOnWork', 'codex', ids.work, ihor);
    await chatOn('claudeChatOnOpenaiOnly', 'claude_code', ids.openaiOnly, ihor);

    ids.defaultsWork = await member(companyId, ihor, ids.work);
    const elsewhere = (await insertCompany(handle)).id;
    ids.defaultsOpenaiOnly = await member(elsewhere, ihor, ids.openaiOnly);
    ids.defaultsEmpty = await member((await insertCompany(handle)).id, ihor, ids.empty);
    ids.defaultsNone = await member(companyId, other, null);

    await migrateToLatest(handle);
  });

  const profiles = () => handle.db.select().from(accessProfiles);
  const profile = async (id: string | undefined) => (await profiles()).find((row) => row.id === id);
  const named = async (name: string, ownerUserId?: string) =>
    (await profiles()).filter(
      (row) => row.name === name && (ownerUserId === undefined || row.ownerUserId === ownerUserId),
    );
  const agentProfile = async (name: string) =>
    (
      await handle.db
        .select()
        .from(agents)
        .where(eq(agents.id, ids[name] as string))
    )[0]?.profileId;
  const chatRow = async (name: string) =>
    (
      await handle.db
        .select()
        .from(chats)
        .where(eq(chats.id, ids[name] as string))
    )[0];
  const defaults = async (name: string) => {
    const [row] = await handle.db
      .select()
      .from(memberships)
      .where(eq(memberships.id, ids[name] as string));
    return [row?.defaultClaudeProfileId, row?.defaultOpenaiProfileId];
  };
  const audit = (entityType: string, entityId: string | undefined) =>
    handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId as string)))
      .orderBy(auditLog.field);
  const sibling = async (name: string) => (await named(name))[0] as AccessProfile;

  it('applies the migration (and the ones after it)', async () => {
    expect(await migrationStatus(handle)).toMatchObject({ last: journal.entries.at(-1)?.tag, current: true });
  });

  it('makes a profile with only a Claude subscription a Claude profile, keeping its gateway', async () => {
    expect(await profile(ids.claudeOnly)).toMatchObject({
      name: 'Claude only',
      provider: 'claude',
      credentialId: ids.claude,
      gatewayCredentialId: ids.gateway,
    });
    expect(await agentProfile('claudeAgentOnClaudeOnly')).toBe(ids.claudeOnly);
  });

  it('makes a profile with only an OpenAI subscription an OpenAI profile, letting its gateway go', async () => {
    expect(await profile(ids.openaiOnly)).toMatchObject({
      provider: 'openai',
      credentialId: ids.openai,
      gatewayCredentialId: null,
    });
    expect(await agentProfile('codexAgentOnOpenaiOnly')).toBe(ids.openaiOnly);
    expect(await audit('access_profile', ids.openaiOnly)).toMatchObject([
      {
        companyId: null,
        actorKind: 'system',
        action: 'update',
        field: 'gatewayCredentialId',
        oldValue: ids.gateway,
        newValue: null,
        requestId: BY,
      },
    ]);
  });

  it('makes a profile with no subscription a Claude profile with none, with its gateway if it had one', async () => {
    expect(await profile(ids.empty)).toMatchObject({
      provider: 'claude',
      credentialId: null,
      gatewayCredentialId: null,
    });
    expect(await profile(ids.gatewayOnly)).toMatchObject({
      provider: 'claude',
      credentialId: null,
      gatewayCredentialId: ids.gateway,
    });
  });

  it('keeps a bundle of both a Claude profile, and gives its OpenAI subscription to a new OpenAI profile', async () => {
    expect(await profile(ids.work)).toMatchObject({
      name: 'Work',
      provider: 'claude',
      credentialId: ids.claude,
      gatewayCredentialId: ids.gateway,
    });
    const work = await named('Work · OpenAI');
    expect(work).toHaveLength(2);
    const mine = work.find((row) => row.credentialId === ids.openai);
    expect(mine).toMatchObject({
      provider: 'openai',
      gatewayCredentialId: null,
      ownerUserId: (await profile(ids.work))?.ownerUserId,
    });
    const theirs = work.find((row) => row.credentialId === ids.otherOpenai);
    expect(theirs).toMatchObject({
      provider: 'openai',
      ownerUserId: (await profile(ids.othersWork))?.ownerUserId,
    });
    expect(await audit('access_profile', mine?.id)).toMatchObject(
      [
        ['credentialId', ids.openai],
        ['name', 'Work · OpenAI'],
        ['ownerUserId', mine?.ownerUserId],
        ['provider', 'openai'],
      ].map(([field, newValue]) => ({
        companyId: null,
        actorKind: 'system',
        action: 'create',
        field,
        oldValue: null,
        newValue,
        requestId: BY,
      })),
    );
  });

  it('names the new profile with a number when the name is taken, and cuts a long name to fit', async () => {
    expect(await named('Home · OpenAI 2')).toMatchObject([{ provider: 'openai', credentialId: ids.openai }]);
    expect(await profile(ids.taken)).toMatchObject({ name: 'Home · OpenAI', provider: 'claude' });
    const long = await sibling(`${'L'.repeat(71)} · OpenAI`);
    expect(long).toMatchObject({ provider: 'openai', credentialId: ids.openai });
    expect(long.name).toHaveLength(80);
    expect(await profile(ids.long)).toMatchObject({ name: 'L'.repeat(80), provider: 'claude' });
  });

  it("moves the bundle's Codex agents and chats to the new profile, with audit rows; Claude Code ones stay", async () => {
    const work = (await named('Work · OpenAI')).find(
      (row) => row.credentialId === ids.openai,
    ) as AccessProfile;
    expect(await agentProfile('claudeAgentOnWork')).toBe(ids.work);
    expect(await agentProfile('codexAgentOnWork')).toBe(work.id);
    expect(await agentProfile('secondCodexOnWork')).toBe(work.id);
    expect(await chatRow('claudeChatOnWork')).toMatchObject({ profileId: ids.work });
    expect(await chatRow('codexChatOnWork')).toMatchObject({
      profileId: work.id,
      profileSetBy: expect.any(String),
    });
    for (const [entityType, name] of [
      ['agent', 'codexAgentOnWork'],
      ['chat', 'codexChatOnWork'],
    ] as const) {
      expect(await audit(entityType, ids[name])).toMatchObject([
        {
          companyId,
          actorKind: 'system',
          actorPrincipalId: null,
          action: 'update',
          field: 'profileId',
          oldValue: ids.work,
          newValue: work.id,
          requestId: BY,
        },
      ]);
    }
    expect(await audit('agent', ids.claudeAgentOnWork)).toEqual([]);
  });

  it('takes a profile of the other provider off an agent or chat, with audit rows', async () => {
    for (const [name, profileId] of [
      ['codexAgentOnClaudeOnly', ids.claudeOnly],
      ['claudeAgentOnOpenaiOnly', ids.openaiOnly],
      ['codexAgentOnEmpty', ids.empty],
    ] as const) {
      expect(await agentProfile(name), name).toBeNull();
      expect(await audit('agent', ids[name])).toMatchObject([
        {
          companyId,
          actorKind: 'system',
          field: 'profileId',
          oldValue: profileId,
          newValue: null,
          requestId: BY,
        },
      ]);
    }
    expect(await chatRow('claudeChatOnOpenaiOnly')).toMatchObject({ profileId: null, profileSetBy: null });
    expect(await audit('chat', ids.claudeChatOnOpenaiOnly)).toMatchObject([
      { field: 'profileId', oldValue: ids.openaiOnly, newValue: null, requestId: BY },
    ]);
  });

  it("moves each default to its provider's column; a bundle's stays Claude and its new profile is the OpenAI one", async () => {
    const work = (await named('Work · OpenAI')).find(
      (row) => row.credentialId === ids.openai,
    ) as AccessProfile;
    expect(await defaults('defaultsWork')).toEqual([ids.work, work.id]);
    expect(await audit('membership', ids.defaultsWork)).toMatchObject([
      {
        companyId,
        actorKind: 'system',
        field: 'defaultOpenaiProfileId',
        oldValue: null,
        newValue: work.id,
        requestId: BY,
      },
    ]);
    expect(await defaults('defaultsOpenaiOnly')).toEqual([null, ids.openaiOnly]);
    expect(await defaults('defaultsEmpty')).toEqual([ids.empty, null]);
    expect(await defaults('defaultsNone')).toEqual([null, null]);
  });

  it('leaves every profile with one provider, and a gateway only on Claude ones', async () => {
    const rows = await profiles();
    // 9 profiles seeded, and a new OpenAI profile for each of the 4 bundles of both.
    expect(rows).toHaveLength(13);
    expect(rows.filter((row) => row.provider === 'openai').map((row) => row.gatewayCredentialId)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
