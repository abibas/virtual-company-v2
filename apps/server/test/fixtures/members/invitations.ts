/**
 * The invitation tests' helpers: invitations sent through the API, the outbox rows they leave run by their real
 * handlers against the fake provider, people signing up and accepting at the fake, and raw reads of the invitation
 * and outbox rows. Companies and members come from members.ts.
 */
import { type IdentityOutboxRow, invitations } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { MembershipRole } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import type { InvitationView, MemberView } from '../../../src/modules/members/schemas.ts';
import { invitationOutboxHandlers } from '../../../src/modules/members/service/invitation-provider.ts';
import { memberOutboxHandlers } from '../../../src/modules/members/service/provider.ts';
import { type OutboxOutcome, processOutboxRow } from '../../../src/platform/jobs/outbox.ts';
import { outboxOf } from '../companies/companies.ts';
import { type AuthWorld, newSubject, type Person } from '../platform/auth.ts';
import { as, type MembersCompany } from './members.ts';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const invitationsPath = (company: MembersCompany) => `/api/companies/${company.companyId}/invitations`;

/** Invites `email` with `role` through the API as `by` (the owner by default); the test fails on anything but 201. */
export async function invite(
  w: AuthWorld,
  company: MembersCompany,
  email: string,
  role: MembershipRole = 'member',
  by: Person = company.owner,
): Promise<InvitationView> {
  const res = await as(w, by)('POST', invitationsPath(company), { email, role });
  if (res.status !== 201)
    throw new Error(`POST invitations answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as InvitationView;
}

/** The handlers of every op an invitation flow enqueues, on the test's fake and clock. */
export function flowHandlers(w: AuthWorld) {
  const deps = { db: w.t.db, identity: w.fake, clock: w.clock };
  return { ...memberOutboxHandlers(deps), ...invitationOutboxHandlers(deps) };
}

/** The company's outbox rows (of `op` when given), oldest first (ids are UUID v7, made in order). */
export const outboxRows = async (w: AuthWorld, companyId: string, op?: IdentityOutboxRow['op']) =>
  (await outboxOf(w.t.db, companyId))
    .filter((row) => op === undefined || row.op === op)
    .sort((a, b) => a.id.localeCompare(b.id));

/** Runs one row with its op's handler, as the jobs loop will. */
export function runRow(w: AuthWorld, row: IdentityOutboxRow): Promise<OutboxOutcome> {
  const handler = flowHandlers(w)[row.op];
  if (handler === undefined) throw new Error(`no handler for ${row.op} in an invitation flow`);
  return processOutboxRow({ db: w.t.db, clock: w.clock }, row, handler);
}

/** Runs the company's pending rows of the flow's ops once each, oldest first; returns their outcomes in order. */
export async function runOutbox(w: AuthWorld, companyId: string): Promise<OutboxOutcome[]> {
  const handlers = flowHandlers(w);
  const outcomes: OutboxOutcome[] = [];
  for (const row of await outboxRows(w, companyId)) {
    if (row.status !== 'pending' || !(row.op in handlers)) continue;
    outcomes.push(await runRow(w, row));
  }
  return outcomes;
}

export const invitationRow = async (w: AuthWorld, id: string) =>
  (await rawDb(w.t.db).select().from(invitations).where(eq(invitations.id, id)))[0];

/** The provider invitation the local invitation follows now (the test fails when it follows none). */
export async function providerInvitationOf(w: AuthWorld, id: string): Promise<string> {
  const external = (await invitationRow(w, id))?.externalInvitationId;
  if (!external) throw new Error(`invitation ${id} follows no provider invitation`);
  return external;
}

/** A person who signs up at the fake (not linked here yet), with this email or a fresh one. */
export function signUp(w: AuthWorld, email?: string): { subject: string; email: string } {
  const subject = newSubject('invitee');
  const address = email ?? `${subject}@invitees.test`;
  w.fake.createUser({ subject, email: address, displayName: `Invitee ${subject}` });
  return { subject, email: address };
}

/** The person accepts at the fake the provider invitation the local invitation follows. */
export async function acceptAtProvider(w: AuthWorld, invitationId: string, subject: string) {
  return w.fake.accept(await providerInvitationOf(w, invitationId), subject);
}

/** The company's member list as its owner sees it through the API. */
export async function membersOf(w: AuthWorld, company: MembersCompany): Promise<MemberView[]> {
  const res = await as(w, company.owner)('GET', company.members);
  return (res.body as { members: MemberView[] }).members;
}

/** The member list's entry for this subject's person, found by their email at the fake. */
export async function memberWithEmail(w: AuthWorld, company: MembersCompany, email: string) {
  return (await membersOf(w, company)).find((member) => member.email === email);
}
