import { type Credential, diffFields, owned } from '@mwc/db';
import type { ToolCredentialKind } from '@mwc/shared/credentials';
import type { Logger } from 'pino';
import { credentialsRepo } from '../../repo.ts';
import type { ToolOutcome } from '../../rules/tools.ts';
import { credentialView } from '../../rules.ts';
import type { SecretOf } from '../../schemas/secrets.ts';
import type { SubscriptionView } from '../../schemas.ts';
import { TOOL_CHECK } from '../first-check.ts';
import { credentialSecrets, type SecretDeps } from '../secrets.ts';
import type { ProviderFetch } from '../usage/http.ts';
import { checkAtlassian } from './atlassian.ts';
import { checkGitHub } from './github.ts';

/**
 * A stored tool sign-in's check (S7.1a), for Check again and the daily check: its secret opened for `tool_check` (one
 * `credential_uses` row), the provider asked, and what it said kept on the sign-in. A working check sets it `active`
 * with the account the provider names; a 401 sets it `needs_sign_in`; a check that did not finish keeps its status and
 * says why (`check_error`). The status and account changes are audited (the person for Check again, the system for the
 * daily check); the check's own time and error are bookkeeping, like `last_used_at`.
 */

/** What the checks need: the store's deps, the logger and the provider client. */
export interface ToolDeps extends SecretDeps {
  readonly logger: Logger;
  readonly providerFetch: ProviderFetch;
}

/** A tool kind with its secret. */
export type ToolSecret = {
  [K in ToolCredentialKind]: { readonly kind: K; readonly secret: SecretOf<K> };
}[ToolCredentialKind];

/** Asks the sign-in's provider who it acts as. */
export function checkTool(fetchFn: ProviderFetch, tool: ToolSecret): Promise<ToolOutcome> {
  switch (tool.kind) {
    case 'github_oauth':
      return checkGitHub(fetchFn, tool.secret.token, false);
    case 'github_token':
      return checkGitHub(fetchFn, tool.secret.token, true);
    case 'atlassian_api_token':
      return checkAtlassian(fetchFn, tool.secret);
  }
}

/** Who a check acts for: the person (Check again, with their request) or the system (the daily check). */
export type CheckActor = { readonly kind: 'user'; readonly requestId: string } | { readonly kind: 'system' };

const accountOf = (row: Pick<Credential, 'status' | 'accountEmail' | 'accountMeta'>) => ({
  status: row.status,
  accountEmail: row.accountEmail,
  accountMeta: row.accountMeta,
});

/** What a check changes on the sign-in: its status, account and last check. */
function afterCheck(outcome: ToolOutcome, at: Date) {
  if (outcome.ok) {
    const { accountEmail, accountMeta } = outcome;
    return { status: 'active' as const, accountEmail, accountMeta, checkedAt: at, checkError: null };
  }
  if (outcome.code === 'needs_sign_in')
    return { status: 'needs_sign_in' as const, checkedAt: at, checkError: null };
  return { checkedAt: at, checkError: outcome.code };
}

/**
 * Keeps a check's outcome on the owner's sign-in, with its audit row; undefined when it is gone, and a revoked one
 * as it is.
 */
export function recordToolCheck(
  deps: SecretDeps,
  credentialId: string,
  ownerUserId: string,
  outcome: ToolOutcome,
  actor: CheckActor,
): Promise<SubscriptionView | undefined> {
  const repo = credentialsRepo();
  return owned(deps.db, ownerUserId).transaction(async (tx) => {
    const row = await repo.get(tx, credentialId);
    if (row === undefined || row.status === 'revoked') return row && credentialView(row);
    const now = deps.clock();
    const set = afterCheck(outcome, now);
    const changes = diffFields(accountOf(row), accountOf({ ...row, ...set }));
    const updated = (await repo.update(tx, row.id, {
      ...set,
      updatedAt: changes.length > 0 ? now : row.updatedAt,
    })) as Credential;
    if (changes.length > 0) {
      await repo.audit(tx, {
        actorKind: actor.kind,
        requestId: actor.kind === 'user' ? actor.requestId : null,
        entityType: 'credential',
        entityId: row.id,
        action: 'update',
        changes,
      });
    }
    return credentialView(updated);
  });
}

/** Opens the sign-in's secret, asks its provider and keeps the outcome; an unexpected failure is `check_failed`. */
async function outcomeOf(deps: ToolDeps, row: Credential): Promise<ToolOutcome | 'gone'> {
  try {
    const used = await credentialSecrets(deps).useCredentialSecret(row.id, row.ownerUserId, TOOL_CHECK);
    if (!used.ok) return 'gone';
    return await checkTool(deps.providerFetch, used as ToolSecret);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    deps.logger.error(
      { credentialId: row.id, kind: row.kind, error: name },
      'tool check failed unexpectedly',
    );
    return { ok: false, code: 'check_failed' };
  }
}

/**
 * Checks one stored tool sign-in now and keeps what its provider said; undefined when it is gone or revoked meanwhile.
 * Logs name the sign-in, its kind and the refusal's code: never a token or a provider's answer.
 */
export async function checkStoredTool(
  deps: ToolDeps,
  row: Credential,
  actor: CheckActor,
): Promise<SubscriptionView | undefined> {
  const outcome = await outcomeOf(deps, row);
  if (outcome === 'gone') return undefined;
  if (!outcome.ok)
    deps.logger.warn({ credentialId: row.id, kind: row.kind, code: outcome.code }, 'tool check failed');
  return recordToolCheck(deps, row.id, row.ownerUserId, outcome, actor);
}
