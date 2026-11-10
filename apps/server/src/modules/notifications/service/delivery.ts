import type { DbHandle, Notification, TenantDb } from '@mwc/db';
import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';
import type { EmailSender } from '../../../platform/email/port.ts';
import { outboxTenant } from '../../../platform/jobs/outbox.ts';
import { describeFailure } from '../../../platform/jobs/retry.ts';
import { profileOf } from '../../identity/service.ts';
import { type DueRecipient, dueRecipients, stampQueued } from '../repo/delivery.ts';
import { type NotificationsRepo, notificationsRepo } from '../repo.ts';
import { noticeEmail } from '../rules/words.ts';
import { afterFailure, batchReady } from '../rules.ts';
import { mentioned, namesOf, shown } from './names.ts';

/**
 * The notification emails (S2.9, docs/notifications.md), one pass of the jobs loop: the new pending notices are stamped
 * with the loop's clock, then each person whose batch is due (a quiet minute after their newest notice, five at most
 * after their oldest, no retry waiting) gets one plain email of their unread notices through the `EmailSender`. A
 * failed send is tried again with the jobs' backoff and given up after the last try; notices read in the app first,
 * a person who turned email off, one with no address and a server with email off skip it. Every outcome is recorded on
 * the notices (`email_status`, `emailed_at`, `email_error`).
 */

/** People one pass emails at most. */
export const DELIVERY_BATCH = 20;

export interface DeliveryDeps {
  readonly db: DbHandle;
  readonly clock: () => Date;
  readonly logger: Logger;
  readonly config: Pick<Config, 'MWC_WEB_ORIGIN'>;
  /** The sender MWC_EMAIL names; none: every due email is skipped. */
  readonly email: EmailSender | undefined;
}

type Outcome = 'sent' | 'skipped' | 'retry' | 'failed' | 'waiting';

/** What one pass did: the notices it saw first, and each due person's outcome. */
export type EmailDelivery = { readonly queued: number } & Readonly<Record<Outcome, number>>;

/** Why a batch is not emailed, or undefined when it is. */
export const SKIPPED = {
  read: 'read in the app first',
  off: 'email is off on this server',
  person: 'the person turned email off',
  address: 'no email address',
} as const;

const ids = (rows: readonly Notification[]) => rows.map((row) => row.id);

/**
 * Where a batch goes: the sender and the person's address, or why it is skipped (email off on the server or for them,
 * or no address: their profile is gone, never while memberships keep their key).
 */
async function target(
  deps: DeliveryDeps,
  repo: NotificationsRepo,
  t: TenantDb,
  principalId: string,
): Promise<{ readonly email: EmailSender; readonly to: string } | { readonly skipped: string }> {
  if (deps.email === undefined) return { skipped: SKIPPED.off };
  if (!(await repo.emailOn(t, principalId))) return { skipped: SKIPPED.person };
  const [member] = await repo.members(t, [principalId]);
  const to = member && (await profileOf(deps.db, member.userId))?.primaryEmail;
  return to ? { email: deps.email, to } : { skipped: SKIPPED.address };
}

/** Sends one batch and records the outcome on its notices. */
async function send(
  deps: DeliveryDeps & { readonly email: EmailSender },
  t: TenantDb,
  batch: { readonly to: string; readonly rows: readonly Notification[]; readonly now: Date },
): Promise<Outcome> {
  const repo = notificationsRepo();
  const names = await namesOf(deps.db, repo, t, mentioned(batch.rows));
  const lines = batch.rows.map((row) => {
    const { text, actor, path } = shown(row, names, t.company.name);
    return { text, actor: actor?.name ?? null, path };
  });
  const mail = noticeEmail(lines, t.company, deps.config.MWC_WEB_ORIGIN);
  const tried = afterFailure(batch.rows, batch.now);
  try {
    await deps.email.send({ to: batch.to, ...mail });
  } catch (error) {
    const emailError = describeFailure(error);
    const failed = tried.nextAt === null;
    deps.logger.warn(
      { companyId: t.companyId, notices: batch.rows.length, attempts: tried.attempts, failed, emailError },
      'notification email failed',
    );
    await repo.recordEmail(t, ids(batch.rows), {
      emailAttempts: tried.attempts,
      emailError,
      ...(failed ? { emailStatus: 'failed' as const } : { emailNextAt: tried.nextAt }),
    });
    return failed ? 'failed' : 'retry';
  }
  await repo.recordEmail(t, ids(batch.rows), {
    emailStatus: 'sent',
    emailedAt: batch.now,
    emailAttempts: tried.attempts,
    emailError: null,
  });
  return 'sent';
}

/** One person's due batch: skipped (and why), sent, or tried again later. */
async function deliverTo(deps: DeliveryDeps, due: DueRecipient, now: Date): Promise<Outcome> {
  const t = await outboxTenant(deps.db, due.companyId);
  if (t === undefined) return 'waiting';
  const repo = notificationsRepo();
  const rows = await repo.pending(t, due.recipientPrincipalId);
  if (!batchReady(rows, now)) return 'waiting';
  const read = rows.filter((row) => row.readAt !== null);
  const unread = rows.filter((row) => row.readAt === null);
  await repo.recordEmail(t, ids(read), { emailStatus: 'skipped', emailError: SKIPPED.read });
  if (unread.length === 0) return 'skipped';
  const goes = await target(deps, repo, t, due.recipientPrincipalId);
  if ('skipped' in goes) {
    await repo.recordEmail(t, ids(unread), { emailStatus: 'skipped', emailError: goes.skipped });
    return 'skipped';
  }
  return send({ ...deps, email: goes.email }, t, { to: goes.to, rows: unread, now });
}

/** One pass: stamps the new notices, then emails each due person (`DELIVERY_BATCH` at most). */
export async function deliverEmails(deps: DeliveryDeps): Promise<EmailDelivery> {
  const now = deps.clock();
  const queued = await stampQueued(deps.db, now);
  const tally = { queued, sent: 0, skipped: 0, retry: 0, failed: 0, waiting: 0 };
  for (const due of await dueRecipients(deps.db, now, DELIVERY_BATCH))
    tally[await deliverTo(deps, due, now)]++;
  return tally;
}
