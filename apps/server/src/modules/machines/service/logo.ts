import { diffFields, type MachineLogo, type TenantDb } from '@mwc/db';
import type { LogoView } from '../../companies/schemas.ts';
import { checkLogoFile, type LogoRefusal, logoView } from '../../companies/service/logo.ts';
import { machineLogoRows } from '../repo/logos.ts';
import { machinesRepo } from '../repo.ts';
import { MACHINE_NOT_FOUND, type Refusal } from '../rules.ts';

/**
 * A machine's logo, as a company's (`companies/service/logo.ts`, whose checks it shares): set or replace it (admins
 * and owners), read it (any member), remove it (admins and owners). Only a machine of the company that is not removed
 * has one to change or read (else 404 `machine_not_found`). Every change writes the machine's per-field audit row
 * (field `logo`, the SHA-256 before and after, null for none) under the company's lock.
 */

const repo = machinesRepo();

/** Who changes the logo, in which request. */
export interface LogoCaller {
  readonly principalId: string;
  readonly requestId: string;
}

/** The machine's audit row of its `logo` field; none when the logo did not change. */
function auditLogo(
  tx: TenantDb,
  caller: LogoCaller,
  machineId: string,
  before: string | null,
  after: string | null,
) {
  return repo.audit(tx, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'machine',
    entityId: machineId,
    action: 'update',
    changes: diffFields({ logo: before }, { logo: after }),
  });
}

/**
 * Sets the machine's logo from an uploaded file, replacing any it had: 404 `machine_not_found` for no such machine,
 * then the logo checks (400 `logo_empty`, 413 `logo_too_large`, 415 `logo_type_unsupported`).
 */
export async function uploadMachineLogo(
  t: TenantDb,
  caller: LogoCaller,
  machineId: string,
  file: Blob,
): Promise<{ ok: true; logo: LogoView } | LogoRefusal | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  const checked = await checkLogoFile(file);
  if (!checked.ok) return checked;
  const { bytes, contentType, sha256 } = checked;
  const saved = await t.transaction(async (tx) => {
    await tx.lockCompany();
    const before = (await machineLogoRows.info(tx, machine.id))?.sha256 ?? null;
    const values = {
      contentType,
      bytes,
      size: bytes.length,
      sha256,
      updatedByPrincipalId: caller.principalId,
    };
    const row = await machineLogoRows.save(tx, machine.id, values);
    await auditLogo(tx, caller, machine.id, before, sha256);
    return row;
  });
  return { ok: true, logo: logoView(saved) };
}

/** Removes the machine's logo; a machine with none is fine and writes nothing. 404 for no such machine. */
export async function removeMachineLogo(
  t: TenantDb,
  caller: LogoCaller,
  machineId: string,
): Promise<{ ok: true } | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  await t.transaction(async (tx) => {
    await tx.lockCompany();
    const removed = await machineLogoRows.remove(tx, machine.id);
    if (removed !== undefined) await auditLogo(tx, caller, machine.id, removed, null);
  });
  return { ok: true };
}

/** The machine's logo with its bytes; undefined when it has none, 404 for no such machine. */
export async function machineLogoFile(
  t: TenantDb,
  machineId: string,
): Promise<{ ok: true; logo: MachineLogo | undefined } | Refusal<404>> {
  const machine = await repo.get(t, machineId);
  if (machine === undefined) return MACHINE_NOT_FOUND;
  return { ok: true, logo: await machineLogoRows.file(t, machine.id) };
}

/** Every machine's logo SHA-256 in the company, by machine (for the lists' `logo`). */
export const machineLogoHashes = (t: TenantDb): Promise<Map<string, string>> => machineLogoRows.hashes(t);
