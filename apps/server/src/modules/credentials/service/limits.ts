import { type Credential, owned } from '@mwc/db';
import type { Logger } from 'pino';
import { credentialsRepo } from '../repo.ts';
import { pastFloor, type UsageErrorCode, usageError, usageSourceOf } from '../rules/limits.ts';
import type { SubscriptionLimits, UsageSource } from '../schemas/limits.ts';
import type { Caller } from '../service.ts';
import type { AnySecret } from './secret-updates.ts';
import {
  type CredentialSecrets,
  credentialSecrets,
  type SecretDeps,
  type UsedCredential,
} from './secrets.ts';
import type { UsageCache, UsageEntry } from './usage/cache.ts';
import { checkClaudeOauth } from './usage/claude.ts';
import { checkCodexOauth } from './usage/codex.ts';
import type { ProviderFetch, UsageOutcome } from './usage/http.ts';
import { checkSetupToken } from './usage/setup-token.ts';

/**
 * The limits widget's logic (S3.3, docs/subscriptions.md "The limits widget"): each of the caller's subscriptions
 * with its last check from the cache. A subscription never checked in this process is checked now; with `refresh`,
 * so is one whose last check is past its floor (5 minutes, 15 for the setup-token probe). One check runs per
 * subscription at a time and concurrent callers share it. Each check opens the secret through `useCredentialSecret`
 * (`usage_check`, recorded in `credential_uses`), stores a refreshed token set with `replaceCredentialSecret`, and
 * marks a login that no longer works as `needs_sign_in` (and `active` again once it works). A failed check keeps the
 * last good windows, marked stale. Logs name the credential, its kind and the refusal's code only: never a token or a
 * provider's answer.
 */

export interface LimitsDeps extends SecretDeps {
  readonly logger: Logger;
  readonly providerFetch: ProviderFetch;
  readonly usageCache: UsageCache;
}

type Checked = Exclude<UsageSource, 'none'>;

/** The card of a subscription with no plan limits (API keys, gateways): nothing to check. */
const noLimits = (row: Credential): SubscriptionLimits => ({
  credentialId: row.id,
  kind: row.kind,
  label: row.label,
  accountEmail: row.accountEmail,
  source: 'none',
  checkedAt: null,
  windows: [],
  error: null,
  stale: false,
});

/** A checked subscription's card: its last good windows, stale when the last check failed. */
function limitsView(row: Credential, source: Checked, entry: UsageEntry | undefined): SubscriptionLimits {
  return {
    ...noLimits(row),
    source,
    checkedAt: entry?.checkedAt.toISOString() ?? null,
    windows: entry?.lastGood ? [...entry.lastGood.windows] : [],
    error: entry?.error ?? null,
    stale: entry?.error != null && entry.lastGood !== null,
  };
}

/** What the steps of a check share: the deps, the store's internal service and the checks in flight. */
interface Limits {
  readonly deps: LimitsDeps;
  readonly secrets: CredentialSecrets;
  readonly inFlight: Map<string, Promise<UsageEntry>>;
}

/** Runs the check of an opened credential's kind; a login's refreshed token set is sealed again. */
function runCheck(l: Limits, used: UsedCredential & { ok: true }, caller: Caller) {
  const base = { fetch: l.deps.providerFetch, clock: l.deps.clock };
  const reseal = async (secret: AnySecret) => {
    await l.secrets.replaceCredentialSecret(
      used.credential.id,
      caller.userId,
      secret,
      'usage_check',
      caller.requestId,
    );
  };
  switch (used.kind) {
    case 'claude_oauth':
      return checkClaudeOauth(used.secret, { ...base, reseal });
    case 'codex_oauth':
      return checkCodexOauth(used.secret, { ...base, reseal });
    case 'claude_setup_token':
      return checkSetupToken(used.secret, base);
    default:
      throw new Error(`No usage check for ${used.kind}`);
  }
}

/** Opens the secret and checks it; an unexpected failure is logged by its name only and is `check_failed`. */
async function outcomeFor(l: Limits, row: Credential, caller: Caller): Promise<UsageOutcome> {
  try {
    const used = await l.secrets.useCredentialSecret(row.id, caller.userId, 'usage_check');
    if (!used.ok) return { ok: false, code: used.code };
    return await runCheck(l, used, caller);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    l.deps.logger.error(
      { credentialId: row.id, kind: row.kind, error: name },
      'usage check failed unexpectedly',
    );
    return { ok: false, code: 'check_failed' };
  }
}

/** One check: its outcome in the cache (keeping the last good windows), and the login's status kept in step. */
async function check(l: Limits, row: Credential, caller: Caller): Promise<UsageEntry> {
  const checkedAt = l.deps.clock();
  const outcome = await outcomeFor(l, row, caller);
  const previous = await l.deps.usageCache.get(row.id);
  const code: UsageErrorCode | null = outcome.ok ? null : outcome.code;
  if (code === 'needs_sign_in' || (outcome.ok && row.status === 'needs_sign_in')) {
    const status = outcome.ok ? 'active' : 'needs_sign_in';
    await l.secrets.setCredentialStatus(row.id, caller.userId, status, caller.requestId);
  }
  if (code !== null) l.deps.logger.warn({ credentialId: row.id, kind: row.kind, code }, 'usage check failed');
  const entry: UsageEntry = {
    checkedAt,
    error: code === null ? null : usageError(code),
    lastGood: outcome.ok ? { windows: outcome.windows, checkedAt } : (previous?.lastGood ?? null),
  };
  await l.deps.usageCache.set(row.id, entry);
  return entry;
}

/** The subscription's entry: the check in flight, the cached one, or a new check when it is due. */
async function entryFor(l: Limits, row: Credential, source: Checked, caller: Caller, refresh: boolean) {
  const running = l.inFlight.get(row.id);
  if (running) return running;
  const cached = await l.deps.usageCache.get(row.id);
  const due = cached === undefined || (refresh && pastFloor(source, cached.checkedAt, l.deps.clock()));
  if (!due) return cached;
  const raced = l.inFlight.get(row.id);
  if (raced) return raced;
  const started = check(l, row, caller).finally(() => l.inFlight.delete(row.id));
  l.inFlight.set(row.id, started);
  return started;
}

export function limitsService(deps: LimitsDeps) {
  const repo = credentialsRepo();
  const l: Limits = { deps, secrets: credentialSecrets(deps), inFlight: new Map() };
  return {
    /** The caller's subscriptions, oldest first, each with its limits (see above). */
    async list(caller: Caller, refresh: boolean): Promise<SubscriptionLimits[]> {
      const rows = await repo.list(owned(deps.db, caller.userId));
      return Promise.all(
        rows.map(async (row) => {
          const source = usageSourceOf(row.kind);
          if (source === 'none') return noLimits(row);
          return limitsView(row, source, await entryFor(l, row, source, caller, refresh));
        }),
      );
    },
  };
}
