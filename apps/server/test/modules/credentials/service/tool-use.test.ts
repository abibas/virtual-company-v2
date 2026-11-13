import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { newId } from '@mwc/shared/ids';
import { captureLogger } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialsForTools, type ToolUse } from '../../../../src/modules/credentials/index.ts';
import {
  GITHUB_SIGN_IN_GONE,
  GITHUB_SIGN_IN_REVOKED,
  NOT_ATLASSIAN,
  NOT_GITHUB,
  SIGN_IN_GONE,
  SIGN_IN_REVOKED,
} from '../../../../src/modules/credentials/service/tool-use.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { usesOf } from '../../../fixtures/chats/world.ts';
import { addUser, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { addSignIn, auditRows, revokeSubscription } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

/** Tool sign-ins opened for the agents' tools (S7.1c; GitHub's and git's since S7.1d), and a 401's mark. */

const keyring = ephemeralKeyring();
const { logger, lines } = captureLogger();
let w: AuthWorld;
let ihor: LinkedUser;
let tools: ReturnType<typeof credentialsForTools>;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  tools = credentialsForTools({ db: w.t.db, keyring, clock: w.clock, logger });
});
afterAll(() => w.t.close());

const USE: ToolUse = {
  purpose: 'tool:getJiraIssue',
  companyId: newId(),
  agentId: newId(),
  chatId: newId(),
  principalId: newId(),
};

describe('an Atlassian sign-in opened for a tool', () => {
  it('opens as its owner for tool:<name>, recording the use with its company, agent, chat and sender', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    expect(await tools.atlassian(signIn.id, ihor.userId, USE)).toEqual({
      ok: true,
      signIn: {
        site: 'airia.atlassian.net',
        email: 'ihor@example.com',
        token: 'ATATT3ATLASSIANtokenNEVERshown',
      },
    });
    const [use] = await usesOf(w.t.db, signIn.id);
    const { purpose, ...context } = USE;
    expect(use).toMatchObject({ purpose, ...context });
  });

  it('refuses another’s, a gone one, a revoked one and another kind, in words, recording nothing', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    const other = await addUser(w.t.db, w.fake);
    expect(await tools.atlassian(signIn.id, other.userId, USE)).toEqual({ ok: false, message: SIGN_IN_GONE });
    expect(await tools.atlassian(newId(), ihor.userId, USE)).toEqual({ ok: false, message: SIGN_IN_GONE });
    const github = await addSignIn(w, keyring, ihor.userId, 'github_token');
    expect(await tools.atlassian(github.id, ihor.userId, USE)).toEqual({ ok: false, message: NOT_ATLASSIAN });
    await revokeSubscription(w.t.db, signIn.id);
    expect(await tools.atlassian(signIn.id, ihor.userId, USE)).toEqual({
      ok: false,
      message: SIGN_IN_REVOKED,
    });
    expect(await usesOf(w.t.db, signIn.id)).toEqual([]);
  });

  it('opens a GitHub sign-in, either kind, for a tool or for git, and refuses the rest in words', async () => {
    const login = await addSignIn(w, keyring, ihor.userId, 'github_oauth');
    const git = { ...USE, purpose: 'tool:git' } as const;
    expect(await tools.github(login.id, ihor.userId, git)).toEqual({
      ok: true,
      signIn: { token: 'gho_GHLOGINtokenNEVERshown' },
    });
    expect((await usesOf(w.t.db, login.id)).map((use) => use.purpose)).toEqual(['tool:git']);
    const pasted = await addSignIn(w, keyring, ihor.userId, 'github_token');
    expect(await tools.github(pasted.id, ihor.userId, USE)).toMatchObject({ ok: true });
    expect(await tools.github(newId(), ihor.userId, USE)).toEqual({
      ok: false,
      message: GITHUB_SIGN_IN_GONE,
    });
    const atlassian = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    expect(await tools.github(atlassian.id, ihor.userId, USE)).toEqual({ ok: false, message: NOT_GITHUB });
    await revokeSubscription(w.t.db, login.id);
    expect(await tools.github(login.id, ihor.userId, USE)).toEqual({
      ok: false,
      message: GITHUB_SIGN_IN_REVOKED,
    });
  });

  it('marks a sign-in Atlassian refused as needing a sign-in, audited by the system', async () => {
    const signIn = await addSignIn(w, keyring, ihor.userId, 'atlassian_api_token');
    await tools.needsSignIn(signIn.id, ihor.userId);
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, signIn.id));
    expect(row?.status).toBe('needs_sign_in');
    expect(row?.checkedAt).not.toBeNull();
    const audit = await auditRows(w.t.db, 'credential', signIn.id);
    expect(audit.some((entry) => JSON.stringify(entry).includes('needs_sign_in'))).toBe(true);
    expect(lines.at(-1)?.msg).toBe('a tool sign-in was refused by its provider; it needs a sign-in');
  });
});
