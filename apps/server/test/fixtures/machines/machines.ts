/**
 * The machines tests' helpers: the API's paths, a token and an enrollment through the API (the test fails on anything
 * but a 201), a sample to send, and the raw rows a machine leaves behind.
 */
import { auditLog, type DbHandle, machineSamples, machines, runnerSessions } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MachineSample } from '@mwc/shared/machines';
import type { RunnerEnrollRequest, RunnerEnrollResponse } from '@mwc/shared/runner-protocol';
import { postJson } from '@mwc/testkit';
import { and, asc, eq } from 'drizzle-orm';
import type { EnrollmentTokenView } from '../../../src/modules/machines/schemas.ts';
import { as, type MembersCompany } from '../members/members.ts';
import type { AuthWorld, Person } from '../platform/auth.ts';

export const machinesPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/machines${rest}`;

/** What This Mac's installer sends, without the token. */
export const MAC: Omit<RunnerEnrollRequest, 'token'> = {
  name: 'This Mac',
  kind: 'laptop',
  os: 'darwin',
  arch: 'arm64',
  hostname: 'ihors-mac.local',
  unixUser: 'ihor',
  runnerVersion: '0.5.0',
  claudeVersion: '2.1.3 (Claude Code)',
  provider: 'none',
  providerRef: null,
};

/** The Airia devbox's, without the token. */
export const DEVBOX: Omit<RunnerEnrollRequest, 'token'> = {
  ...MAC,
  name: 'Airia devbox',
  kind: 'vm',
  os: 'linux',
  arch: 'x64',
  hostname: 'dev-ihorherasko',
  claudeVersion: null,
  provider: 'airia_devbox',
  providerRef: { instance: 'dev-ihorherasko', zone: 'europe-west1-b', size: 'm' },
};

/** Makes an enrollment token through the API as `person` (the company's owner by default). */
export async function makeToken(
  w: AuthWorld,
  company: MembersCompany,
  person: Person = company.owner,
): Promise<EnrollmentTokenView> {
  const res = await as(w, person)('POST', machinesPath(company, '/enrollment-tokens'));
  if (res.status !== 201)
    throw new Error(`POST enrollment-tokens answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as EnrollmentTokenView;
}

/** Enrolls a machine of the company through the API: a token from its owner, then the installer's call. */
export async function enroll(
  w: AuthWorld,
  company: MembersCompany,
  machine: Partial<Omit<RunnerEnrollRequest, 'token'>> = {},
): Promise<RunnerEnrollResponse> {
  const { token } = await makeToken(w, company);
  const res = await postJson(w.t.app, '/api/runner/enroll', { ...MAC, ...machine, token });
  if (res.status !== 201)
    throw new Error(`POST /api/runner/enroll answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as RunnerEnrollResponse;
}

/** A sample taken at `at`: 8 CPUs, calm, unless `fields` say otherwise. */
export const sampleAt = (at: number, fields: Partial<MachineSample> = {}): MachineSample => ({
  load1: 0.8,
  load5: 0.6,
  load15: 0.4,
  cpus: 8,
  cpuPct: 20,
  memPct: 55,
  diskUsed: 200_000_000_000,
  diskTotal: 1_000_000_000_000,
  uptimeS: 3600,
  liveRuns: 0,
  at,
  ...fields,
});

export const machineRow = async (db: DbHandle, id: string) =>
  (await rawDb(db).select().from(machines).where(eq(machines.id, id)))[0];

export const sessionsOf = (db: DbHandle, machineId: string) =>
  rawDb(db)
    .select()
    .from(runnerSessions)
    .where(eq(runnerSessions.machineId, machineId))
    .orderBy(asc(runnerSessions.connectedAt), asc(runnerSessions.id));

export const samplesOf = (db: DbHandle, machineId: string) =>
  rawDb(db)
    .select()
    .from(machineSamples)
    .where(eq(machineSamples.machineId, machineId))
    .orderBy(asc(machineSamples.at));

/** The audit rows of one entity, oldest first, as `action field` pairs. */
export async function auditOf(db: DbHandle, entityType: string, entityId: string): Promise<string[]> {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => `${row.action} ${row.field}`);
}
