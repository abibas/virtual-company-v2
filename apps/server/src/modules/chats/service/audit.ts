import { auditChanges, type Chat, diffFields, type TenantDb } from '@mwc/db';

/** A chat's changes in the audit log (entity `chat`): the audited fields, before and after, as the caller made them. */

/** The audited fields of a chat. */
const audited = (row: Chat) => ({
  agentId: row.agentId,
  harness: row.harness,
  machineId: row.machineId,
  profileId: row.profileId,
  title: row.title,
  mode: row.mode,
  model: row.model,
  effort: row.effort,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

/** Who acted, for the log: their principal and the request. */
export interface AuditCaller {
  readonly principalId: string;
  readonly requestId: string;
}

/**
 * Logs a chat's change (`create`, `update`, `archive`, `branch`); `before` is null for a new chat, `caller` null for one
 * Most Wanted made itself (S6c: a flow's team chat). A new chat with several people names the others it began with
 * (`people`, their principals; 2026-11-14).
 */
export const auditChat = (
  t: TenantDb,
  caller: AuditCaller | null,
  row: Chat,
  action: string,
  before: Chat | null,
  people: readonly string[] = [],
) =>
  auditChanges(t, {
    actorKind: caller === null ? 'system' : 'user',
    actorPrincipalId: caller?.principalId ?? null,
    requestId: caller?.requestId ?? null,
    entityType: 'chat',
    entityId: row.id,
    action,
    changes: [
      ...diffFields(before === null ? null : audited(before), audited(row)),
      ...(people.length === 0 ? [] : [{ field: 'people', old: null, new: [...people] }]),
    ],
  });
