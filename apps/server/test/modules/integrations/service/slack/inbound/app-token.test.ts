import type { SlackConnection } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import {
  appTokenVersion,
  NO_APP_TOKEN,
  openAppToken,
  sealAppToken,
} from '../../../../../../src/modules/integrations/service/slack/inbound/app-token.ts';
import { ephemeralKeyring, SecretOpenError } from '../../../../../../src/platform/secrets/keyring.ts';

/** A Slack connection's app token sealed with its bot sign-in (2026-11-13): bound to the sign-in and its owner. */

const keyring = ephemeralKeyring();
const OWNER = {
  credentialId: '019a0000-0000-7000-8000-000000000001',
  ownerUserId: '019a0000-0000-7000-8000-000000000002',
};
const rowOf = (columns: Partial<SlackConnection>) =>
  ({ ...OWNER, ...NO_APP_TOKEN, ...columns }) as SlackConnection;

describe('an app token', () => {
  it('opens as it was sealed, for its sign-in and owner only', () => {
    const row = rowOf(sealAppToken(keyring, OWNER, 'xapp-1-A0-123456789-secret'));
    expect(openAppToken(keyring, row)).toBe('xapp-1-A0-123456789-secret');
    expect(appTokenVersion(row)).toMatch(/^[0-9a-f]{24}$/);
    expect(() => openAppToken(keyring, { ...row, ownerUserId: OWNER.credentialId })).toThrow(SecretOpenError);
  });

  it('is none for a row without one, or a sealed value that holds no token', () => {
    expect(openAppToken(keyring, rowOf({}))).toBeUndefined();
    expect(appTokenVersion(rowOf({}))).toBeNull();
    const sealed = keyring.seal({ token: 7 }, `slack_app_token|${OWNER.credentialId}|${OWNER.ownerUserId}`);
    const odd = rowOf({
      appKeyVersion: sealed.keyVersion,
      appIv: sealed.iv,
      appAuthTag: sealed.tag,
      appCiphertext: sealed.ciphertext,
    });
    expect(openAppToken(keyring, odd)).toBeUndefined();
  });
});
