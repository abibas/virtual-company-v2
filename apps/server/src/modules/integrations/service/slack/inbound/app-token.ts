import type { SlackConnection } from '@mwc/db';
import type { Keyring, Sealed } from '../../../../../platform/secrets/keyring.ts';

/**
 * A Slack connection's app-level token (`xapp-`, 2026-11-13), sealed with its bot sign-in: AES-256-GCM under the master
 * key, with the additional data `slack_app_token|<credential id>|<owner>`, so a row copied onto another sign-in or
 * person does not open. Write-only: no answer ever carries it; the server opens it only to open Socket Mode.
 */

const aad = (row: Pick<SlackConnection, 'credentialId' | 'ownerUserId'>) =>
  `slack_app_token|${row.credentialId}|${row.ownerUserId}`;

/** The sealed columns of an app token for this sign-in. */
export function sealAppToken(
  keyring: Keyring,
  owner: Pick<SlackConnection, 'credentialId' | 'ownerUserId'>,
  token: string,
) {
  const sealed = keyring.seal({ token }, aad(owner));
  return {
    appKeyVersion: sealed.keyVersion,
    appIv: sealed.iv,
    appAuthTag: sealed.tag,
    appCiphertext: sealed.ciphertext,
  };
}

/** No app token. */
export const NO_APP_TOKEN = {
  appKeyVersion: null,
  appIv: null,
  appAuthTag: null,
  appCiphertext: null,
} as const;

/** The row's app token opened; undefined when it has none. Throws `SecretOpenError` for one that does not open. */
export function openAppToken(keyring: Keyring, row: SlackConnection): string | undefined {
  const { appKeyVersion, appIv, appAuthTag, appCiphertext } = row;
  if (appKeyVersion === null || appIv === null || appAuthTag === null || appCiphertext === null)
    return undefined;
  const sealed: Sealed = { keyVersion: appKeyVersion, iv: appIv, tag: appAuthTag, ciphertext: appCiphertext };
  const opened = keyring.open(sealed, aad(row)) as { readonly token?: unknown };
  return typeof opened.token === 'string' ? opened.token : undefined;
}

/** A version of the sealed token, to tell a new one from the one a connection opened with. */
export const appTokenVersion = (row: SlackConnection) =>
  row.appIv === null ? null : Buffer.from(row.appIv).toString('hex');
