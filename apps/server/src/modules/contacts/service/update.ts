import { auditChanges, diffFields, type TenantDb } from '@mwc/db';
import { contactsRepo as repo } from '../repo.ts';
import { auditedContact, contactView, noteOf } from '../rules.ts';
import type { ContactChange, ContactView } from '../schemas.ts';

/**
 * Admins and owners change a contact (2026-11-14, docs/subscriptions.md "Contacts"): its note (blank removes it) and
 * whether it is archived (hidden from the list and the org chart; its conversations stay). Audited as the person
 * (`update`, `archive`, `unarchive`); a change that changes nothing writes nothing.
 */

export const CONTACT_NOT_FOUND = {
  ok: false,
  status: 404,
  code: 'contact_not_found',
  message: 'No such contact',
} as const;

/** Who changes it: their principal and the request. */
export interface ContactCaller {
  readonly principalId: string;
  readonly requestId: string;
}

/** Changes the contact (see above); the contact as it is now, or 404. */
export async function changeContact(
  t: TenantDb,
  caller: ContactCaller,
  contactId: string,
  change: ContactChange,
  now: Date,
): Promise<{ readonly ok: true; readonly contact: ContactView } | typeof CONTACT_NOT_FOUND> {
  const row = await repo.get(t, contactId);
  if (row === undefined) return CONTACT_NOT_FOUND;
  const note = change.note === undefined ? row.note : noteOf(change.note);
  const archivedAt =
    change.archived === undefined ? row.archivedAt : change.archived ? (row.archivedAt ?? now) : null;
  if (note === row.note && archivedAt === row.archivedAt) return { ok: true, contact: contactView(row) };
  const updated = (await repo.update(t, row.id, { note, archivedAt })) ?? row;
  const action = archivedAt === row.archivedAt ? 'update' : archivedAt === null ? 'unarchive' : 'archive';
  await auditChanges(t, {
    actorKind: 'user',
    actorPrincipalId: caller.principalId,
    requestId: caller.requestId,
    entityType: 'contact',
    entityId: row.id,
    action,
    changes: diffFields(auditedContact(row), auditedContact(updated)),
  });
  return { ok: true, contact: contactView(updated) };
}
