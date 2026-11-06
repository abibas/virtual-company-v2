import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RawDbHandle } from '../../src/handle.ts';
import {
  type Company,
  enrollmentTokens,
  type Machine,
  machinePower,
  machinePowerEvents,
  machineSamples,
  machines,
  type NewEnrollmentToken,
  type NewMachineSample,
  type Principal,
  runnerSessions,
} from '../../src/schema/index.ts';
import { pgError, type TestDb } from '../../src/testing.ts';
import { insertCompany, insertMachine, insertPrincipal, migratedTestDb, unique } from '../fixtures/rows.ts';

let testDb: TestDb;
let handle: RawDbHandle;
let acme: Company;
let globex: Company;
let admin: Principal;
let mac: Machine;
let theirs: Machine;

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const AT = new Date('2026-11-06T12:00:00Z');

beforeAll(async () => {
  testDb = await migratedTestDb();
  handle = testDb.handle;
  acme = await insertCompany(handle);
  globex = await insertCompany(handle);
  admin = await insertPrincipal(handle, acme.id);
  mac = await insertMachine(handle, acme.id);
  theirs = await insertMachine(handle, globex.id);
});
afterAll(() => testDb.close());

const constraint = async (work: Promise<unknown>) => (await pgError(work)).constraint;

describe('machines', () => {
  it('stores a machine offline, with one slot, no provider and nothing seen yet', async () => {
    expect(mac).toMatchObject({
      provider: 'none',
      providerRef: null,
      controllerMachineId: null,
      claudeVersion: null,
      slots: 1,
      status: 'offline',
      lastSeenAt: null,
      hourlyCost: null,
      holdUntil: null,
      holdSource: null,
      removedAt: null,
    });
    const box = await insertMachine(handle, acme.id, {
      kind: 'vm',
      provider: 'airia_devbox',
      providerRef: { instance: 'dev-ihor', zone: 'europe-west1-b', size: 'm' },
      controllerMachineId: mac.id,
      hourlyCost: 0.268,
      holdSource: 'live_runs',
    });
    expect(box).toMatchObject({ hourlyCost: 0.268, holdSource: 'live_runs', controllerMachineId: mac.id });
  });

  it('refuses a bad name, kind, provider, status, hold source, reference, slot count or cost', async () => {
    const bad = (values: Partial<Machine>) => constraint(insertMachine(handle, acme.id, values));
    expect(await bad({ name: '' })).toBe('machines_name_check');
    expect(await bad({ name: 'x'.repeat(81) })).toBe('machines_name_check');
    // @ts-expect-error kind is typed as MachineKind; the database refuses it as well
    expect(await bad({ kind: 'phone' })).toBe('machines_kind_check');
    // @ts-expect-error provider is typed as MachineProvider
    expect(await bad({ provider: 'gcp' })).toBe('machines_provider_check');
    // @ts-expect-error status is typed as MachineStatus
    expect(await bad({ status: 'asleep' })).toBe('machines_status_check');
    // @ts-expect-error holdSource is typed as HoldSource
    expect(await bad({ holdSource: 'cron' })).toBe('machines_hold_source_check');
    expect(await bad({ providerRef: ['dev-ihor'] as unknown as Record<string, unknown> })).toBe(
      'machines_provider_ref_check',
    );
    expect(await bad({ slots: 65 })).toBe('machines_slots_check');
    expect(await bad({ slots: -1 })).toBe('machines_slots_check');
    expect(await bad({ hourlyCost: -0.1 })).toBe('machines_hourly_cost_check');
  });

  it("refuses itself or another company's machine as its controller", async () => {
    expect(await constraint(insertMachine(handle, acme.id, { controllerMachineId: theirs.id }))).toBe(
      'machines_controller_fk',
    );
    const loop = handle.db
      .update(machines)
      .set({ controllerMachineId: mac.id })
      .where(eq(machines.id, mac.id));
    expect(await constraint(loop)).toBe('machines_controller_check');
  });
});

describe('enrollment_tokens', () => {
  const token = (values: Partial<NewEnrollmentToken> = {}) =>
    handle.db
      .insert(enrollmentTokens)
      .values({
        companyId: acme.id,
        secretHash: hash(unique('et')),
        expiresAt: AT,
        createdBy: admin.id,
        ...values,
      })
      .returning();

  it('stores an unused token, and the machine it made once used', async () => {
    const [row] = await token();
    expect(row).toMatchObject({ usedAt: null, machineId: null, expiresAt: AT });
    await expect(token({ usedAt: AT, machineId: mac.id })).resolves.toHaveLength(1);
  });

  it('refuses a taken or malformed hash, a machine before use, and rows of another company', async () => {
    const secretHash = hash(unique('twice'));
    await token({ secretHash });
    expect(await constraint(token({ secretHash }))).toBe('enrollment_tokens_secret_hash_unique');
    expect(await constraint(token({ secretHash: 'ABC' }))).toBe('enrollment_tokens_secret_hash_check');
    expect(await constraint(token({ machineId: mac.id }))).toBe('enrollment_tokens_machine_check');
    expect(await constraint(token({ usedAt: AT, machineId: theirs.id }))).toBe(
      'enrollment_tokens_machine_fk',
    );
    const stranger = await insertPrincipal(handle, globex.id);
    expect(await constraint(token({ createdBy: stranger.id }))).toBe('enrollment_tokens_created_by_fk');
  });
});

describe('runner_sessions', () => {
  it('stores an open session, and refuses one that ends before it starts or names a foreign machine', async () => {
    const [open] = await handle.db
      .insert(runnerSessions)
      .values({ companyId: acme.id, machineId: mac.id, version: '0.5.0', remoteIp: '127.0.0.1' })
      .returning();
    expect(open).toMatchObject({ disconnectedAt: null, remoteIp: '127.0.0.1' });
    const backwards = handle.db.insert(runnerSessions).values({
      companyId: acme.id,
      machineId: mac.id,
      version: '0.5.0',
      connectedAt: AT,
      disconnectedAt: new Date(AT.getTime() - 1),
    });
    expect(await constraint(backwards)).toBe('runner_sessions_span_check');
    const foreign = handle.db
      .insert(runnerSessions)
      .values({ companyId: acme.id, machineId: theirs.id, version: '0.5.0' });
    expect(await constraint(foreign)).toBe('runner_sessions_machine_fk');
  });
});

describe('machine_samples', () => {
  const sample = (values: Partial<NewMachineSample> = {}) =>
    handle.db.insert(machineSamples).values({
      companyId: acme.id,
      machineId: mac.id,
      at: AT,
      load1: 0.5,
      load5: 0.4,
      load15: 0.3,
      cpus: 8,
      cpuPct: 12.5,
      memPct: 61,
      diskUsed: 120_000_000_000,
      diskTotal: 500_000_000_000,
      uptimeS: 86_400,
      liveRuns: 0,
      ...values,
    });

  it('keeps one sample per machine and minute, with disk sizes past 2^32', async () => {
    await sample();
    expect((await pgError(sample())).code).toBe('23505');
    const [row] = await handle.db.select().from(machineSamples).where(eq(machineSamples.machineId, mac.id));
    expect(row).toMatchObject({ diskTotal: 500_000_000_000, cpuPct: 12.5 });
  });

  it('refuses no CPU and a foreign machine', async () => {
    expect(await constraint(sample({ at: new Date(AT.getTime() + 60_000), cpus: 0 }))).toBe(
      'machine_samples_cpus_check',
    );
    expect(await constraint(sample({ machineId: theirs.id }))).toBe('machine_samples_machine_fk');
  });
});

describe('machine_power and machine_power_events', () => {
  it('keeps one policy row per machine, an object, set by a principal of the company', async () => {
    const [row] = await handle.db
      .insert(machinePower)
      .values({ companyId: acme.id, machineId: mac.id })
      .returning();
    expect(row).toMatchObject({ policy: {}, state: {}, updatedBy: null });
    const again = handle.db.insert(machinePower).values({ companyId: acme.id, machineId: mac.id });
    expect((await pgError(again)).code).toBe('23505');
    const other = await insertMachine(handle, acme.id);
    const array = handle.db
      .insert(machinePower)
      .values({ companyId: acme.id, machineId: other.id, policy: [] as unknown as Record<string, unknown> });
    expect(await constraint(array)).toBe('machine_power_policy_check');
    const stranger = await insertPrincipal(handle, globex.id);
    const foreign = handle.db
      .insert(machinePower)
      .values({ companyId: acme.id, machineId: other.id, updatedBy: stranger.id });
    expect(await constraint(foreign)).toBe('machine_power_updated_by_fk');
  });

  it('logs an action with its reason and actor, and refuses unknown ones', async () => {
    const event = (values: Partial<typeof machinePowerEvents.$inferInsert>) =>
      handle.db.insert(machinePowerEvents).values({
        companyId: acme.id,
        machineId: mac.id,
        action: 'held',
        reason: 'keep-on hours',
        actor: 'schedule',
        ...values,
      });
    await expect(event({ actor: `user:${admin.id}` })).resolves.toBeDefined();
    // @ts-expect-error action is typed as PowerEventAction
    expect(await constraint(event({ action: 'rebooted' }))).toBe('machine_power_events_action_check');
    expect(await constraint(event({ reason: '' }))).toBe('machine_power_events_reason_check');
    expect(await constraint(event({ actor: 'ihor' }))).toBe('machine_power_events_actor_check');
    expect(await constraint(event({ machineId: theirs.id }))).toBe('machine_power_events_machine_fk');
  });
});
