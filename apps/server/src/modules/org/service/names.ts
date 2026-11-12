import type { DbHandle, TenantDb } from '@mwc/db';
import type { PrincipalKind } from '@mwc/shared/enums';
import { profilesOf } from '../../identity/service.ts';
import { orgRepo } from '../repo.ts';

/**
 * The principals' names for every module that shows them (tasks and flows, the inbox, the notifications): an agent's
 * name and slug (archived ones too), a person's display name or else email from the identity module's service (former
 * members too), and `SOMEONE` for a principal of neither.
 */

/** What a principal who is neither an agent nor a person of the company is called. */
export const SOMEONE = 'Someone';

/** A principal as the views name it; a person has no slug. */
export interface PrincipalName {
  readonly principalId: string;
  readonly kind: PrincipalKind;
  readonly name: string;
  readonly slug: string | null;
}

/** The names read: any principal's, `SOMEONE` (a person) for one not found. */
export type PrincipalNames = (principalId: string) => PrincipalName;

/**
 * Reads the names of these principals (empty and repeated ids skipped). Outside any transaction: the identity read runs
 * on the database handle, not the tenant's connection.
 */
export async function principalNames(
  db: DbHandle,
  t: TenantDb,
  ids: Iterable<string | null | undefined>,
): Promise<PrincipalNames> {
  const repo = orgRepo();
  const wanted = [...new Set([...ids].filter((id): id is string => typeof id === 'string'))];
  const known = new Map<string, PrincipalName>();
  for (const agent of await repo.agentNames(t, wanted)) {
    known.set(agent.principalId, {
      principalId: agent.principalId,
      kind: 'agent',
      name: agent.name,
      slug: agent.slug,
    });
  }
  const members = await repo.memberUsers(t, wanted);
  const profiles = await profilesOf(
    db,
    members.map((member) => member.userId),
  );
  for (const member of members) {
    const profile = profiles.get(member.userId);
    if (profile === undefined) continue;
    const name = profile.displayName ?? profile.primaryEmail;
    known.set(member.principalId, { principalId: member.principalId, kind: 'person', name, slug: null });
  }
  return (id) => known.get(id) ?? { principalId: id, kind: 'person', name: SOMEONE, slug: null };
}
