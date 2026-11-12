import { type Credential, credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { CredentialKind, CredentialStatus, ToolCheckError } from '@mwc/shared/enums';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import { dueToolChecks } from '../../../../src/modules/credentials/repo/checks-due.ts';
import {
  TOOL_CHECK_EVERY_MS,
  TOOL_RETRY_MS,
  toolCheckDue,
} from '../../../../src/modules/credentials/rules/tools.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());
beforeEach(async () => {
  await rawDb(w.t.db).delete(credentials);
});

const HOUR = 60 * 60_000;

const SECRETS: Partial<Record<CredentialKind, unknown>> = {
  github_token: { token: 'ghp_FAKEtoken' },
  github_oauth: { token: 'gho_FAKEtoken' },
  atlassian_api_token: { site: 'x.atlassian.net', email: 'ihor@example.test', token: 'ATATT3FAKE' },
  claude_setup_token: { token: 'sk-ant-oat01-FAKE' },
  gateway: { headers: {} },
};

/** A sign-in of `kind`, with its status and last check set straight in the table. */
async function seed(
  kind: CredentialKind,
  last: { readonly ago?: number; readonly error?: ToolCheckError; readonly status?: CredentialStatus } = {},
  user = ihor,
): Promise<Credential> {
  const store = credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
  const view = await store.storeCredential({
    kind,
    secret: SECRETS[kind],
    label: kind,
    ownerUserId: user.userId,
  } as never);
  const checkedAt = last.ago === undefined ? null : new Date(w.clock().getTime() - last.ago);
  const [row] = await rawDb(w.t.db)
    .update(credentials)
    .set({ checkedAt, checkError: last.error ?? null, status: last.status ?? 'active' })
    .where(eq(credentials.id, view.id))
    .returning();
  return row as Credential;
}

describe('dueToolChecks', () => {
  it('finds the tool sign-ins of anyone that toolCheckDue finds, never checked or longest ago first', async () => {
    const rows = [
      await seed('github_token', { ago: TOOL_CHECK_EVERY_MS + HOUR }),
      await seed('atlassian_api_token'),
      await seed('github_oauth', { ago: TOOL_CHECK_EVERY_MS }, other),
      await seed('github_token', { ago: TOOL_CHECK_EVERY_MS - 1 }),
      await seed('github_token', { ago: TOOL_RETRY_MS, error: 'provider_unavailable' }),
      await seed('github_token', { ago: TOOL_RETRY_MS - 1, error: 'rate_limited' }),
      await seed('github_token', { ago: TOOL_CHECK_EVERY_MS, status: 'needs_sign_in' }),
      await seed('github_token', { status: 'revoked' }),
      await seed('claude_setup_token'),
      await seed('gateway'),
    ];
    const due = await dueToolChecks(w.t.db, w.clock(), 50);
    const expected = rows.filter((row) => toolCheckDue(row, w.clock()));
    expect(new Set(due.map((row) => row.id))).toEqual(new Set(expected.map((row) => row.id)));
    expect(due).toHaveLength(5);
    expect(due[0]?.id).toBe(rows[1]?.id);
    expect(due[1]?.id).toBe(rows[0]?.id);
  });

  it('finds at most `limit`', async () => {
    for (let n = 0; n < 3; n += 1) await seed('github_token');
    expect(await dueToolChecks(w.t.db, w.clock(), 2)).toHaveLength(2);
  });
});
