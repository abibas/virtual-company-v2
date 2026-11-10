/**
 * The notifications tests' helpers (S2.9): a person's notifications as the API answers them and as the table holds
 * them, the identity store with the notifications' side of a membership's change (as `createApp` composes it), and
 * email senders that keep what they were given, fail on purpose, or both.
 */
import { companies, type DbHandle, notifications } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { dbIdentityStore } from '../../src/modules/identity/repo.ts';
import { membershipNoticeHook } from '../../src/modules/notifications/index.ts';
import type { NotificationList } from '../../src/modules/notifications/schemas.ts';
import type { EmailMessage, EmailSender } from '../../src/platform/email/port.ts';
import { as, type MembersCompany } from './members/members.ts';
import { testChart } from './org.ts';
import type { AuthWorld, Person } from './platform/auth.ts';

export const notificationsPath = (company: Pick<MembersCompany, 'companyId'>, rest = '') =>
  `/api/companies/${company.companyId}/notifications${rest}`;

/** The person's notifications as the API answers them (the test fails on anything but a 200). */
export async function inboxOf(
  w: AuthWorld,
  company: Pick<MembersCompany, 'companyId'>,
  person: Person,
  query = '',
): Promise<NotificationList> {
  const res = await as(w, person)('GET', notificationsPath(company, query));
  expect(res.status).toBe(200);
  return res.body as NotificationList;
}

/** What the person's notifications say, newest first. */
export const textsOf = async (w: AuthWorld, company: Pick<MembersCompany, 'companyId'>, person: Person) =>
  (await inboxOf(w, company, person)).notifications.map((notice) => notice.text);

/** Every notification row of a company, oldest first, as `[recipient, kind, actor]`. */
export async function rowsOf(db: DbHandle, companyId: string) {
  const rows = await rawDb(db)
    .select()
    .from(notifications)
    .where(eq(notifications.companyId, companyId))
    .orderBy(asc(notifications.id));
  return rows.map((row) => [row.recipientPrincipalId, row.kind, row.actorPrincipalId] as const);
}

/** One recipient's notification rows, oldest first. */
export const rowsFor = (db: DbHandle, companyId: string, principalId: string) =>
  rawDb(db)
    .select()
    .from(notifications)
    .where(and(eq(notifications.companyId, companyId), eq(notifications.recipientPrincipalId, principalId)))
    .orderBy(asc(notifications.id));

/** The company's name, as the notices' words use it. */
export async function companyName(db: DbHandle, companyId: string): Promise<string> {
  const [row] = await rawDb(db).select().from(companies).where(eq(companies.id, companyId));
  return row?.name as string;
}

/** The database identity store with the org chart's and the notifications' sides, as `createApp` composes them. */
export const noticingStore = (w: AuthWorld, requestId = 'req-store') =>
  dbIdentityStore(w.t.db, {
    provider: 'fake',
    chart: { ...testChart(), ...membershipNoticeHook },
    requestId,
  });

/** An email sender that keeps every email, and fails the next `times` sends to `to` first. */
export function memoryEmail(): EmailSender & {
  readonly sent: EmailMessage[];
  fail(to: string, times: number): void;
} {
  const sent: EmailMessage[] = [];
  const failures = new Map<string, number>();
  return {
    kind: 'test',
    sent,
    fail: (to, times) => {
      failures.set(to, times);
    },
    async send(message) {
      const left = failures.get(message.to) ?? 0;
      if (left > 0) {
        failures.set(message.to, left - 1);
        throw new Error('the mail server said no');
      }
      sent.push(message);
    },
  };
}
