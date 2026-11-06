import { type DbHandle, diffFields, type EnrollmentTokenRow, type TenantDb, tenant } from '@mwc/db';
import {
  ENROLLMENT_TOKEN_TTL_MS,
  type RunnerEnrollRequest,
  type RunnerEnrollResponse,
} from '@mwc/shared/runner-protocol';
import { generateApiKey } from '../../../platform/auth/api-keys.ts';
import { findEnrollmentToken, generateEnrollmentToken } from '../../../platform/auth/enrollment.ts';
import { enrollmentRepo } from '../repo/enrollment.ts';
import { machinesRepo } from '../repo.ts';
import { type Refusal, TOKEN_UNKNOWN, tokenRefusal } from '../rules.ts';
import type { EnrollmentTokenView } from '../schemas.ts';
import type { Caller } from '../service.ts';

const repo = machinesRepo();

/**
 * Makes a one-time enrollment token for the caller (an admin or owner): good for one enrollment within the hour, only
 * its SHA-256 stored, the token itself returned once. Audited.
 */
export async function createEnrollmentToken(t: TenantDb, caller: Caller): Promise<EnrollmentTokenView> {
  const generated = generateEnrollmentToken();
  const expiresAt = new Date(caller.now.getTime() + ENROLLMENT_TOKEN_TTL_MS);
  return t.transaction(async (tx) => {
    const row = await enrollmentRepo.insert(tx, {
      secretHash: generated.secretHash,
      expiresAt,
      createdBy: caller.principalId,
    });
    await repo.audit(tx, {
      actorKind: 'user',
      actorPrincipalId: caller.principalId,
      requestId: caller.requestId,
      entityType: 'enrollment_token',
      entityId: row.id,
      action: 'create',
      changes: diffFields(null, { expiresAt: row.expiresAt, createdBy: row.createdBy }),
    });
    return { id: row.id, token: generated.token, expiresAt: row.expiresAt.toISOString() };
  });
}

type Enrolled = { readonly ok: true; readonly enrolled: RunnerEnrollResponse } | Refusal;

/** The machine's row, its runner key and their audit rows, in the transaction that used the token. */
async function makeMachine(
  tx: TenantDb,
  token: EnrollmentTokenRow,
  request: RunnerEnrollRequest,
  requestId: string,
): Promise<RunnerEnrollResponse> {
  const { token: _secret, ...fields } = request;
  const machine = await repo.insert(tx, fields);
  await enrollmentRepo.madeMachine(tx, token.id, machine.id);
  const key = generateApiKey('runner');
  const keyRow = await repo.insertKey(tx, {
    principalId: token.createdBy,
    kind: 'runner',
    name: machine.name,
    machineId: machine.id,
    prefix: key.prefix,
    secretHash: key.secretHash,
    scopes: [],
  });
  const by = { actorKind: 'user' as const, actorPrincipalId: token.createdBy, requestId };
  await repo.audit(tx, {
    ...by,
    entityType: 'machine',
    entityId: machine.id,
    action: 'create',
    changes: diffFields(null, fields),
  });
  const keyFields = { kind: keyRow.kind, name: keyRow.name, prefix: keyRow.prefix, machineId: machine.id };
  await repo.audit(tx, {
    ...by,
    entityType: 'api_key',
    entityId: keyRow.id,
    action: 'create',
    changes: diffFields(null, keyFields),
  });
  const used = diffFields({ usedAt: null, machineId: null }, { usedAt: token.usedAt, machineId: machine.id });
  await repo.audit(tx, {
    ...by,
    entityType: 'enrollment_token',
    entityId: token.id,
    action: 'use',
    changes: used,
  });
  return { machineId: machine.id, companyId: tx.companyId, runnerKey: key.key };
}

/**
 * Enrolls a machine with a one-time token (`POST /api/runner/enroll`): the token is used in the same transaction that
 * makes the machine and its runner key (an `api_keys` row of kind `runner`, owned by whoever made the token), so it
 * works once. An unknown, used or expired token, or one of a deleted company, is refused (401).
 */
export async function enrollMachine(
  db: DbHandle,
  request: RunnerEnrollRequest,
  now: Date,
  requestId: string,
): Promise<Enrolled> {
  const found = await findEnrollmentToken(db, request.token);
  if (found === undefined) return TOKEN_UNKNOWN;
  const t = await tenant(db, found.companyId);
  return t.transaction(async (tx) => {
    const token = await enrollmentRepo.claim(tx, found.id, now);
    if (token === undefined) {
      // It could not be used: it was used already, or it has expired.
      return tokenRefusal((await enrollmentRepo.get(tx, found.id)) as EnrollmentTokenRow, now) as Refusal;
    }
    return { ok: true as const, enrolled: await makeMachine(tx, token, request, requestId) };
  });
}
