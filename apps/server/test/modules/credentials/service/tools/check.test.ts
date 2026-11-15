import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { captureLogger } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { credentialSecrets } from '../../../../../src/modules/credentials/index.ts';
import type { ToolOutcome } from '../../../../../src/modules/credentials/rules/tools.ts';
import {
  recordToolCheck,
  type ToolDeps,
} from '../../../../../src/modules/credentials/service/tools/check.ts';
import { noticeSignInNeeded } from '../../../../../src/modules/notifications/service.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, joinCompany, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { FakeProvider } from '../../../../fixtures/credentials/providers.ts';
import { CLASSIC_TOKEN, checkAgain, GITHUB_USER, status } from '../../../../fixtures/credentials/tools.ts';
import { membersCompany } from '../../../../fixtures/members/members.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';
import { noticesOf } from '../../../../fixtures/wakes.ts';

/**
 * A tool sign-in the system finds `needs_sign_in` is told to its owner (T-22, docs/subscriptions.md "The sign-in's
 * owner hears of it"): the daily check, a refused tool call or Slack answer, once per change of the sign-in; a person's
 * own Check again tells nothing (they see it on the card); a failure to tell is only logged, never failing the check.
 */

// The notice as a pass-through spy, so a test can make it fail once.
vi.mock('../../../../../src/modules/notifications/service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/modules/notifications/service.ts')>();
  return { ...actual, noticeSignInNeeded: vi.fn(actual.noticeSignInNeeded) };
});

const keyring = ephemeralKeyring();
const provider = new FakeProvider();
let w: AuthWorld;
let ihor: LinkedUser;
let principalId: string;
beforeAll(async () => {
  w = await authWorld({ keyring, providerFetch: provider.fetch });
  ihor = await addUser(w.t.db, w.fake);
  const company = await membersCompany(w);
  principalId = (await joinCompany(w.t.db, company.companyId, ihor.userId, 'admin')).principalId;
});
afterAll(() => w.t.close());
beforeEach(() => {
  provider.reset();
  vi.mocked(noticeSignInNeeded).mockClear();
});

const REFUSED: ToolOutcome = { ok: false, code: 'needs_sign_in' };
const SYSTEM = { kind: 'system' } as const;

function deps() {
  const logs = captureLogger();
  const toolDeps: ToolDeps = {
    db: w.t.db,
    keyring,
    clock: w.clock,
    logger: logs.logger,
    providerFetch: provider.fetch,
  };
  return { toolDeps, lines: logs.lines };
}

const github = (label: string) =>
  credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential({
    kind: 'github_token',
    secret: { token: CLASSIC_TOKEN },
    label,
    ownerUserId: ihor.userId,
  });

/** Ihor's notices of this sign-in. */
const noticesAbout = async (credentialId: string) =>
  (await noticesOf(w.t.db, principalId, 'sign_in_needed')).filter(
    (row) => (row.payload as { signIn?: string }).signIn === credentialId,
  );

describe('recordToolCheck telling the owner', () => {
  it('tells of a sign-in the system found refused, once per change of it', async () => {
    const view = await github('Ihor GitHub');
    const record = (outcome: ToolOutcome) =>
      recordToolCheck(deps().toolDeps, view.id, ihor.userId, outcome, SYSTEM);
    w.clock.advance(60_000);
    const changedAt = w.clock();
    expect(await record(REFUSED)).toMatchObject({ status: 'needs_sign_in' });
    const [notice] = await noticesAbout(view.id);
    expect(notice?.actorPrincipalId).toBeNull();
    expect(notice?.payload).toEqual({
      about: principalId,
      detail: 'Ihor GitHub',
      signIn: view.id,
      signInKind: 'github_token',
      change: changedAt.toISOString(),
    });
    w.clock.advance(60_000);
    expect(await record(REFUSED)).toMatchObject({ status: 'needs_sign_in' });
    expect(await noticesAbout(view.id)).toHaveLength(1);
    w.clock.advance(60_000);
    const working: ToolOutcome = { ok: true, accountEmail: null, accountMeta: { login: 'ihor-fake' } };
    expect(await record(working)).toMatchObject({ status: 'active' });
    expect(await record({ ok: false, code: 'provider_unavailable' })).toMatchObject({ status: 'active' });
    expect(await noticesAbout(view.id)).toHaveLength(1);
    w.clock.advance(60_000);
    await record(REFUSED);
    expect((await noticesAbout(view.id)).map((row) => (row.payload as { change: string }).change)).toEqual([
      changedAt.toISOString(),
      w.clock().toISOString(),
    ]);
  });

  it("tells nothing for a person's own Check again, nor for a revoked sign-in", async () => {
    const view = await github('Checked by hand');
    provider.always(GITHUB_USER, status(401));
    const res = await checkAgain(w, ihor, view.id);
    expect([res.status, (res.body as { status: string }).status]).toEqual([200, 'needs_sign_in']);
    const asked = recordToolCheck(deps().toolDeps, view.id, ihor.userId, REFUSED, {
      kind: 'user',
      requestId: 'req-check',
    });
    expect(await asked).toMatchObject({ status: 'needs_sign_in' });
    expect(noticeSignInNeeded).not.toHaveBeenCalled();
    expect(await noticesAbout(view.id)).toEqual([]);
    const revoked = await github('Revoked');
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, revoked.id));
    await recordToolCheck(deps().toolDeps, revoked.id, ihor.userId, REFUSED, SYSTEM);
    expect(noticeSignInNeeded).not.toHaveBeenCalled();
  });

  it('only logs a failure to tell, keeping the check', async () => {
    const view = await github('Untold');
    vi.mocked(noticeSignInNeeded).mockRejectedValueOnce(new Error('notifications are down'));
    const { toolDeps, lines } = deps();
    w.clock.advance(60_000);
    expect(await recordToolCheck(toolDeps, view.id, ihor.userId, REFUSED, SYSTEM)).toMatchObject({
      status: 'needs_sign_in',
    });
    expect(
      lines.find((line) => line.msg === 'could not tell the owner their sign-in stopped working'),
    ).toMatchObject({ credentialId: view.id, err: expect.anything() });
    expect(await noticesAbout(view.id)).toEqual([]);
    // The next check of the same change tells it, now that the notice works again.
    await recordToolCheck(toolDeps, view.id, ihor.userId, REFUSED, SYSTEM);
    expect(await noticesAbout(view.id)).toHaveLength(1);
  });
});
