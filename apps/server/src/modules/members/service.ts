import type { Membership, TenantDb } from '@mwc/db';
import type { ServerDeps } from '../../platform/env.ts';
import { profilesOf, type UserProfile } from '../identity/service.ts';
import { membersRepo } from './repo.ts';
import type { Refusal } from './rules.ts';
import type { MemberView } from './schemas.ts';
import { type Removal, removeMember } from './service/remove.ts';
import { changeRole, type RoleChange } from './service/role.ts';

/** Who a membership names when their profile is missing (never, while `memberships.user_id` keeps its key). */
const UNKNOWN_PROFILE = { displayName: '', primaryEmail: '', imageUrl: null } as const;

/** A membership as the API shows it, with the person's name, email and picture from their (global) profile. */
export function memberView(
  row: Membership,
  profile: Omit<UserProfile, 'id' | 'status'> | undefined,
): MemberView {
  const { displayName, primaryEmail, imageUrl } = profile ?? UNKNOWN_PROFILE;
  return {
    id: row.id,
    userId: row.userId,
    principalId: row.principalId,
    displayName,
    email: primaryEmail,
    imageUrl,
    role: row.role,
    status: row.status,
    joinedAt: row.createdAt.toISOString(),
  };
}

/**
 * The members module's logic: the member list, role changes and removals (`service/role.ts`, `service/remove.ts`);
 * the outbox handlers are in `service/provider.ts`. People's profiles are global rows, read through the identity
 * module's service.
 */
export function membersService(deps: Pick<ServerDeps, 'db'>) {
  const repo = membersRepo();
  const views = async (rows: readonly Membership[]) => {
    const profiles = await profilesOf(
      deps.db,
      rows.map((row) => row.userId),
    );
    return rows.map((row) => memberView(row, profiles.get(row.userId)));
  };
  return {
    list: async (t: TenantDb): Promise<MemberView[]> => views(await repo.list(t)),

    async changeRole(t: TenantDb, call: RoleChange): Promise<{ ok: true; member: MemberView } | Refusal> {
      const result = await changeRole(repo, t, call);
      if (!result.ok) return result;
      const [member] = await views([result.membership]);
      return { ok: true, member: member as MemberView };
    },

    remove: (t: TenantDb, call: Removal) => removeMember(repo, t, call),
  };
}

export type MembersService = ReturnType<typeof membersService>;
