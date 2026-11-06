import { type EnrollmentTokenRow, enrollmentTokens, type TenantDb } from '@mwc/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

/** Enrollment tokens (`enrollment_tokens`), through the company's tenant: only their SHA-256 is stored. */

async function insert(
  t: TenantDb,
  values: { secretHash: string; expiresAt: Date; createdBy: string },
): Promise<EnrollmentTokenRow> {
  const [row] = (await t.insert(enrollmentTokens, values).returning()) as [EnrollmentTokenRow];
  return row;
}

async function get(t: TenantDb, id: string): Promise<EnrollmentTokenRow | undefined> {
  const [row] = await t.select(enrollmentTokens, eq(enrollmentTokens.id, id));
  return row;
}

/**
 * Uses the token at `now` if it is unused and not expired, in one statement, so two enrollments racing for one token
 * cannot both have it; returns it, or undefined when it could not be used.
 */
async function claim(t: TenantDb, id: string, now: Date): Promise<EnrollmentTokenRow | undefined> {
  const usable = and(
    eq(enrollmentTokens.id, id),
    isNull(enrollmentTokens.usedAt),
    gt(enrollmentTokens.expiresAt, now),
  );
  const [row] = await t.update(enrollmentTokens, { usedAt: now }, usable).returning();
  return row;
}

/** Records the machine a used token made. */
async function madeMachine(t: TenantDb, id: string, machineId: string): Promise<void> {
  await t.update(enrollmentTokens, { machineId }, eq(enrollmentTokens.id, id));
}

export const enrollmentRepo = { insert, get, claim, madeMachine };
