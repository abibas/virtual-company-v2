import type { Logger } from 'pino';
import type { UseContext } from '../repo.ts';
import { credentialSecrets, type SecretDeps } from './secrets.ts';
import { type CheckActor, recordToolCheck } from './tools/check.ts';

/**
 * Tool sign-ins opened for the agents' server tools (S7.1c, docs/subscriptions.md "Atlassian tools" and "GitHub tools"),
 * for the integrations module: the secret is opened as its owner for `tool:<name>` (a `credential_uses` row naming the
 * company, the agent, the chat and who sent the turn's prompt), never leaving the server but for `tool:git` (S7.1d: a
 * GitHub sign-in's token for git and gh in one turn); and a sign-in its provider refused (401) is marked as needing a
 * sign-in, as its check would (`recordToolCheck`, by the system).
 */

/** An agent's tool call's use of a sign-in: `tool:<name>`, in which company, for which agent and chat, by whom. */
export interface ToolUse extends UseContext {
  readonly purpose: `tool:${string}`;
}

/** An Atlassian sign-in opened for one call, or why not (in words an agent can pass on). */
export type OpenedAtlassian =
  | {
      readonly ok: true;
      readonly signIn: { readonly site: string; readonly email: string; readonly token: string };
    }
  | { readonly ok: false; readonly message: string };

/** A GitHub sign-in opened for one call (or one turn's git), or why not. */
export type OpenedGitHub =
  | { readonly ok: true; readonly signIn: { readonly token: string } }
  | { readonly ok: false; readonly message: string };

const SYSTEM: CheckActor = { kind: 'system' };

export const SIGN_IN_GONE =
  "The Atlassian sign-in of this agent's profile is gone: its owner adds one on the Subscriptions page.";
export const SIGN_IN_REVOKED =
  "The Atlassian sign-in of this agent's profile was revoked: its owner signs in again on the Subscriptions page.";
export const NOT_ATLASSIAN = "The sign-in in this agent's profile's Atlassian part is not an Atlassian one.";
export const GITHUB_SIGN_IN_GONE =
  "The GitHub sign-in of this agent's profile is gone: its owner adds one on the Subscriptions page.";
export const GITHUB_SIGN_IN_REVOKED =
  "The GitHub sign-in of this agent's profile was revoked: its owner signs in again on the Subscriptions page.";
export const NOT_GITHUB = "The sign-in in this agent's profile's GitHub part is not a GitHub one.";

/** The tool sign-ins' side for the agents' tools on these deps. */
export function credentialsForTools(deps: SecretDeps & { readonly logger: Logger }) {
  const secrets = credentialSecrets(deps);
  return {
    /** Opens the owner's Atlassian sign-in for the use; a revoked or gone one is refused, recording nothing. */
    async atlassian(credentialId: string, ownerUserId: string, use: ToolUse): Promise<OpenedAtlassian> {
      const { purpose, ...context } = use;
      const used = await secrets.useCredentialSecret(credentialId, ownerUserId, purpose, context);
      if (!used.ok)
        return { ok: false, message: used.code === 'credential_revoked' ? SIGN_IN_REVOKED : SIGN_IN_GONE };
      if (used.kind !== 'atlassian_api_token') return { ok: false, message: NOT_ATLASSIAN };
      const { site, email, token } = used.secret;
      return { ok: true, signIn: { site, email, token } };
    },
    /** Opens the owner's GitHub sign-in for the use; a revoked or gone one is refused, recording nothing. */
    async github(credentialId: string, ownerUserId: string, use: ToolUse): Promise<OpenedGitHub> {
      const { purpose, ...context } = use;
      const used = await secrets.useCredentialSecret(credentialId, ownerUserId, purpose, context);
      if (!used.ok)
        return {
          ok: false,
          message: used.code === 'credential_revoked' ? GITHUB_SIGN_IN_REVOKED : GITHUB_SIGN_IN_GONE,
        };
      if (used.kind !== 'github_oauth' && used.kind !== 'github_token')
        return { ok: false, message: NOT_GITHUB };
      return { ok: true, signIn: { token: used.secret.token } };
    },
    /** The provider refused the sign-in (401): it needs signing in again, as its check would say. */
    async needsSignIn(credentialId: string, ownerUserId: string): Promise<void> {
      await recordToolCheck(deps, credentialId, ownerUserId, { ok: false, code: 'needs_sign_in' }, SYSTEM);
      deps.logger.warn({ credentialId }, 'a tool sign-in was refused by its provider; it needs a sign-in');
    },
  };
}

export type CredentialsForTools = ReturnType<typeof credentialsForTools>;
