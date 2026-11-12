import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SIGN_IN_FLOWS } from '../../../../../src/modules/credentials/service/sign-in/flows.ts';
import { usesOf } from '../../../../fixtures/credentials/providers.ts';
import {
  GITHUB_DEVICE_URL,
  GITHUB_OUTPUT,
  GITHUB_USER_CODE,
  SECRETS,
} from '../../../../fixtures/credentials/sign-in/cli.ts';
import { githubScript, settle } from '../../../../fixtures/credentials/sign-in/helper.ts';
import {
  as,
  openStored,
  type SignInWorld,
  signInOf,
  signInWorld,
  untilState,
} from '../../../../fixtures/credentials/sign-in/world.ts';

let s: SignInWorld;
beforeAll(async () => {
  s = await signInWorld();
});
afterAll(() => s.w.t.close());
beforeEach(() => {
  s.reset();
  s.helper.script = githubScript();
});

const GH_LOGIN = [
  'gh',
  'auth',
  'login',
  '--hostname',
  'github.com',
  '--git-protocol',
  'https',
  '--web',
  '--scopes',
  'workflow',
  '--insecure-storage',
];

const start = (user = s.ihor) => signInOf(s.signIns.start(as(user), { provider: 'github' }));
const read = (id: string, user = s.ihor) => signInOf(s.signIns.get(as(user), id));

describe('Sign in with GitHub', () => {
  it("runs the GitHub CLI's device sign-in with no terminal, shows the code and GitHub's page, and stores the login", async () => {
    expect(SIGN_IN_FLOWS.github.argv).toEqual(GH_LOGIN);
    const started = start();
    await settle();
    expect(s.helper.commands).toEqual([{ argv: GH_LOGIN, tty: false }]);
    expect(read(started.id)).toMatchObject({
      provider: 'github',
      state: 'waiting_for_user',
      url: GITHUB_DEVICE_URL,
      userCode: GITHUB_USER_CODE,
    });
    expect(s.signIns.submitCode(as(s.ihor), started.id, 'FAKEcode0123')).toMatchObject({
      code: 'sign_in_not_waiting',
    });
    s.helper.last.emit(GITHUB_OUTPUT.success);
    s.helper.last.exit(0);
    await untilState(s, started.id, 'done');
    expect(s.helper.last.ran).toEqual(['gh auth token --hostname github.com', 'gh api user --include']);
    const credentialId = read(started.id).credentialId as string;
    expect(await openStored(s, credentialId)).toMatchObject({
      kind: 'github_oauth',
      secret: { token: expect.stringMatching(/^gho_FAKE/) },
      credential: {
        label: 'GitHub · ihor-fake',
        accountEmail: 'ihor@example.test',
        accountMeta: {
          host: 'github.com',
          login: 'ihor-fake',
          name: 'Ihor',
          scopes: ['gist', 'read:org', 'repo', 'workflow'],
        },
        status: 'active',
        checkedAt: s.w.clock().toISOString(),
        checkError: null,
      },
    });
    // GitHub's own CLI made the first check: the server opened nothing (the one use is the test's own open).
    expect((await usesOf(s.w.t.db, credentialId)).map((use) => use.purpose)).toEqual(['test']);
    expect(s.helper.last.kills).toBe(1);
    const text = JSON.stringify([read(started.id), s.w.t.logs]);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it('fails in plain words when the CLI stops before the code is entered, or prints no token', async () => {
    const declined = start();
    await settle();
    s.helper.last.exit(1);
    expect(read(declined.id)).toMatchObject({
      state: 'failed',
      message: 'The GitHub sign-in stopped before it finished. Start again.',
    });
    s.reset();
    s.helper.script = githubScript();
    const tokenless = start();
    await settle();
    s.helper.last.setRun('gh auth token --hostname github.com', undefined);
    s.helper.last.exit(0);
    await untilState(s, tokenless.id, 'failed');
    expect(read(tokenless.id).message).toBe('GitHub finished without saving a login. Start again.');
    expect(s.helper.last.kills).toBe(1);
  });

  it('signs in again into the same sign-in, with a new first check', async () => {
    const first = start();
    await settle();
    s.helper.last.exit(0);
    await untilState(s, first.id, 'done');
    const credentialId = read(first.id).credentialId as string;
    await rawDb(s.w.t.db)
      .update(credentials)
      .set({ status: 'needs_sign_in', checkError: 'provider_unavailable' })
      .where(eq(credentials.id, credentialId));
    s.w.clock.advance(60_000);
    s.reset();
    s.helper.script = githubScript();
    const again = signInOf(await s.signIns.signInAgain(as(s.ihor), 'github', credentialId));
    await settle();
    s.helper.last.exit(0);
    await untilState(s, again.id, 'done');
    expect(read(again.id)).toMatchObject({ credentialId, accountChanged: false });
    expect(await openStored(s, credentialId)).toMatchObject({
      credential: { status: 'active', checkError: null, checkedAt: s.w.clock().toISOString() },
    });
    expect(await s.signIns.signInAgain(as(s.ihor), 'claude', credentialId)).toMatchObject({
      status: 422,
      code: 'sign_in_kind_mismatch',
    });
  });
});
