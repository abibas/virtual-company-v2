import { notifications } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { testConfig } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { moduleJobs } from '../../../../src/app.ts';
import { EMAIL_MAX_ATTEMPTS } from '../../../../src/modules/notifications/rules.ts';
import { deliverEmails, SKIPPED } from '../../../../src/modules/notifications/service/delivery.ts';
import type { EmailSender } from '../../../../src/platform/email/port.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { companyName, memoryEmail, notificationsPath, rowsFor } from '../../../fixtures/notifications.ts';
import { placedMember, positionPath } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// The notification emails (S2.9): a person's notices of a quiet minute go out as one plain email through the sender,
// failed sends are tried again with the backoff and given up after the last try, and a person who turned email off,
// a server with email off and notices read in the app first are skipped. The clock is the test's: nothing waits.

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());
// Each test sees only its own pending notices.
beforeEach(async () => {
  await rawDb(w.t.db)
    .update(notifications)
    .set({ emailStatus: 'skipped' })
    .where(eq(notifications.emailStatus, 'pending'));
});

const SECOND = 1000;
const tick = (email: EmailSender | undefined) =>
  deliverEmails({ db: w.t.db, clock: w.clock, logger: w.t.logger, config: testConfig, email });

const emailOf = (person: Person) => `${person.subject}@people.test`;

/** The owner moves `who` under `to`. */
async function move(company: MembersCompany, who: Person, to: Person) {
  const res = await as(w, company.owner)('PUT', positionPath(company, who.principalId), {
    reportsToPrincipalId: to.principalId,
  });
  expect(res.status).toBe(200);
}

async function team() {
  const company = await membersCompany(w);
  const anna = await placedMember(w, company, 'admin');
  const mia = await placedMember(w, company, 'member');
  return { company, anna, mia, name: await companyName(w.t.db, company.companyId) };
}

describe('batching', () => {
  it('sends several moves within a minute as one email per person, a quiet minute after the last', async () => {
    const { company, anna, mia, name } = await team();
    const email = memoryEmail();
    await move(company, mia, anna);
    expect(await tick(email)).toMatchObject({ queued: 2, sent: 0 });
    w.clock.advance(30 * SECOND);
    await move(company, mia, company.owner);
    expect(await tick(email)).toMatchObject({ queued: 2, sent: 0 });
    w.clock.advance(59 * SECOND);
    expect(await tick(email)).toMatchObject({ queued: 0, sent: 0 });
    w.clock.advance(SECOND);
    expect(await tick(email)).toMatchObject({ sent: 2 });
    const [toMia, ...others] = email.sent.filter((mail) => mail.to === emailOf(mia));
    expect(others).toEqual([]);
    expect(toMia?.subject).toBe(`2 changes for you in ${name}`);
    expect(toMia?.text).toContain(`- You now report to ${anna.subject} (by Owner ${company.owner.subject}).`);
    expect(toMia?.text).toContain(`/structure\n`);
    expect(email.sent.filter((mail) => mail.to === emailOf(anna))).toHaveLength(1);
    // The owner moved them: no email of their own.
    expect(email.sent.map((mail) => mail.to)).not.toContain(`${company.owner.subject}@owners.test`);
    for (const row of await rowsFor(w.t.db, company.companyId, mia.principalId)) {
      expect(row).toMatchObject({
        emailStatus: 'sent',
        emailedAt: w.clock(),
        emailAttempts: 1,
        emailError: null,
      });
    }
    expect(await tick(email)).toMatchObject({ queued: 0, sent: 0 });
  });

  it('never holds a busy person’s email longer than five minutes', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    for (let i = 0; i < 7; i++) {
      await move(company, mia, i % 2 === 0 ? anna : company.owner);
      await tick(email);
      w.clock.advance(50 * SECOND);
    }
    const toMia = email.sent.filter((mail) => mail.to === emailOf(mia));
    expect(toMia).toHaveLength(1);
    expect(toMia[0]?.subject).toMatch(/^7 changes for you in /);
  });
});

describe('retries', () => {
  it('tries a failed email again after the backoff, logging the failure', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    await move(company, mia, anna);
    await tick(email);
    w.clock.advance(60 * SECOND);
    email.fail(emailOf(mia), 1);
    const before = w.t.logs.length;
    expect(await tick(email)).toMatchObject({ sent: 1, retry: 1 });
    expect(email.sent.map((mail) => mail.to)).toEqual([emailOf(anna)]);
    const [row] = await rowsFor(w.t.db, company.companyId, mia.principalId);
    expect(row).toMatchObject({
      emailStatus: 'pending',
      emailAttempts: 1,
      emailError: 'the mail server said no',
      emailNextAt: new Date(w.clock().getTime() + 30 * SECOND),
    });
    expect(w.t.logs.slice(before).find((line) => line.msg === 'notification email failed')).toMatchObject({
      attempts: 1,
      failed: false,
    });
    w.clock.advance(29 * SECOND);
    expect(await tick(email)).toMatchObject({ sent: 0, retry: 0 });
    w.clock.advance(SECOND);
    expect(await tick(email)).toMatchObject({ sent: 1 });
    expect((await rowsFor(w.t.db, company.companyId, mia.principalId))[0]).toMatchObject({
      emailStatus: 'sent',
      emailAttempts: 2,
      emailError: null,
    });
  });

  it('gives up after the last try', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    await move(company, mia, anna);
    await tick(email);
    email.fail(emailOf(mia), 2 * EMAIL_MAX_ATTEMPTS);
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i++) {
      w.clock.advance(2 * 3600 * SECOND);
      await tick(email);
    }
    expect((await rowsFor(w.t.db, company.companyId, mia.principalId))[0]).toMatchObject({
      emailStatus: 'failed',
      emailAttempts: EMAIL_MAX_ATTEMPTS,
      emailError: 'the mail server said no',
    });
    w.clock.advance(2 * 3600 * SECOND);
    expect(await tick(email)).toMatchObject({ sent: 0, retry: 0, failed: 0 });
  });
});

describe('skips', () => {
  it('skips a person who turned email off, and a server with email off', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    expect((await as(w, mia)('PUT', notificationsPath(company, '/settings'), { email: false })).status).toBe(
      200,
    );
    await move(company, mia, anna);
    await tick(email);
    w.clock.advance(60 * SECOND);
    await tick(email);
    expect(email.sent.map((mail) => mail.to)).toEqual([emailOf(anna)]);
    expect((await rowsFor(w.t.db, company.companyId, mia.principalId))[0]).toMatchObject({
      emailStatus: 'skipped',
      emailError: SKIPPED.person,
    });
    await move(company, mia, company.owner);
    await tick(undefined);
    w.clock.advance(60 * SECOND);
    expect(await tick(undefined)).toMatchObject({ skipped: 2, sent: 0 });
    expect((await rowsFor(w.t.db, company.companyId, anna.principalId))[1]).toMatchObject({
      emailStatus: 'skipped',
      emailError: SKIPPED.off,
    });
  });

  it('skips what was read in the app first and sends the rest', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    await move(company, mia, anna);
    await move(company, mia, company.owner);
    const [newest] = await rowsFor(w.t.db, company.companyId, mia.principalId).then((rows) => rows.reverse());
    await as(w, mia)('POST', notificationsPath(company, '/read'), { ids: [newest?.id] });
    await tick(email);
    w.clock.advance(60 * SECOND);
    await tick(email);
    const toMia = email.sent.filter((mail) => mail.to === emailOf(mia));
    expect(toMia.map((mail) => mail.subject)).toEqual([`You now report to ${anna.subject}`]);
    const read = (await rowsFor(w.t.db, company.companyId, mia.principalId)).find(
      (row) => row.id === newest?.id,
    );
    expect(read).toMatchObject({ emailStatus: 'skipped', emailError: SKIPPED.read });
    // All of anna's read: nothing to send.
    await as(w, anna)('POST', notificationsPath(company, '/read'), { all: true });
    await move(company, mia, anna);
    await as(w, anna)('POST', notificationsPath(company, '/read'), { all: true });
    await tick(email);
    w.clock.advance(60 * SECOND);
    expect(await tick(email)).toMatchObject({ skipped: 1 });
  });
});

describe('the jobs loop', () => {
  it('sends through the sender passed in, else the one MWC_EMAIL names (none in tests)', async () => {
    const { company, anna, mia } = await team();
    const email = memoryEmail();
    const deps = {
      db: w.t.db,
      config: testConfig,
      logger: w.t.logger,
      version: 'test',
      clock: w.clock,
      identity: w.fake,
    };
    await move(company, mia, anna);
    await moduleJobs({ ...deps, email }).notifications();
    w.clock.advance(60 * SECOND);
    expect(await moduleJobs({ ...deps, email }).notifications()).toMatchObject({ sent: 2 });
    await move(company, mia, company.owner);
    await moduleJobs(deps).notifications();
    w.clock.advance(60 * SECOND);
    expect(await moduleJobs(deps).notifications()).toMatchObject({ sent: 0, skipped: 2 });
  });
});
