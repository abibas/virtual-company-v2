import { createHash } from 'node:crypto';
import { type CompanyLogo, diffFields, type TenantDb } from '@mwc/db';
import { LOGO_MAX_BYTES, type LogoRef, logoRef, logoVersion } from '@mwc/shared/logos';
import { type LogoInfo, logoRows } from '../repo/logo.ts';
import { companiesRepo } from '../repo.ts';
import { detectLogoType } from '../rules.ts';
import type { LogoView } from '../schemas.ts';

/**
 * The company's logo: set or replace it (admins and owners), read it (any member), remove it (admins and owners).
 * The image lives in Postgres (`company_logos`); its type is the one its first bytes show. Every change writes the
 * company's per-field audit row (field `logo`, the SHA-256 before and after, null for none) under the company's lock.
 */

/** Why an upload is refused, answered in the common error shape. */
export interface LogoRefusal {
  readonly ok: false;
  readonly status: 400 | 413 | 415;
  readonly code: 'logo_empty' | 'logo_too_large' | 'logo_type_unsupported';
  readonly message: string;
}

export const LOGO_TOO_LARGE: LogoRefusal = {
  ok: false,
  status: 413,
  code: 'logo_too_large',
  message: `A logo may be at most ${LOGO_MAX_BYTES} bytes (1 MB)`,
};

const EMPTY: LogoRefusal = { ok: false, status: 400, code: 'logo_empty', message: 'The file is empty' };

const UNSUPPORTED: LogoRefusal = {
  ok: false,
  status: 415,
  code: 'logo_type_unsupported',
  message: 'A logo must be a PNG, JPEG or WebP image',
};

const repo = companiesRepo();

/** The logo as the API shows it. */
export function logoView(info: LogoInfo): LogoView {
  return {
    version: logoVersion(info.sha256),
    contentType: info.contentType,
    size: info.size,
    updatedAt: info.updatedAt.toISOString(),
  };
}

/** Who changed the logo, in which request, from which SHA-256 to which (null for none). */
interface LogoChange {
  readonly actorPrincipalId: string;
  readonly requestId: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** The company's audit row of its `logo` field; none when the logo did not change. */
function auditLogo(tx: TenantDb, change: LogoChange) {
  return repo.audit(tx, {
    actorKind: 'user',
    actorPrincipalId: change.actorPrincipalId,
    requestId: change.requestId,
    entityType: 'company',
    entityId: tx.companyId,
    action: 'update',
    changes: diffFields({ logo: change.before }, { logo: change.after }),
  });
}

/**
 * Sets the company's logo from an uploaded file, replacing any it had, as the acting member's principal: 400
 * `logo_empty` for an empty file, 413 `logo_too_large` over 1 MB, 415 `logo_type_unsupported` unless its bytes are a
 * PNG, JPEG or WebP image.
 */
export async function uploadLogo(
  t: TenantDb,
  actorPrincipalId: string,
  file: Blob,
  requestId: string,
): Promise<{ ok: true; logo: LogoView } | LogoRefusal> {
  if (file.size === 0) return EMPTY;
  if (file.size > LOGO_MAX_BYTES) return LOGO_TOO_LARGE;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectLogoType(bytes);
  if (contentType === undefined) return UNSUPPORTED;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const saved = await t.transaction(async (tx) => {
    await tx.lockCompany();
    const before = (await logoRows.info(tx))?.sha256 ?? null;
    const values = { contentType, bytes, size: bytes.length, sha256, updatedByPrincipalId: actorPrincipalId };
    const row = await logoRows.save(tx, values);
    await auditLogo(tx, { actorPrincipalId, requestId, before, after: sha256 });
    return row;
  });
  return { ok: true, logo: logoView(saved) };
}

/** Removes the company's logo, as the acting member's principal; a company with none is fine and writes nothing. */
export async function removeLogo(t: TenantDb, actorPrincipalId: string, requestId: string): Promise<void> {
  await t.transaction(async (tx) => {
    await tx.lockCompany();
    const removed = await logoRows.remove(tx);
    if (removed !== undefined)
      await auditLogo(tx, { actorPrincipalId, requestId, before: removed, after: null });
  });
}

/** The company's logo with its bytes, or undefined when it has none. */
export const logoFile = (t: TenantDb): Promise<CompanyLogo | undefined> => logoRows.file(t);

/** The company's logo as company responses name it: its version, or null. */
export async function logoRefOf(t: TenantDb): Promise<LogoRef | null> {
  return logoRef((await logoRows.info(t))?.sha256);
}
