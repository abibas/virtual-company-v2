import type { ExternalUser } from '@mwc/shared/identity';
import { type IdentityStore, identityKeys, type StoredUser } from '../store.ts';
import {
  change,
  diff,
  type Event,
  type ProjectionChange,
  type ProjectionContext,
  type Replay,
} from './changes.ts';

const USER_FIELDS = ['primaryEmail', 'displayName', 'imageUrl', 'status'] as const;

export async function projectUserUpserted(
  event: Event<'user.upserted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
  replay: Replay,
): Promise<ProjectionChange[]> {
  const data: ExternalUser = event.data;
  const key = identityKeys.user(ctx.issuer, data.subject);
  const [existing, mark] = await Promise.all([store.getUser(ctx.issuer, data.subject), store.getMark(key)]);
  const changes: ProjectionChange[] = [];
  if (existing && mark?.at != null && data.updatedAt <= mark.at) {
    changes.push(change(event, 'user', 'ignored', { id: existing.id, reason: 'not_newer' }));
  } else {
    // A deleted user stays deactivated; an upsert older than the deletion still fills in a user never
    // seen before, so every order ends with the same row.
    const deleted = mark?.deleted ?? false;
    const next = {
      issuer: ctx.issuer,
      subject: data.subject,
      primaryEmail: data.primaryEmail.toLowerCase(),
      displayName: data.displayName,
      imageUrl: data.imageUrl ?? null,
      status: deleted ? ('deactivated' as const) : (existing?.status ?? ('active' as const)),
    };
    const saved = await store.upsertUser(next);
    await store.setMark(key, { at: Math.max(mark?.at ?? data.updatedAt, data.updatedAt), deleted });
    const fields = diff<Omit<StoredUser, 'id'>>(existing, next, USER_FIELDS);
    if (!existing) changes.push(change(event, 'user', 'created', { id: saved.id, fields }));
    else if (fields.length > 0) changes.push(change(event, 'user', 'updated', { id: saved.id, fields }));
  }
  changes.push(...(await replay(key)));
  return changes;
}

export async function projectUserDeleted(
  event: Event<'user.deleted'>,
  store: IdentityStore,
  ctx: ProjectionContext,
): Promise<ProjectionChange[]> {
  const key = identityKeys.user(ctx.issuer, event.data.subject);
  const mark = await store.getMark(key);
  if (!mark?.deleted) await store.setMark(key, { at: mark?.at ?? null, deleted: true });
  const user = await store.getUser(ctx.issuer, event.data.subject);
  if (!user) return [change(event, 'user', 'ignored', { reason: 'unknown_user' })];
  const changes: ProjectionChange[] = [];
  if (user.status !== 'deactivated') {
    await store.upsertUser({ ...user, status: 'deactivated' });
    changes.push(
      change(event, 'user', 'deactivated', {
        id: user.id,
        fields: [{ field: 'status', old: user.status, new: 'deactivated' }],
      }),
    );
  }
  // A deleted person keeps no membership: the same end state as if each membership's deletion had come.
  for (const membership of await store.listMemberships({ userId: user.id })) {
    if (membership.status === 'removed') continue;
    const { id, ...rest } = membership;
    await store.upsertMembership({ ...rest, status: 'removed' });
    changes.push(
      change(event, 'membership', 'removed', {
        id,
        companyId: membership.companyId,
        fields: [{ field: 'status', old: membership.status, new: 'removed' }],
        reason: 'user_deleted',
      }),
    );
  }
  return changes.length > 0
    ? changes
    : [change(event, 'user', 'ignored', { id: user.id, reason: 'already_deleted' })];
}
