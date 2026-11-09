import type { HarnessCredential, HarnessGateway } from '@mwc/shared/harness';
import type { Logger } from 'pino';
import type { UseContext } from '../repo.ts';
import {
  CLAUDE_TURN_MARGIN_MS,
  CODEX_TURN_MARGIN_MS,
  HARNESS_CREDENTIAL_NOT_FOUND,
  HARNESS_CREDENTIAL_REVOKED,
  HARNESS_CREDENTIAL_UNUSABLE,
  HARNESS_NEEDS_SIGN_IN,
  HARNESS_PROVIDER_UNAVAILABLE,
  type HarnessRefusal,
  harnessCredentialOf,
  harnessGatewayOf,
} from '../rules/harness.ts';
import { CodexAuthFile, type KindSecret } from '../schemas/secrets.ts';
import {
  type CredentialSecrets,
  credentialSecrets,
  type SecretDeps,
  type UsedCredential,
} from './secrets.ts';
import { refreshClaudeLogin } from './usage/claude.ts';
import { jwtExpiry, refreshCodexLogin } from './usage/codex.ts';
import { expiresSoon, type ProviderFetch, UsageFailure } from './usage/http.ts';

/**
 * Subscriptions opened for a chat's turn or terminal (S5.1b, docs/harness.md "How a turn runs"), for the chats module:
 * the secret is opened as its owner (a `credential_uses` row naming the company, the agent, the chat and who asked), a
 * Claude login whose access token has under 60 minutes left and a Codex login whose token is near its end (as the usage
 * check) are refreshed first and sealed again, and the result is mapped to the wire's `HarnessCredential` or
 * `HarnessGateway`. A Codex login the process rewrote (its own refresh) is sealed again from the runner's copy. Logs name
 * the credential and a code only.
 */

export interface HarnessDeps extends SecretDeps {
  readonly logger: Logger;
  readonly providerFetch: ProviderFetch;
}

/** A chat's use of a subscription: what for, and in which company, for which agent and chat, by whom. */
export interface HarnessUse extends UseContext {
  readonly purpose: 'chat_turn' | 'chat_terminal';
}

type Opened = UsedCredential & { readonly ok: true };

/** The kind and secret of an opened credential, without the rest. */
const secretOf = (opened: Opened): KindSecret => ({ kind: opened.kind, secret: opened.secret }) as KindSecret;

/** Opens the owner's credential for the use, as the store records it. */
async function open(
  secrets: CredentialSecrets,
  credentialId: string,
  ownerUserId: string,
  use: HarnessUse,
): Promise<Opened | HarnessRefusal> {
  const { purpose, ...context } = use;
  const used = await secrets.useCredentialSecret(credentialId, ownerUserId, purpose, context);
  if (used.ok) return used;
  return used.code === 'credential_revoked' ? HARNESS_CREDENTIAL_REVOKED : HARNESS_CREDENTIAL_NOT_FOUND;
}

/** What a refresh needs: the provider, the clock and the store that seals the new token set. */
type RefreshContext = Parameters<typeof refreshClaudeLogin>[1] & Parameters<typeof refreshCodexLogin>[1];

interface Due {
  /** When the login's access token ends (epoch ms), when it says. */
  readonly expiresAt: number | undefined;
  /** The refresh, when the token is due. */
  readonly refresh: (() => Promise<KindSecret>) | undefined;
}

/** A login's token end and, when it is due, its refresh; nothing for the other kinds. */
function dueRefresh(opened: Opened, now: Date, ctx: RefreshContext): Due {
  if (opened.kind === 'claude_oauth') {
    const login = opened.secret;
    const expiresAt = login.credentials.claudeAiOauth?.expiresAt;
    const refresh = async (): Promise<KindSecret> => ({
      kind: 'claude_oauth',
      secret: await refreshClaudeLogin(login, ctx),
    });
    return { expiresAt, refresh: expiresSoon(expiresAt, now, CLAUDE_TURN_MARGIN_MS) ? refresh : undefined };
  }
  if (opened.kind === 'codex_oauth') {
    const login = opened.secret;
    const access = login.auth.tokens?.access_token;
    const expiresAt = access === undefined ? undefined : jwtExpiry(access);
    const refresh = async (): Promise<KindSecret> => ({
      kind: 'codex_oauth',
      secret: await refreshCodexLogin(login, ctx),
    });
    return { expiresAt, refresh: expiresSoon(expiresAt, now, CODEX_TURN_MARGIN_MS) ? refresh : undefined };
  }
  return { expiresAt: undefined, refresh: undefined };
}

/**
 * The secret, its login refreshed when its token is due. A refused refresh marks the login `needs_sign_in`; a provider
 * that does not answer keeps the old token while it still works.
 */
async function fresh(
  deps: HarnessDeps,
  secrets: CredentialSecrets,
  opened: Opened,
  ownerUserId: string,
  purpose: HarnessUse['purpose'],
): Promise<KindSecret | HarnessRefusal> {
  const now = deps.clock();
  const credentialId = opened.credential.id;
  const reseal = async (secret: KindSecret['secret']) => {
    await secrets.replaceCredentialSecret(credentialId, ownerUserId, secret, purpose);
  };
  const ctx = { fetch: deps.providerFetch, clock: deps.clock, reseal };
  const { expiresAt, refresh } = dueRefresh(opened, now, ctx);
  if (refresh === undefined) return secretOf(opened);
  try {
    return await refresh();
  } catch (error) {
    if (!(error instanceof UsageFailure)) throw error;
    deps.logger.warn({ credentialId, kind: opened.kind, code: error.code }, 'turn credential refresh failed');
    if (error.code === 'needs_sign_in') {
      await secrets.setCredentialStatus(credentialId, ownerUserId, 'needs_sign_in');
      return HARNESS_NEEDS_SIGN_IN;
    }
    return expiresAt !== undefined && expiresAt > now.getTime()
      ? secretOf(opened)
      : HARNESS_PROVIDER_UNAVAILABLE;
  }
}

/** The credential, opened for the use, refreshed when due, as the harness takes it. */
async function openHarnessCredential(
  deps: HarnessDeps,
  credentialId: string,
  ownerUserId: string,
  use: HarnessUse,
): Promise<{ readonly ok: true; readonly credential: HarnessCredential } | HarnessRefusal> {
  const secrets = credentialSecrets(deps);
  const opened = await open(secrets, credentialId, ownerUserId, use);
  if (!opened.ok) return opened;
  const current = await fresh(deps, secrets, opened, ownerUserId, use.purpose);
  if ('ok' in current) return current;
  const credential = harnessCredentialOf(current);
  if (credential !== undefined) return { ok: true, credential };
  return opened.kind === 'claude_oauth' || opened.kind === 'codex_oauth'
    ? HARNESS_NEEDS_SIGN_IN
    : HARNESS_CREDENTIAL_UNUSABLE;
}

/** A gateway, opened for the use, as the harness takes it. */
async function openHarnessGateway(
  deps: HarnessDeps,
  credentialId: string,
  ownerUserId: string,
  use: HarnessUse,
): Promise<{ readonly ok: true; readonly gateway: HarnessGateway } | HarnessRefusal> {
  const opened = await open(credentialSecrets(deps), credentialId, ownerUserId, use);
  if (!opened.ok) return opened;
  const gateway = harnessGatewayOf(opened, opened.credential.accountMeta);
  return gateway === undefined ? HARNESS_CREDENTIAL_UNUSABLE : { ok: true, gateway };
}

/**
 * Seals a Codex login the runner sent back (the process refreshed its token while it ran) into the credential; false,
 * logged, when it is not a login of the right shape or the credential is gone or revoked.
 */
async function rewriteCodexLogin(
  deps: HarnessDeps,
  credentialId: string,
  ownerUserId: string,
  authJson: string,
  purpose: HarnessUse['purpose'],
): Promise<boolean> {
  let auth: ReturnType<typeof CodexAuthFile.parse>;
  try {
    auth = CodexAuthFile.parse(JSON.parse(authJson));
  } catch {
    deps.logger.warn({ credentialId }, 'a rewritten Codex login was not one; kept the sealed one');
    return false;
  }
  const secrets = credentialSecrets(deps);
  const replaced = await secrets.replaceCredentialSecret(credentialId, ownerUserId, { auth }, purpose);
  if (!replaced.ok) {
    deps.logger.warn({ credentialId, code: replaced.code }, 'could not seal a rewritten Codex login');
  }
  return replaced.ok;
}

/** The chats module's side of the credentials. */
export function credentialsForHarness(deps: HarnessDeps) {
  return {
    credential: (credentialId: string, ownerUserId: string, use: HarnessUse) =>
      openHarnessCredential(deps, credentialId, ownerUserId, use),
    gateway: (credentialId: string, ownerUserId: string, use: HarnessUse) =>
      openHarnessGateway(deps, credentialId, ownerUserId, use),
    rewriteCodexLogin: (
      credentialId: string,
      ownerUserId: string,
      authJson: string,
      purpose: HarnessUse['purpose'],
    ) => rewriteCodexLogin(deps, credentialId, ownerUserId, authJson, purpose),
  };
}

export type CredentialsForHarness = ReturnType<typeof credentialsForHarness>;
export type { HarnessRefusal } from '../rules/harness.ts';
