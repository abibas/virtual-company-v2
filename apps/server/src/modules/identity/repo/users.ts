import { isUuid, type User, type UserIdentity, userIdentities, users } from '@mwc/db';
import type { RawDb } from '@mwc/db/system';
import type { NewStoredUser, StoredUser } from '@mwc/identity-core';
import { and, asc, eq } from 'drizzle-orm';

/** Users with the identity that names them: `users` joined with `user_identities` on `(issuer, subject)`. */

function stored(user: User, identity: UserIdentity): StoredUser {
  return {
    id: user.id,
    issuer: identity.issuer,
    subject: identity.subject,
    primaryEmail: user.primaryEmail,
    displayName: user.displayName,
    imageUrl: user.imageUrl,
    status: user.status,
  };
}

function withIdentity(db: RawDb) {
  return db
    .select({ user: users, identity: userIdentities })
    .from(userIdentities)
    .innerJoin(users, eq(users.id, userIdentities.userId));
}

export async function getUser(db: RawDb, issuer: string, subject: string): Promise<StoredUser | undefined> {
  const [row] = await withIdentity(db).where(
    and(eq(userIdentities.issuer, issuer), eq(userIdentities.subject, subject)),
  );
  return row && stored(row.user, row.identity);
}

/** The user with their identity at this provider (the oldest, should they have several). */
export async function getUserById(db: RawDb, id: string, provider: string): Promise<StoredUser | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await withIdentity(db)
    .where(and(eq(users.id, id), eq(userIdentities.provider, provider)))
    .orderBy(asc(userIdentities.createdAt), asc(userIdentities.id))
    .limit(1);
  return row && stored(row.user, row.identity);
}

/** Updates the user this `(issuer, subject)` names, or makes the user and the identity (one transaction). */
export function upsertUser(db: RawDb, user: NewStoredUser, provider: string): Promise<StoredUser> {
  const fields = {
    primaryEmail: user.primaryEmail,
    displayName: user.displayName,
    imageUrl: user.imageUrl,
    status: user.status,
  };
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.issuer, user.issuer), eq(userIdentities.subject, user.subject)));
    if (identity) {
      const [updated] = await tx.update(users).set(fields).where(eq(users.id, identity.userId)).returning();
      return stored(updated as User, identity);
    }
    const [created] = (await tx.insert(users).values(fields).returning()) as [User];
    const [linked] = (await tx
      .insert(userIdentities)
      .values({ userId: created.id, provider, issuer: user.issuer, subject: user.subject })
      .returning()) as [UserIdentity];
    return stored(created, linked);
  });
}
