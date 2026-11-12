import type { OwnedDb } from '@mwc/db';
import type { CredentialsRepo } from '../repo.ts';

/**
 * A tool sign-in's first check (S7.1a): the check with its provider that comes just before it is stored or renewed,
 * recorded with it in the same transaction by `storeCredential` and `renewCredentialLogin`.
 */

/** When it was, and whether the server opened the secret for it (a pasted token) or the sign-in helper's CLI did. */
export interface FirstCheck {
  readonly at: Date;
  readonly used: boolean;
}

/** The columns a first check sets: when it was, no error, and the use when the server made it. */
export const firstCheckColumns = (checked: FirstCheck | undefined) =>
  checked === undefined
    ? {}
    : { checkedAt: checked.at, checkError: null, ...(checked.used ? { lastUsedAt: checked.at } : {}) };

/** Records a first check's use, when the server made it, in the caller's transaction. */
export async function recordFirstCheck(
  repo: CredentialsRepo,
  o: OwnedDb,
  credentialId: string,
  checked: FirstCheck | undefined,
): Promise<void> {
  if (checked?.used) await repo.insertUse(o, credentialId, TOOL_CHECK, checked.at);
}

/** What a tool sign-in's check opens its secret for, in `credential_uses`. */
export const TOOL_CHECK = 'tool_check';
