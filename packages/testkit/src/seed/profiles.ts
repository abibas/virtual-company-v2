import { randomBytes } from 'node:crypto';
import {
  type AccessProfile,
  accessProfiles,
  type DbHandle,
  type NewAccessProfile,
  owned,
  PROFILE_AI_COLUMNS,
} from '@mwc/db';
import type { Effort, PermissionMode, ProfileProvider } from '@mwc/shared/enums';

/**
 * A profile to seed: its name, the one AI part to give it (`provider`, Claude unless said; null for none) with that
 * part's subscription, gateway, model, effort and mode (null: the part's default), and any other column as it is (a second AI part, tool parts).
 */
export type SeedProfileOptions = Partial<Omit<NewAccessProfile, 'id' | 'ownerUserId'>> & {
  readonly provider?: ProfileProvider | null;
  readonly credentialId?: string | null;
  readonly gatewayCredentialId?: string | null;
  readonly model?: string | null;
  readonly effort?: Effort | null;
  readonly mode?: PermissionMode | null;
};

/**
 * A profile of a person's, through the personal layer: one Claude part with no subscription, no model and no effort
 * (Claude Code's defaults) unless said; its name is unique per call unless given. No rules are checked (which
 * subscription, model or effort fits is the credentials module's): give it to an agent with `seedAgent`'s `profileId`.
 */
export async function seedProfile(
  db: DbHandle,
  ownerUserId: string,
  options: SeedProfileOptions = {},
): Promise<AccessProfile> {
  const { provider = 'claude', credentialId, gatewayCredentialId, model, effort, mode, ...columns } = options;
  const part =
    provider === null
      ? {}
      : (() => {
          const at = PROFILE_AI_COLUMNS[provider];
          return {
            [at.part]: true,
            [at.credential]: credentialId ?? null,
            [at.gateway]: gatewayCredentialId ?? null,
            [at.model]: model ?? null,
            [at.effort]: effort ?? null,
            [at.mode]: mode ?? null,
          };
        })();
  const name = `Profile ${randomBytes(4).toString('hex')}`;
  const [row] = (await owned(db, ownerUserId)
    .insert(accessProfiles, { name, ...part, ...columns })
    .returning()) as [AccessProfile];
  return row;
}
