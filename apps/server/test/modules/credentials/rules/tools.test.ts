import { isToolKind } from '@mwc/shared/credentials';
import { CredentialKind, ToolCheckError } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  addRefusal,
  TOOL_CHECK_EVERY_MS,
  TOOL_RETRY_MS,
  toolCheckDue,
  toolCheckMessage,
  toolFailureOf,
  toolNameOf,
} from '../../../../src/modules/credentials/rules/tools.ts';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('toolFailureOf', () => {
  it('reads 401 as signing in again, 429 as a rate limit, 403 as refused, 5xx as unavailable, the rest as odd', () => {
    expect([401, 429, 403, 500, 503, 404, 302].map(toolFailureOf)).toEqual([
      'needs_sign_in',
      'rate_limited',
      'refused',
      'provider_unavailable',
      'provider_unavailable',
      'invalid_response',
      'invalid_response',
    ]);
  });
});

describe('toolCheckDue', () => {
  const tool = { kind: 'github_token', status: 'active', checkedAt: null, checkError: null } as const;

  it('is due for a tool sign-in never checked, checked a day ago, or an hour ago after a check that did not finish', () => {
    expect(toolCheckDue(tool, NOW)).toBe(true);
    expect(toolCheckDue({ ...tool, checkedAt: ago(TOOL_CHECK_EVERY_MS) }, NOW)).toBe(true);
    expect(toolCheckDue({ ...tool, checkedAt: ago(TOOL_CHECK_EVERY_MS - 1) }, NOW)).toBe(false);
    const failed = { ...tool, checkError: 'provider_unavailable' as const };
    expect(toolCheckDue({ ...failed, checkedAt: ago(TOOL_RETRY_MS) }, NOW)).toBe(true);
    expect(toolCheckDue({ ...failed, checkedAt: ago(TOOL_RETRY_MS - 1) }, NOW)).toBe(false);
    expect(TOOL_CHECK_EVERY_MS).toBe(24 * 60 * 60_000);
    expect(TOOL_RETRY_MS).toBe(60 * 60_000);
  });

  it('checks one that needs signing in again daily too, and never a revoked one or an AI subscription', () => {
    expect(toolCheckDue({ ...tool, status: 'needs_sign_in', checkedAt: ago(TOOL_CHECK_EVERY_MS) }, NOW)).toBe(
      true,
    );
    expect(toolCheckDue({ ...tool, status: 'revoked' }, NOW)).toBe(false);
    for (const kind of CredentialKind.options.filter((k) => !isToolKind(k))) {
      expect(toolCheckDue({ ...tool, kind }, NOW), kind).toBe(false);
    }
  });
});

describe('the words', () => {
  it('names each tool', () => {
    expect(toolNameOf('github_oauth')).toBe('GitHub');
    expect(toolNameOf('github_token')).toBe('GitHub');
    expect(toolNameOf('atlassian_api_token')).toBe('Atlassian');
  });

  it('says why the last check did not finish, for every error', () => {
    expect(ToolCheckError.options.map((code) => toolCheckMessage('github_token', code))).toEqual([
      'GitHub did not answer the last check.',
      'GitHub rate limited the last check.',
      'GitHub refused the last check.',
      'GitHub answered the last check with something unexpected.',
      'Neither Jira nor Confluence answered on this site.',
      'The last check failed.',
    ]);
    expect(toolCheckMessage('atlassian_api_token', 'provider_unavailable')).toBe(
      'Atlassian did not answer the last check.',
    );
  });

  it('refuses an addition the provider did not accept with 422, and a provider in trouble with 502', () => {
    expect(addRefusal('github_token', 'needs_sign_in')).toEqual({
      ok: false,
      status: 422,
      code: 'tool_sign_in_refused',
      message: 'GitHub did not accept this token.',
    });
    expect(addRefusal('atlassian_api_token', 'needs_sign_in', 'airia.atlassian.net')).toMatchObject({
      status: 422,
      message: 'Atlassian did not accept this email and API token on airia.atlassian.net.',
    });
    expect(addRefusal('github_token', 'refused')).toMatchObject({
      status: 422,
      message: 'GitHub refused this token.',
    });
    expect(addRefusal('atlassian_api_token', 'no_products', 'x.atlassian.net')).toMatchObject({
      status: 422,
      code: 'tool_sign_in_refused',
      message: 'Neither Jira nor Confluence answered on x.atlassian.net.',
    });
    expect(addRefusal('github_token', 'rate_limited')).toEqual({
      ok: false,
      status: 502,
      code: 'rate_limited',
      message: 'GitHub rate limited the check. Try again later.',
    });
    expect(addRefusal('atlassian_api_token', 'provider_unavailable', 'x.atlassian.net')).toMatchObject({
      status: 502,
      code: 'provider_unavailable',
      message: 'Atlassian did not answer on x.atlassian.net. Try again.',
    });
    expect(addRefusal('github_token', 'invalid_response')).toMatchObject({
      status: 502,
      code: 'invalid_response',
    });
    expect(addRefusal('github_token', 'check_failed')).toMatchObject({
      status: 502,
      code: 'check_failed',
      message: 'The check failed. Try again.',
    });
  });
});
