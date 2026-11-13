import type { AccessProfile, OwnedDb } from '@mwc/db';
import { type SlackRights, storedRights } from '@mwc/shared/credentials';
import { profileRows as repo } from '../../repo/profiles.ts';
import type { ProfileChange } from '../../rules/profiles.ts';
import { slackScopeRefusal } from '../../rules/slack-part.ts';

/**
 * The Slack part's scope check on a profile's write (S7.1e, `rules/slack-part.ts`): when the request gives the part's
 * rights, the ones it turns on are checked against the scopes of the sign-in the part holds after the change, read as
 * the owner.
 */
export async function slackRefused(
  o: OwnedDb,
  row: Pick<AccessProfile, 'slackCredentialId' | 'slackRights'> | undefined,
  set: ProfileChange,
  given: SlackRights | undefined,
) {
  if (given === undefined) return undefined;
  const credentialId =
    set.slackCredentialId === undefined ? (row?.slackCredentialId ?? null) : set.slackCredentialId;
  const [signIn] = credentialId === null ? [] : await repo.credentialsOf(o, [credentialId]);
  const before = row?.slackRights == null ? null : storedRights('slack', row.slackRights);
  return slackScopeRefusal(before, given, signIn);
}
