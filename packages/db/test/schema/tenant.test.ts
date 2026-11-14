import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import * as schema from '../../src/schema/index.ts';
import { apiKeys, auditLog, type Company, principals } from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertPrincipal, MISSING_ID, migratedTestDb } from '../fixtures/rows.ts';

/** Tables that name a company without being tenant rows (no composite keys point at them). */
const GLOBAL_WITH_COMPANY = ['audit_log', 'credential_uses', 'identity_outbox', 'slack_posts'];
/** Tenant tables with one row per company: `company_id` is their primary key, they have no `id` and nothing points at them. */
const ONE_PER_COMPANY = ['company_logos'];
/** Tenant tables with one row per principal: `(company_id, principal_id)` is their primary key, they have no `id`. */
const ONE_PER_PRINCIPAL = ['notification_settings', 'org_positions'];
/** Tenant tables of a machine's rows keyed by it: `(company_id, machine_id, …)` is their primary key, no `id`. */
const KEYED_BY_MACHINE = ['machine_logos', 'machine_power', 'machine_samples'];
/** Tenant tables of a chat turn's rows keyed by it: `(company_id, turn_id, seq)` is their primary key, no `id`. */
const KEYED_BY_TURN = ['chat_events'];
/** Tenant tables of an agent's rows keyed by it: `(company_id, agent_id)` is their primary key, no `id`. */
const KEYED_BY_AGENT = ['agent_icons'];

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableConfig(table));
const withCompany = tables.filter(
  (t) => t.columns.some((c) => c.name === 'company_id') && !GLOBAL_WITH_COMPANY.includes(t.name),
);
const tenantTables = withCompany.filter(
  (t) =>
    !ONE_PER_COMPANY.includes(t.name) &&
    !ONE_PER_PRINCIPAL.includes(t.name) &&
    !KEYED_BY_MACHINE.includes(t.name) &&
    !KEYED_BY_TURN.includes(t.name) &&
    !KEYED_BY_AGENT.includes(t.name),
);
const onePerCompany = withCompany.filter((t) => ONE_PER_COMPANY.includes(t.name));
const onePerPrincipal = withCompany.filter((t) => ONE_PER_PRINCIPAL.includes(t.name));
const keyedByMachine = withCompany.filter((t) => KEYED_BY_MACHINE.includes(t.name));
const keyedByTurn = withCompany.filter((t) => KEYED_BY_TURN.includes(t.name));
const keyedByAgent = withCompany.filter((t) => KEYED_BY_AGENT.includes(t.name));

describe('the tenant conventions, on every tenant table', () => {
  it('finds the S1, S2, S4, S5 and S6 tenant tables', () => {
    expect(tenantTables.map((t) => t.name).sort()).toEqual([
      'agent_placements',
      'agents',
      'api_keys',
      'chat_turns',
      'chats',
      'decisions',
      'enrollment_tokens',
      'flow_steps',
      'flows',
      'invitations',
      'lead_wake_events',
      'machine_power_events',
      'machines',
      'memberships',
      'notifications',
      'principals',
      'room_messages',
      'runner_sessions',
      'slack_threads',
      'task_artifacts',
      'task_events',
      'tasks',
    ]);
    expect(onePerCompany.map((t) => t.name)).toEqual(ONE_PER_COMPANY);
    expect(onePerPrincipal.map((t) => t.name).sort()).toEqual(ONE_PER_PRINCIPAL);
    expect(keyedByMachine.map((t) => t.name).sort()).toEqual(KEYED_BY_MACHINE);
    expect(keyedByTurn.map((t) => t.name)).toEqual(KEYED_BY_TURN);
    expect(keyedByAgent.map((t) => t.name)).toEqual(KEYED_BY_AGENT);
  });

  it.each(keyedByAgent.map((t) => [t.name, t] as const))(
    '%s: PRIMARY KEY(company_id, agent_id), the agent a composite key, no id',
    (_, t) => {
      expect(t.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([['company_id', 'agent_id']]);
      expect(t.columns.some((c) => c.name === 'id')).toBe(false);
      const refs = t.foreignKeys.map((fk) => fk.reference());
      const agent = refs.find((r) => r.columns.map((c) => c.name).join() === 'company_id,agent_id');
      expect(getTableConfig(agent?.foreignTable as PgTable).name).toBe('agents');
    },
  );

  it.each(keyedByTurn.map((t) => [t.name, t] as const))(
    '%s: PRIMARY KEY(company_id, turn_id, seq), the turn a composite key, no id',
    (_, t) => {
      expect(t.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
        ['company_id', 'turn_id', 'seq'],
      ]);
      expect(t.columns.some((c) => c.name === 'id')).toBe(false);
      const refs = t.foreignKeys.map((fk) => fk.reference());
      const turn = refs.find((r) => r.columns.map((c) => c.name).join() === 'company_id,turn_id');
      expect(getTableConfig(turn?.foreignTable as PgTable).name).toBe('chat_turns');
    },
  );

  it.each(keyedByMachine.map((t) => [t.name, t] as const))(
    '%s: PRIMARY KEY(company_id, machine_id, …), the machine a composite key, no id',
    (_, t) => {
      const [key] = t.primaryKeys.map((pk) => pk.columns.map((c) => c.name));
      expect(key?.slice(0, 2)).toEqual(['company_id', 'machine_id']);
      expect(t.columns.some((c) => c.name === 'id')).toBe(false);
      const refs = t.foreignKeys.map((fk) => fk.reference());
      const machine = refs.find((r) => r.columns.map((c) => c.name).join() === 'company_id,machine_id');
      expect(getTableConfig(machine?.foreignTable as PgTable).name).toBe('machines');
    },
  );

  it.each(onePerPrincipal.map((t) => [t.name, t] as const))(
    '%s: PRIMARY KEY(company_id, principal_id), the principal a composite key, no id',
    (_, t) => {
      expect(t.primaryKeys.map((pk) => pk.columns.map((c) => c.name))).toEqual([
        ['company_id', 'principal_id'],
      ]);
      expect(t.columns.some((c) => c.name === 'id')).toBe(false);
      const refs = t.foreignKeys.map((fk) => fk.reference());
      const principal = refs.find((r) => r.columns.map((c) => c.name).join() === 'company_id,principal_id');
      expect(getTableConfig(principal?.foreignTable as PgTable).name).toBe('principals');
      const companyFk = refs.find((r) => r.columns.length === 1);
      expect(getTableConfig(companyFk?.foreignTable as PgTable).name).toBe('companies');
    },
  );

  it.each(onePerCompany.map((t) => [t.name, t] as const))(
    '%s: company_id is the primary key and points at companies, no id',
    (_, t) => {
      const companyId = t.columns.find((c) => c.name === 'company_id');
      expect(companyId?.primary).toBe(true);
      expect(t.columns.some((c) => c.name === 'id')).toBe(false);
      const companyFk = t.foreignKeys.map((fk) => fk.reference()).find((r) => r.columns.length === 1);
      expect(getTableConfig(companyFk?.foreignTable as PgTable).name).toBe('companies');
    },
  );

  it.each(tenantTables.map((t) => [t.name, t] as const))(
    '%s: company_id not null, UNIQUE(company_id, id)',
    (_, t) => {
      expect(t.columns.find((c) => c.name === 'company_id')?.notNull).toBe(true);
      const keys = t.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(','));
      expect(keys).toContain('company_id,id');
      const companyFk = t.foreignKeys.map((fk) => fk.reference()).find((r) => r.columns.length === 1);
      expect(getTableConfig(companyFk?.foreignTable as PgTable).name).toBe('companies');
    },
  );

  it('points every foreign key into a tenant table with (company_id, parent_id) → (company_id, id)', () => {
    const names = new Set(tenantTables.map((t) => t.name));
    let composite = 0;
    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        const ref = fk.reference();
        if (!names.has(getTableConfig(ref.foreignTable).name)) continue;
        composite++;
        expect(ref.columns.map((c) => c.name)[0], `${table.name} ${fk.getName()}`).toBe('company_id');
        expect(ref.foreignColumns.map((c) => c.name)).toEqual(['company_id', 'id']);
      }
    }
    expect(composite).toBe(66);
  });
});

describe('principals and the composite keys that point at them', () => {
  let testDb: TestDb;
  let handle: RawDbHandle;
  let acme: Company;
  let globex: Company;
  beforeAll(async () => {
    testDb = await migratedTestDb();
    handle = testDb.handle;
    acme = await insertCompany(handle);
    globex = await insertCompany(handle);
  });
  afterAll(() => testDb.close());

  it('stores a person and an agent, and refuses another kind or an unknown company', async () => {
    expect((await insertPrincipal(handle, acme.id, 'agent')).kind).toBe('agent');
    // @ts-expect-error kind is typed as PrincipalKind; the database refuses it as well
    expect(await pgError(insertPrincipal(handle, acme.id, 'robot'))).toMatchObject({
      code: '23514',
      constraint: 'principals_kind_check',
    });
    expect(await pgError(insertPrincipal(handle, MISSING_ID))).toMatchObject({
      code: '23503',
      constraint: 'principals_company_id_companies_id_fk',
    });
  });

  it("refuses an audit row whose actor is another company's principal, and keeps global rows free", async () => {
    const theirs = await insertPrincipal(handle, globex.id);
    const row = { actorKind: 'user' as const, entityType: 'company', entityId: acme.id, action: 'update' };
    const cross = handle.db
      .insert(auditLog)
      .values({ ...row, companyId: acme.id, actorPrincipalId: theirs.id });
    expect(await pgError(cross)).toMatchObject({ code: '23503', constraint: 'audit_log_actor_principal_fk' });
    const ours = await insertPrincipal(handle, acme.id);
    await handle.db.insert(auditLog).values({ ...row, companyId: acme.id, actorPrincipalId: ours.id });
    // A global event has no company, so its actor is not checked against one (MATCH SIMPLE).
    await handle.db.insert(auditLog).values({ ...row, companyId: null, actorPrincipalId: theirs.id });
  });

  it('refuses a duplicate (company_id, id) pair only as the primary key would', async () => {
    const p = await insertPrincipal(handle, acme.id);
    const again = handle.db.insert(principals).values({ id: p.id, companyId: globex.id, kind: 'person' });
    expect((await pgError(again)).code).toBe('23505');
    expect(apiKeys.companyId.name).toBe('company_id');
  });
});
