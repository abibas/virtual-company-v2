import type { DbHandle, TenantDb } from '@mwc/db';
import { profilesOf, type UserProfile } from '../../identity/service.ts';
import type { PrincipalRef } from '../../tasks/schemas.ts';
import type { InboxRepo } from '../repo.ts';

/** What a principal who is neither an agent nor a person of the company is called. */
export const SOMEONE = 'Someone';

/** The principals' names as the inbox shows them. */
export type Names = (principalId: string) => PrincipalRef;

/**
 * Reads the names of these principals: an agent's name and slug (archived ones too), a person's display name or email
 * from the identity module's service (former members too). Outside any transaction: the identity read runs on the
 * database handle.
 */
export async function namesOf(
  db: DbHandle,
  repo: InboxRepo,
  t: TenantDb,
  ids: Iterable<string | null | undefined>,
): Promise<Names> {
  const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string'))];
  const known = new Map<string, PrincipalRef>();
  for (const agent of await repo.agentsOf(t, wanted)) {
    known.set(agent.principalId, {
      principalId: agent.principalId,
      kind: 'agent',
      name: agent.name,
      slug: agent.slug,
    });
  }
  const members = await repo.membersOf(t, wanted);
  const profiles = await profilesOf(
    db,
    members.map((member) => member.userId),
  );
  for (const member of members) {
    // Every membership's person is a user row.
    const profile = profiles.get(member.userId) as UserProfile;
    const name = profile.displayName ?? profile.primaryEmail;
    known.set(member.principalId, { principalId: member.principalId, kind: 'person', name, slug: null });
  }
  return (id) => known.get(id) ?? { principalId: id, kind: 'person', name: SOMEONE, slug: null };
}
