import type { DbHandle, Membership, TenantDb } from '@mwc/db';
import type { EmailMode } from '@mwc/shared/config';
import { type NotificationsRepo, notificationsRepo } from './repo.ts';
import {
  type AgentStatusChange,
  agentStatusNotices,
  type ChartMove,
  chartMoveNotices,
  deliverable,
  type MemberState,
  membershipNotices,
  type Notice,
} from './rules.ts';
import type { NotificationList, NotificationSettings } from './schemas.ts';
import { mentioned, mentionedTasks, namesOf, shown } from './service/names.ts';

/**
 * The notifications module's logic (S2.9, docs/notifications.md): writing a change's notices in the transaction that
 * makes it (`notify` and the `notice…` helpers the org and members modules call, and `membershipNoticeHook` the
 * identity store calls through its port), and a person's own list, read marks and email setting. The email delivery is
 * `service/delivery.ts`, run by the jobs loop.
 */

const repo: NotificationsRepo = notificationsRepo();

/**
 * Writes the notices of one change in the caller's transaction (`t`): never to `actor` about their own action (null:
 * the system made it), never to an agent, each once. Resolves to how many were written.
 */
export async function notify(t: TenantDb, actor: string | null, notices: readonly Notice[]): Promise<number> {
  const people = await repo.people(t, [...new Set(notices.map((notice) => notice.recipient))]);
  const rows = deliverable(notices, actor, people).map((notice) => ({
    recipientPrincipalId: notice.recipient,
    kind: notice.kind,
    payload: notice.payload,
    actorPrincipalId: actor,
  }));
  return repo.insert(t, rows);
}

/** A move on the chart: to the moved person and both managers (not the leaver's own when it is `leaving`). */
export const noticeChartMove = (
  t: TenantDb,
  actor: string | null,
  move: ChartMove,
  options: { readonly leaving?: boolean } = {},
) => notify(t, actor, chartMoveNotices(move, options));

/** An agent paused, resumed or archived: to the manager it reported to. */
export const noticeAgentStatus = (t: TenantDb, actor: string | null, change: AgentStatusChange) =>
  notify(t, actor, agentStatusNotices(change));

/** A membership whose status or role changed: to the person, or to whoever invited them when it starts. */
export async function noticeMembership(
  t: TenantDb,
  actor: string | null,
  before: Omit<MemberState, 'principalId'> | undefined,
  after: MemberState & Pick<Membership, 'invitationId'>,
): Promise<number> {
  const joining = (before === undefined || before.status === 'invited') && after.status === 'active';
  const inviter = joining && after.invitationId !== null ? await repo.inviterOf(t, after.invitationId) : null;
  return notify(t, actor, membershipNotices(before, after, inviter));
}

/**
 * The identity store's side (its `MemberChart.noticeChange`, composed in `createApp`): a membership the identity
 * provider changed (a webhook event, a reconcile, a first sign-in), by the system.
 */
export const membershipNoticeHook = {
  noticeChange: async (
    t: TenantDb,
    change: {
      readonly before: Omit<MemberState, 'principalId'> | undefined;
      readonly after: MemberState & Pick<Membership, 'invitationId'>;
    },
    by: { readonly actorPrincipalId?: string | null },
  ): Promise<void> => {
    await noticeMembership(t, by.actorPrincipalId ?? null, change.before, change.after);
  },
};

/** What an agent's question notice quotes of the first question. */
export const QUESTION_QUOTE_MAX = 200;

/**
 * An agent asked a question (S6c): every person who may answer it (the company's active admins and owners, as `POST
 * …/chats/{chatId}/answers` allows) hears of it, never the agent; it points at the chat. Written by the system.
 */
export async function noticeAgentQuestion(
  t: TenantDb,
  question: {
    readonly agentPrincipalId: string;
    readonly agentId: string;
    readonly chatId: string;
    readonly text: string;
  },
): Promise<number> {
  const line = question.text.replace(/\s+/g, ' ').trim();
  const detail = line.length <= QUESTION_QUOTE_MAX ? line : `${line.slice(0, QUESTION_QUOTE_MAX - 1)}…`;
  const payload = {
    about: question.agentPrincipalId,
    agent: question.agentId,
    chat: question.chatId,
    detail,
  };
  const recipients = await repo.answerers(t);
  return notify(
    t,
    null,
    recipients.map((recipient) => ({ kind: 'agent_question' as const, recipient, payload })),
  );
}

/** Notifications per page, unless asked for fewer. */
export const PAGE_SIZE = 20;

/** A person's own notifications, their unread count and their email setting (`routes.ts`). */
export function notificationsService(deps: { readonly db: DbHandle; readonly email: EmailMode }) {
  return {
    /** The person's notifications, newest first, a page before `before`, with how many are unread. */
    async list(
      t: TenantDb,
      principalId: string,
      options: { readonly before?: string | undefined; readonly limit?: number | undefined },
    ): Promise<NotificationList> {
      const limit = options.limit ?? PAGE_SIZE;
      const page = { limit: limit + 1, ...(options.before ? { before: options.before } : {}) };
      const rows = await repo.page(t, principalId, page);
      const more = rows.length > limit;
      const kept = rows.slice(0, limit);
      const names = await namesOf(deps.db, repo, t, mentioned(kept), mentionedTasks(kept));
      const notifications = kept.map((row) => ({
        id: row.id,
        kind: row.kind,
        ...shown(row, names, t.company.name),
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      }));
      const nextBefore = more ? (kept.at(-1)?.id ?? null) : null;
      return { notifications, unreadCount: await repo.unreadCount(t, principalId), nextBefore };
    },

    /** Marks the person's own notifications read (these ids, or all); answers the unread count after. */
    async markRead(t: TenantDb, principalId: string, ids: readonly string[] | 'all', at: Date) {
      await repo.markRead(t, principalId, ids, at);
      return { unreadCount: await repo.unreadCount(t, principalId) };
    },

    async settings(t: TenantDb, principalId: string): Promise<NotificationSettings> {
      return { email: await repo.emailOn(t, principalId), serverEmail: deps.email };
    },

    async saveSettings(t: TenantDb, principalId: string, email: boolean): Promise<NotificationSettings> {
      await repo.saveEmailSetting(t, principalId, email);
      return { email, serverEmail: deps.email };
    },
  };
}
