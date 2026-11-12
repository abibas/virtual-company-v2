/**
 * The tool sign-ins' tests' world (S7.1a): fake GitHub and Atlassian answers on the limits tests' fake provider, so no
 * test reaches a real one; made-up tokens that no response, row or log line may contain; and the tool routes as
 * someone. Every token, account and id here is fake.
 */
import { auditLog, credentials, type DbHandle } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import type { SubscriptionView } from '../../../src/modules/credentials/schemas.ts';
import { call, type LinkedUser } from '../companies/companies.ts';
import type { AuthWorld } from '../platform/auth.ts';
import { type Answer, json } from './providers.ts';

export const GITHUB_USER = 'https://api.github.com/user';
export const SITE = 'airia-fake.atlassian.net';
export const JIRA_MYSELF = `https://${SITE}/rest/api/3/myself`;
export const CONFLUENCE_CURRENT = `https://${SITE}/wiki/rest/api/user/current`;

export const CLASSIC_TOKEN = 'ghp_FAKEclassicTOKENneverSHOWN0123456789';
export const FINE_TOKEN = 'github_pat_11FAKEfineGRAINEDtokenNEVERshown_0123456789';
export const ATLASSIAN_TOKEN = 'ATATT3xFAKEatlassianTOKENneverSHOWN0123456789';
export const EMAIL = 'ihor@example.test';

/** The tokens no response, row or log may carry. */
export const TOOL_SECRETS = [CLASSIC_TOKEN, FINE_TOKEN, ATLASSIAN_TOKEN];

/** GitHub's `GET /user` for a fake account, with the token's scopes (none: a fine-grained token). */
export const githubUser = (scopes: string | null = 'repo, read:org, workflow', login = 'ihor-fake'): Answer =>
  json(
    200,
    { login, id: 7, name: 'Ihor Fake', email: null },
    scopes === null ? {} : { 'x-oauth-scopes': scopes },
  );

/** Jira's `myself` and Confluence's `user/current` for the fake account. */
export const jiraMyself = json(200, {
  accountId: '557058:fake-jira',
  displayName: 'Ihor Herasko',
  emailAddress: EMAIL,
  active: true,
});
export const confluenceCurrent = json(200, {
  type: 'known',
  accountId: '557058:fake-jira',
  displayName: 'Ihor Herasko',
});

/** A refusal with this status and an empty body. */
export const status =
  (code: number, headers: Record<string, string> = {}): Answer =>
  () =>
    new Response(null, { status: code, headers });

/** The body of a pasted GitHub token, as the web sends it. */
export const githubToken = (token = CLASSIC_TOKEN, extra: Record<string, unknown> = {}) => ({
  kind: 'github_token',
  token,
  ...extra,
});

/** The body of an Atlassian sign-in, as the web sends it. */
export const atlassian = (extra: Record<string, unknown> = {}) => ({
  kind: 'atlassian_api_token',
  site: `https://${SITE}/jira/`,
  email: ` ${EMAIL} `,
  token: ATLASSIAN_TOKEN,
  ...extra,
});

/** `POST /api/me/subscriptions/tools` as `user`. */
export const addTool = (w: AuthWorld, user: LinkedUser, body: unknown, requestId?: string) =>
  call(w, user.token, requestId)('POST', '/api/me/subscriptions/tools', body);

/** The same, for a body that must be stored (the test fails on anything but a 201). */
export async function addedTool(w: AuthWorld, user: LinkedUser, body: unknown, requestId?: string) {
  const res = await addTool(w, user, body, requestId);
  if (res.status !== 201) throw new Error(`POST tools answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as SubscriptionView;
}

/** Check again as `user`. */
export const checkAgain = (w: AuthWorld, user: LinkedUser, id: string, requestId?: string) =>
  call(w, user.token, requestId)('POST', `/api/me/subscriptions/${id}/check`);

/** Asserts a body (or rows, or log lines) carry none of the tool tokens. */
export function noToolSecret(value: unknown): void {
  const text = JSON.stringify(value);
  for (const secret of TOOL_SECRETS) expect(text).not.toContain(secret);
}

/** A credential's row as stored. */
export async function rowOf(db: DbHandle, id: string) {
  const [row] = await rawDb(db).select().from(credentials).where(eq(credentials.id, id));
  return row;
}

/** A credential's audit rows, oldest first, as `[action, field, actorKind, requestId]`. */
export async function auditOfCredential(db: DbHandle, id: string) {
  const rows = await rawDb(db)
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'credential'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.id));
  return rows.map((row) => [row.action, row.field, row.actorKind, row.requestId] as const);
}
