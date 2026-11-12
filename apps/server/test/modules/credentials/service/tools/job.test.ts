import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { captureLogger } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../../src/modules/credentials/index.ts';
import { TOOL_CHECK_EVERY_MS, TOOL_RETRY_MS } from '../../../../../src/modules/credentials/rules/tools.ts';
import {
  checkStoredTool,
  recordToolCheck,
  type ToolDeps,
} from '../../../../../src/modules/credentials/service/tools/check.ts';
import {
  TOOL_CHECK_BATCH,
  TOOL_SWEEP_MS,
  toolCheckJob,
} from '../../../../../src/modules/credentials/service/tools/job.ts';
import { ephemeralKeyring } from '../../../../../src/platform/secrets/keyring.ts';
import { addUser, type LinkedUser } from '../../../../fixtures/companies/companies.ts';
import { FakeProvider, json, usesOf } from '../../../../fixtures/credentials/providers.ts';
import {
  ATLASSIAN_TOKEN,
  auditOfCredential,
  CLASSIC_TOKEN,
  CONFLUENCE_CURRENT,
  confluenceCurrent,
  EMAIL,
  GITHUB_USER,
  githubUser,
  JIRA_MYSELF,
  jiraMyself,
  noToolSecret,
  rowOf,
  SITE,
  status,
} from '../../../../fixtures/credentials/tools.ts';
import { type AuthWorld, authWorld } from '../../../../fixtures/platform/auth.ts';

const keyring = ephemeralKeyring();
const provider = new FakeProvider();
let w: AuthWorld;
let ihor: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());
beforeEach(async () => {
  provider.reset();
  await rawDb(w.t.db).delete(credentials);
});

function deps(over: Partial<ToolDeps> = {}) {
  const logs = captureLogger();
  const toolDeps: ToolDeps = {
    db: w.t.db,
    keyring,
    clock: w.clock,
    logger: logs.logger,
    providerFetch: provider.fetch,
    ...over,
  };
  return { toolDeps, lines: logs.lines };
}

const store = () => credentialSecrets({ db: w.t.db, keyring, clock: w.clock });
const github = (label = 'GitHub') =>
  store().storeCredential({
    kind: 'github_token',
    secret: { token: CLASSIC_TOKEN },
    label,
    ownerUserId: ihor.userId,
  });
const atlassian = () =>
  store().storeCredential({
    kind: 'atlassian_api_token',
    secret: { site: SITE, email: EMAIL, token: ATLASSIAN_TOKEN },
    label: 'Atlassian',
    ownerUserId: ihor.userId,
  });

describe('toolCheckJob', () => {
  it('checks the due sign-ins as the system, keeps what each provider says, and records each use', async () => {
    provider
      .always(GITHUB_USER, githubUser())
      .always(JIRA_MYSELF, jiraMyself)
      .always(CONFLUENCE_CURRENT, confluenceCurrent);
    const gh = await github();
    const at = await atlassian();
    const { toolDeps, lines } = deps();
    expect(await toolCheckJob(toolDeps)()).toEqual({ checked: 2, active: 2, needsSignIn: 0, failed: 0 });
    expect(await rowOf(w.t.db, gh.id)).toMatchObject({
      checkedAt: w.clock(),
      checkError: null,
      accountMeta: { login: 'ihor-fake', scopes: ['repo', 'read:org', 'workflow'] },
    });
    expect(await rowOf(w.t.db, at.id)).toMatchObject({ accountMeta: { jira: true, confluence: true } });
    for (const [id, fields] of [
      [gh.id, ['accountMeta']],
      [at.id, ['accountEmail', 'accountMeta']],
    ] as const) {
      expect((await usesOf(w.t.db, id)).map((use) => use.purpose)).toEqual(['tool_check']);
      const updates = (await auditOfCredential(w.t.db, id)).filter(([action]) => action === 'update');
      expect(updates.map(([, field, by, request]) => [field, by, request]).sort()).toEqual(
        fields.map((field) => [field, 'system', null]),
      );
    }
    noToolSecret(lines);
  });

  it('looks at most every 10 minutes, and checks each sign-in again a day later', async () => {
    provider.always(GITHUB_USER, githubUser());
    await github();
    const job = toolCheckJob(deps().toolDeps);
    expect(await job()).toMatchObject({ checked: 1 });
    w.clock.advance(TOOL_SWEEP_MS - 1);
    expect(await job()).toBeNull();
    w.clock.advance(1);
    expect(await job()).toEqual({ checked: 0, active: 0, needsSignIn: 0, failed: 0 });
    w.clock.advance(TOOL_CHECK_EVERY_MS);
    expect(await job()).toMatchObject({ checked: 1, active: 1 });
    expect(provider.callsTo(GITHUB_USER)).toHaveLength(2);
  });

  it('marks a 401 needs_sign_in, and retries a check that did not finish an hour later', async () => {
    const revoked = await github('Revoked');
    const flaky = await atlassian();
    provider
      .always(GITHUB_USER, status(401))
      .always(JIRA_MYSELF, status(503))
      .always(CONFLUENCE_CURRENT, status(503));
    const { toolDeps, lines } = deps();
    const job = toolCheckJob(toolDeps);
    expect(await job()).toEqual({ checked: 2, active: 0, needsSignIn: 1, failed: 1 });
    expect(await rowOf(w.t.db, revoked.id)).toMatchObject({ status: 'needs_sign_in', checkError: null });
    expect(await rowOf(w.t.db, flaky.id)).toMatchObject({
      status: 'active',
      checkError: 'provider_unavailable',
    });
    expect(
      lines
        .filter((line) => line.msg === 'tool check failed')
        .map((line) => line.code)
        .sort(),
    ).toEqual(['needs_sign_in', 'provider_unavailable']);
    provider.always(JIRA_MYSELF, jiraMyself);
    w.clock.advance(TOOL_RETRY_MS);
    expect(await job()).toEqual({ checked: 1, active: 1, needsSignIn: 0, failed: 0 });
    expect(await rowOf(w.t.db, flaky.id)).toMatchObject({ checkError: null, accountMeta: { jira: true } });
  });

  it(`checks at most ${TOOL_CHECK_BATCH} each time`, async () => {
    provider.always(GITHUB_USER, githubUser());
    for (let n = 0; n < TOOL_CHECK_BATCH + 2; n += 1) await github(`GitHub ${n}`);
    const job = toolCheckJob(deps().toolDeps);
    expect(await job()).toMatchObject({ checked: TOOL_CHECK_BATCH });
    w.clock.advance(TOOL_SWEEP_MS);
    expect(await job()).toMatchObject({ checked: 2 });
  });

  it('calls a secret that does not open check_failed, naming the error only, and goes on', async () => {
    provider.always(GITHUB_USER, githubUser());
    await github('Sealed elsewhere');
    const { toolDeps, lines } = deps({ keyring: ephemeralKeyring() });
    expect(await toolCheckJob(toolDeps)()).toEqual({ checked: 1, active: 0, needsSignIn: 0, failed: 1 });
    const line = lines.find((one) => one.msg === 'tool check failed unexpectedly');
    expect(line).toMatchObject({ kind: 'github_token', error: expect.any(String) });
    expect(provider.calls).toEqual([]);
  });
});

describe('recordToolCheck', () => {
  it('keeps a revoked sign-in as it is, and finds none that is gone', async () => {
    const view = await github();
    await rawDb(w.t.db).update(credentials).set({ status: 'revoked' }).where(eq(credentials.id, view.id));
    const outcome = { ok: false as const, code: 'needs_sign_in' as const };
    const kept = await recordToolCheck(deps().toolDeps, view.id, ihor.userId, outcome, { kind: 'system' });
    expect(kept).toMatchObject({ id: view.id, status: 'revoked', checkedAt: null });
    await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, view.id));
    expect(
      await recordToolCheck(deps().toolDeps, view.id, ihor.userId, outcome, { kind: 'system' }),
    ).toBeUndefined();
  });
});

describe('a sign-in removed while it is checked', () => {
  it('is skipped by the job once its provider has answered, and checks nothing when it is gone before', async () => {
    const view = await github('Going');
    provider.always(GITHUB_USER, async (call) => {
      await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, view.id));
      return json(200, { login: 'gone' })(call);
    });
    expect(await toolCheckJob(deps().toolDeps)()).toEqual({
      checked: 0,
      active: 0,
      needsSignIn: 0,
      failed: 0,
    });
    const stale = { ...(await github('Stale')) };
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, stale.id));
    await rawDb(w.t.db).delete(credentials).where(eq(credentials.id, stale.id));
    provider.reset();
    expect(await checkStoredTool(deps().toolDeps, row as never, { kind: 'system' })).toBeUndefined();
    expect(provider.calls).toEqual([]);
  });

  it('names a failure that is not an Error as unknown', async () => {
    await github('Odd');
    const odd = {
      open: () => {
        throw 'not an error';
      },
    };
    const { toolDeps, lines } = deps({ keyring: odd as unknown as ToolDeps['keyring'] });
    expect(await toolCheckJob(toolDeps)()).toMatchObject({ failed: 1 });
    expect(lines.find((line) => line.msg === 'tool check failed unexpectedly')).toMatchObject({
      error: 'unknown',
    });
  });
});
