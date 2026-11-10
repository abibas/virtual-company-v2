import {
  agents,
  invitations,
  memberships,
  type Notification,
  notificationSettings,
  notifications,
  principals,
  type TenantDb,
} from '@mwc/db';
import type { NotificationKind } from '@mwc/shared/enums';
import { and, asc, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NoticePayload } from './rules.ts';

/**
 * The notifications' rows in one company, through the tenant layer: writing them, a person's page and unread count,
 * marking them read, the person's settings, the principals they name (people and agents), and their email state.
 */

/** A notification to write. */
export interface NewNotice {
  readonly recipientPrincipalId: string;
  readonly kind: NotificationKind;
  readonly payload: NoticePayload;
  readonly actorPrincipalId: string | null;
}

const mine = (recipient: string) => eq(notifications.recipientPrincipalId, recipient);

export function notificationsRepo() {
  return {
    async insert(t: TenantDb, rows: readonly NewNotice[]): Promise<number> {
      if (rows.length === 0) return 0;
      const written = await t
        .insert(
          notifications,
          rows.map((row) => ({ ...row, payload: { ...row.payload } })),
        )
        .returning({ id: notifications.id });
      return written.length;
    },

    /** Which of these principals are people (agents get no notifications). */
    async people(t: TenantDb, ids: readonly string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const rows = await t.selectFields(
        principals,
        { id: principals.id },
        and(inArray(principals.id, [...ids]), eq(principals.kind, 'person')),
      );
      return new Set(rows.map((row) => row.id));
    },

    /** Who sent an invitation here (null: nobody here, or no such invitation). */
    async inviterOf(t: TenantDb, invitationId: string): Promise<string | null> {
      const [row] = await t.selectFields(
        invitations,
        { by: invitations.invitedByPrincipalId },
        eq(invitations.id, invitationId),
      );
      return row?.by ?? null;
    },

    /** A person's notifications, newest first, `limit` of them before `before` (an id: they are made in order). */
    page(t: TenantDb, recipient: string, options: { readonly before?: string; readonly limit: number }) {
      const where =
        options.before === undefined
          ? mine(recipient)
          : and(mine(recipient), lt(notifications.id, options.before));
      return t.select(notifications, where).orderBy(desc(notifications.id)).limit(options.limit);
    },

    async unreadCount(t: TenantDb, recipient: string): Promise<number> {
      const [row] = await t.selectFields(
        notifications,
        { n: count() },
        and(mine(recipient), isNull(notifications.readAt)),
      );
      return row?.n ?? 0;
    },

    /** Marks a person's unread notifications read: these ids, or all of them. */
    async markRead(t: TenantDb, recipient: string, ids: readonly string[] | 'all', at: Date): Promise<void> {
      const which = ids === 'all' ? undefined : inArray(notifications.id, [...ids]);
      await t.update(
        notifications,
        { readAt: at },
        and(mine(recipient), isNull(notifications.readAt), which),
      );
    },

    /** Whether the person gets emails here: on unless they turned it off. */
    async emailOn(t: TenantDb, principalId: string): Promise<boolean> {
      const [row] = await t.select(notificationSettings, eq(notificationSettings.principalId, principalId));
      return row?.email ?? true;
    },

    async saveEmailSetting(t: TenantDb, principalId: string, email: boolean): Promise<void> {
      await t.insert(notificationSettings, { principalId, email }).onConflictDoUpdate({
        target: [notificationSettings.companyId, notificationSettings.principalId],
        set: { email, updatedAt: new Date() },
      });
    },

    /** The memberships of these principals: whose person they are, and how they stand. */
    members(t: TenantDb, ids: readonly string[]) {
      if (ids.length === 0) return Promise.resolve([]);
      const fields = {
        principalId: memberships.principalId,
        userId: memberships.userId,
        status: memberships.status,
      };
      return t.selectFields(memberships, fields, inArray(memberships.principalId, [...ids]));
    },

    /** The agents of these principals: their names and slugs. */
    agents(t: TenantDb, ids: readonly string[]) {
      if (ids.length === 0) return Promise.resolve([]);
      const fields = { principalId: agents.principalId, name: agents.name, slug: agents.slug };
      return t.selectFields(agents, fields, inArray(agents.principalId, [...ids]));
    },

    /** A person's notices whose email is still pending, oldest first. */
    pending(t: TenantDb, recipient: string): Promise<Notification[]> {
      return t
        .select(notifications, and(mine(recipient), eq(notifications.emailStatus, 'pending')))
        .orderBy(asc(notifications.id));
    },

    /** Records an email outcome on these notices, while they are still pending. */
    async recordEmail(t: TenantDb, ids: readonly string[], set: EmailOutcome): Promise<void> {
      if (ids.length === 0) return;
      await t.update(
        notifications,
        set,
        and(inArray(notifications.id, [...ids]), eq(notifications.emailStatus, 'pending')),
      );
    },
  };
}

/** The email columns an outcome sets. */
export type EmailOutcome = Partial<
  Pick<Notification, 'emailStatus' | 'emailNextAt' | 'emailAttempts' | 'emailedAt' | 'emailError'>
>;

export type NotificationsRepo = ReturnType<typeof notificationsRepo>;
