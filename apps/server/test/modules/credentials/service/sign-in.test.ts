import { auditLog, credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import { SIGN_IN_ENDINGS, SIGN_IN_LIMITS } from '../../../../src/modules/credentials/rules/sign-in.ts';
import { signInService } from '../../../../src/modules/credentials/service/sign-in.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import {
  CLAUDE_ACCOUNT,
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_CODE,
  CLAUDE_CREDENTIALS,
  CLAUDE_OUTPUT,
  CODEX_AUTH,
  CODEX_DEVICE_URL,
  CODEX_USER_CODE,
  SECRETS,
} from '../../../fixtures/credentials/sign-in/cli.ts';
import { claudeScript, codexScript, settle } from '../../../fixtures/credentials/sign-in/helper.ts';
import {
  as,
  openStored,
  type SignInWorld,
  signInOf,
  signInWorld,
  untilState,
} from '../../../fixtures/credentials/sign-in/world.ts';

let s: SignInWorld;
beforeAll(async () => {
  s = await signInWorld();
});
afterAll(() => s.w.t.close());
beforeEach(() => s.reset());

const start = (provider: 'claude' | 'openai', user = s.ihor) =>
  signInOf(s.signIns.start(as(user), { provider }));
const read = (id: string, user = s.ihor) => signInOf(s.signIns.get(as(user), id));
const code = (id: string) => s.signIns.submitCode(as(s.ihor), id, CLAUDE_CODE);

describe('Sign in with Claude', () => {
  it('starts, shows the address, takes the code, stores the login and ends done with the sandbox killed', async () => {
    const started = start('claude');
    expect(started).toMatchObject({ provider: 'claude', state: 'starting', url: null, userCode: null });
    expect(started.expiresAt).toBe(new Date(s.w.clock().getTime() + SIGN_IN_LIMITS.ttlMs).toISOString());
    await settle();
    expect(s.helper.commands).toEqual([{ argv: ['claude', 'auth', 'login', '--claudeai'] }]);
    expect(read(started.id)).toMatchObject({ state: 'waiting_for_code', url: CLAUDE_AUTHORIZE_URL });
    expect(signInOf(code(started.id)).state).toBe('completing');
    expect(s.helper.last.written).toEqual([`${CLAUDE_CODE}\r`]);
    await untilState(s, started.id, 'done');
    const finished = read(started.id);
    expect(finished).toMatchObject({ message: null, credentialId: expect.any(String) });
    expect(s.helper.last.kills).toBe(1);
    expect(s.timers.pending).toEqual([]);
    expect(await openStored(s, finished.credentialId as string)).toMatchObject({
      ok: true,
      kind: 'claude_oauth',
      secret: { credentials: CLAUDE_CREDENTIALS, account: CLAUDE_ACCOUNT },
      credential: {
        label: 'Claude · ihor@example.test',
        accountEmail: 'ihor@example.test',
        accountMeta: { organizationName: "Ihor's Organization", subscriptionType: 'max' },
      },
    });
  });

  it('takes the name given and records the request that started the sign-in in the audit rows', async () => {
    const started = signInOf(
      s.signIns.start(as(s.ihor, 'req-claude-named'), { provider: 'claude', label: 'Max' }),
    );
    await settle();
    code(started.id);
    await untilState(s, started.id, 'done');
    const id = read(started.id).credentialId as string;
    const [row] = await rawDb(s.w.t.db).select().from(credentials).where(eq(credentials.id, id));
    expect(row).toMatchObject({ label: 'Max', ownerUserId: s.ihor.userId, kind: 'claude_oauth' });
    const audit = await rawDb(s.w.t.db)
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'create')));
    expect(new Set(audit.map((line) => line.requestId))).toEqual(new Set(['req-claude-named']));
  });

  it('waits for the user while only the address is shown, then for the code, and takes the code in both', async () => {
    s.helper.script = { ...claudeScript(), output: [CLAUDE_OUTPUT.address] };
    const first = start('claude');
    await settle();
    expect(read(first.id).state).toBe('waiting_for_user');
    s.helper.last.emit(CLAUDE_OUTPUT.prompt);
    expect(read(first.id).state).toBe('waiting_for_code');
    s.signIns.cancel(as(s.ihor), first.id);
    const second = start('claude');
    await settle();
    expect(read(second.id).state).toBe('waiting_for_user');
    expect(signInOf(code(second.id)).state).toBe('completing');
    await untilState(s, second.id, 'done');
  });

  it('fails in plain words when Claude refuses the code, reading and storing nothing', async () => {
    s.helper.script = claudeScript('refuse');
    const started = start('claude');
    await settle();
    code(started.id);
    expect(read(started.id)).toMatchObject({
      state: 'failed',
      message: SIGN_IN_ENDINGS.codeRefused,
      credentialId: null,
    });
    expect(s.helper.last.kills).toBe(1);
    expect(s.helper.last.reads).toEqual([]);
  });

  it('fails when Claude does not finish after the code, or saved no login', async () => {
    s.helper.script = claudeScript('silent');
    const slow = start('claude');
    await settle();
    code(slow.id);
    expect(s.timers.pending).toContain(SIGN_IN_LIMITS.codeWaitMs);
    s.timers.fire(SIGN_IN_LIMITS.codeWaitMs);
    expect(read(slow.id)).toMatchObject({ state: 'failed', message: SIGN_IN_ENDINGS.codeTimeout });

    s.helper.script = { ...claudeScript(), files: {} };
    const empty = start('claude');
    await settle();
    code(empty.id);
    await untilState(s, empty.id, 'failed');
    expect(read(empty.id).message).toBe('Claude finished without saving a login. Start again.');
  });

  it('reads the account from ~/.claude/.claude.json when ~/.claude.json is not there', async () => {
    const files = { '.claude/.credentials.json': JSON.stringify(CLAUDE_CREDENTIALS) };
    s.helper.script = { ...claudeScript(), files };
    const started = start('claude');
    await settle();
    s.helper.last.setFile('.claude/.claude.json', JSON.stringify({ oauthAccount: CLAUDE_ACCOUNT }));
    code(started.id);
    await untilState(s, started.id, 'done');
    expect(s.helper.last.reads).toEqual([
      '.claude/.credentials.json',
      '.claude.json',
      '.claude/.claude.json',
    ]);
    expect(await openStored(s, read(started.id).credentialId as string)).toMatchObject({
      credential: { accountEmail: 'ihor@example.test' },
    });
  });

  it('refuses a code before the address is shown, as not waiting', () => {
    s.helper.gate = new Promise(() => {});
    const started = start('claude');
    expect(code(started.id)).toMatchObject({ ok: false, status: 409, code: 'sign_in_not_waiting' });
  });
});

describe('Sign in with OpenAI', () => {
  it('shows the device page and the one-time code, and stores the login once Codex finishes', async () => {
    s.helper.script = codexScript();
    const started = start('openai');
    await settle();
    expect(s.helper.commands).toEqual([
      { argv: ['codex', 'login', '--device-auth', '-c', 'cli_auth_credentials_store=file'] },
    ]);
    expect(read(started.id)).toMatchObject({
      state: 'waiting_for_user',
      url: CODEX_DEVICE_URL,
      userCode: CODEX_USER_CODE,
    });
    expect(code(started.id)).toMatchObject({ code: 'sign_in_not_waiting' });
    s.helper.last.exit(0);
    await untilState(s, started.id, 'done');
    expect(await openStored(s, read(started.id).credentialId as string)).toMatchObject({
      kind: 'codex_oauth',
      secret: { auth: CODEX_AUTH },
      credential: {
        label: 'OpenAI · ihor@example.test',
        accountEmail: 'ihor@example.test',
        accountMeta: { planType: 'pro' },
      },
    });
    expect(s.helper.last.kills).toBe(1);
  });

  it('fails when Codex stops without a login (declined, or the code expired)', async () => {
    s.helper.script = codexScript();
    const started = start('openai');
    await settle();
    s.helper.last.exit(1);
    expect(read(started.id)).toMatchObject({
      state: 'failed',
      message: 'The OpenAI sign-in stopped before it finished. Start again.',
    });
  });
});

describe('Sign in again', () => {
  const storedLogin = () =>
    credentialSecrets({ db: s.w.t.db, keyring: ephemeralKeyring(), clock: s.w.clock }).storeCredential({
      ownerUserId: s.ihor.userId,
      kind: 'claude_oauth',
      label: 'Old Max',
      secret: { credentials: { claudeAiOauth: { accessToken: 'sk-ant-oat01-FAKEold' } }, account: null },
    });

  it('fails in plain words when the subscription is removed while signing in, storing nothing', async () => {
    const old = await storedLogin();
    const started = signInOf(await s.signIns.signInAgain(as(s.ihor), 'claude', old.id));
    expect(s.w.t.logs.at(-1)).toMatchObject({ msg: 'sign-in started', renews: true });
    await settle();
    await rawDb(s.w.t.db).delete(credentials).where(eq(credentials.id, old.id));
    const mine = () =>
      rawDb(s.w.t.db).select().from(credentials).where(eq(credentials.ownerUserId, s.ihor.userId));
    const before = (await mine()).length;
    code(started.id);
    await untilState(s, started.id, 'failed');
    expect(read(started.id)).toMatchObject({ message: SIGN_IN_ENDINGS.gone, credentialId: null });
    expect(s.w.t.logs.at(-1)).toMatchObject({ msg: 'sign-in ended', reason: 'credential_not_found' });
    expect(await mine()).toHaveLength(before);
  });

  it('is off without a helper (503) before looking the subscription up, and one at a time (409)', async () => {
    const off = signInService({
      db: s.w.t.db,
      keyring: ephemeralKeyring(),
      clock: s.w.clock,
      logger: s.w.t.logger,
      loginHelper: undefined,
    });
    expect(await off.signInAgain(as(s.ihor), 'claude', 'not-an-id')).toMatchObject({
      status: 503,
      code: 'sign_in_unavailable',
    });
    const old = await storedLogin();
    start('openai');
    expect(await s.signIns.signInAgain(as(s.ihor), 'claude', old.id)).toMatchObject({
      status: 409,
      code: 'sign_in_active',
    });
  });
});

describe('who may sign in', () => {
  it('allows one active sign-in per person, and a new one replaces an ended one', async () => {
    const first = start('claude');
    expect(s.signIns.start(as(s.ihor), { provider: 'openai' })).toMatchObject({
      ok: false,
      status: 409,
      code: 'sign_in_active',
    });
    expect(start('claude', s.other).state).toBe('starting');
    s.signIns.cancel(as(s.ihor), first.id);
    const second = start('openai');
    expect(s.signIns.get(as(s.ihor), first.id)).toMatchObject({ status: 404, code: 'sign_in_not_found' });
    expect(read(second.id).provider).toBe('openai');
  });

  it("answers another person's sign-in and an unknown id with the same 404", async () => {
    const mine = start('claude');
    await settle();
    for (const answer of [
      s.signIns.get(as(s.other), mine.id),
      s.signIns.submitCode(as(s.other), mine.id, CLAUDE_CODE),
      s.signIns.cancel(as(s.other), mine.id),
      s.signIns.get(as(s.ihor), 'no-such-id'),
    ]) {
      expect(answer).toEqual({
        ok: false,
        status: 404,
        code: 'sign_in_not_found',
        message: 'No such sign-in of yours',
      });
    }
    expect(read(mine.id).state).toBe('waiting_for_code');
    expect(s.helper.last.written).toEqual([]);
  });

  it('is off without a helper (MWC_LOGIN_HELPER=none): 503', async () => {
    const off = signInService({
      db: s.w.t.db,
      keyring: ephemeralKeyring(),
      clock: s.w.clock,
      logger: s.w.t.logger,
      loginHelper: undefined,
    });
    expect(off.start(as(s.ihor), { provider: 'claude' })).toMatchObject({
      ok: false,
      status: 503,
      code: 'sign_in_unavailable',
    });
    // Nothing to end at shutdown.
    await expect(off.shutdown()).resolves.toBeUndefined();
  });
});

describe('the logs', () => {
  it('say when a sign-in starts and ends, with no token, file, code or address in them', async () => {
    const before = s.w.t.logs.length;
    const claude = start('claude');
    await settle();
    code(claude.id);
    await untilState(s, claude.id, 'done');
    s.helper.script = codexScript();
    const openai = start('openai');
    await settle();
    s.helper.last.exit(0);
    await untilState(s, openai.id, 'done');
    const lines = s.w.t.logs.slice(before);
    expect(lines.map((line) => [line.msg, line.state ?? null])).toEqual([
      ['sign-in started', null],
      ['sign-in ended', 'done'],
      ['sign-in started', null],
      ['sign-in ended', 'done'],
    ]);
    expect(lines[0]).toMatchObject({ signInId: claude.id, provider: 'claude', helper: 'docker' });
    const text = JSON.stringify(lines);
    for (const secret of [...SECRETS, CLAUDE_AUTHORIZE_URL, CODEX_USER_CODE])
      expect(text).not.toContain(secret);
  });
});
