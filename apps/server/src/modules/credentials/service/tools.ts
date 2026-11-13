import { owned } from '@mwc/db';
import { isToolKind, slackKindOf } from '@mwc/shared/credentials';
import { credentialsRepo } from '../repo.ts';
import { defaultLabel } from '../rules/login-files.ts';
import {
  addRefusal,
  NOT_A_TOOL,
  TOOL_KIND_MISMATCH,
  TOOL_NOT_FOUND,
  TOOL_REVOKED,
  type ToolRefusal,
  toolNameOf,
} from '../rules/tools.ts';
import type { AddTool } from '../schemas/tools.ts';
import type { SubscriptionView } from '../schemas.ts';
import type { Caller } from '../service.ts';
import { credentialSecrets } from './secrets.ts';
import { checkStoredTool, checkTool, type ToolDeps, type ToolSecret } from './tools/check.ts';

/**
 * The tool sign-ins' logic (S7.1a, docs/subscriptions.md "Tool sign-ins"), always as the caller: add a pasted GitHub
 * token, an Atlassian site and API token or a Slack token (S7.1e) once its provider accepts it (or put a new one into one of theirs in place),
 * and Check again. Sign in with GitHub is the sign-in service's. Another person's sign-in is the same 404 as none.
 */

type Answer<S extends 404 | 422 | 502> =
  | { readonly ok: true; readonly signIn: SubscriptionView }
  | ToolRefusal<S>;

/** A Slack token's kind by its prefix (the schema took only `xoxb-` and `xoxp-`): a user's, else a bot's. */
const slackKind = (token: string) =>
  slackKindOf(token) === 'slack_user_token' ? ('slack_user_token' as const) : ('slack_bot_token' as const);

/** The kind a body adds: its own, or a Slack token's by its prefix. */
const kindOf = (body: AddTool) => (body.kind === 'slack' ? slackKind(body.token) : body.kind);

/** The secret a body carries: the token, or Atlassian's site, email and token. */
function secretOf(body: AddTool): ToolSecret {
  if (body.kind === 'github_token') return { kind: body.kind, secret: { token: body.token } };
  if (body.kind === 'slack') return { kind: slackKind(body.token), secret: { token: body.token } };
  return { kind: body.kind, secret: { site: body.site, email: body.email, token: body.token } };
}

/** What a renewal may not renew: none of the caller's (404), another kind, or a revoked one (422). */
async function renewalRefusal(deps: ToolDeps, caller: Caller, credentialId: string, body: AddTool) {
  const row = await credentialsRepo().get(owned(deps.db, caller.userId), credentialId);
  if (row === undefined) return TOOL_NOT_FOUND;
  if (row.kind !== kindOf(body)) return TOOL_KIND_MISMATCH;
  return row.status === 'revoked' ? TOOL_REVOKED : undefined;
}

/** A new sign-in's name when none is given: "GitHub · <login>", "Atlassian · <site>", "Slack · <workspace>". */
function labelOf(body: AddTool, meta: Readonly<Record<string, unknown>>): string {
  const detail = body.kind === 'github_token' ? meta.login : body.kind === 'slack' ? meta.team : body.site;
  return defaultLabel(toolNameOf(kindOf(body)), typeof detail === 'string' ? detail : null);
}

/**
 * Checks the body's secret with its provider and, once it answers with the account, stores it sealed (with its first
 * check and that use recorded), or renews the caller's own sign-in `credentialId` in place.
 */
async function addTool(deps: ToolDeps, caller: Caller, body: AddTool): Promise<Answer<404 | 422 | 502>> {
  const { credentialId } = body;
  const refused =
    credentialId === undefined ? undefined : await renewalRefusal(deps, caller, credentialId, body);
  if (refused !== undefined) return refused;
  const tool = secretOf(body);
  const outcome = await checkTool(deps.providerFetch, tool);
  if (!outcome.ok) return addRefusal(tool.kind, outcome.code, 'site' in body ? body.site : undefined);
  const checked = { at: deps.clock(), used: true };
  const login = { ...tool, accountEmail: outcome.accountEmail, accountMeta: outcome.accountMeta, checked };
  const secrets = credentialSecrets(deps);
  if (credentialId !== undefined) {
    const renewed = await secrets.renewCredentialLogin(credentialId, caller.userId, login, caller.requestId);
    return renewed.ok ? { ok: true, signIn: renewed.credential } : TOOL_NOT_FOUND;
  }
  const label = body.label ?? labelOf(body, outcome.accountMeta);
  const stored = await secrets.storeCredential({
    ...login,
    label,
    ownerUserId: caller.userId,
    requestId: caller.requestId,
  });
  return { ok: true, signIn: stored };
}

export function toolsService(deps: ToolDeps) {
  return {
    add: (caller: Caller, body: AddTool) => addTool(deps, caller, body),

    /** Check again: asks the provider now and keeps what it said (404 none of the caller's, 422 not a tool sign-in). */
    async check(caller: Caller, credentialId: string): Promise<Answer<404 | 422>> {
      const row = await credentialsRepo().get(owned(deps.db, caller.userId), credentialId);
      if (row === undefined) return TOOL_NOT_FOUND;
      if (!isToolKind(row.kind)) return NOT_A_TOOL;
      if (row.status === 'revoked') return TOOL_REVOKED;
      const checked = await checkStoredTool(deps, row, { kind: 'user', requestId: caller.requestId });
      return checked === undefined ? TOOL_NOT_FOUND : { ok: true, signIn: checked };
    },
  };
}
