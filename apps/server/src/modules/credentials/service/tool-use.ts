import { owned } from '@mwc/db';
import type { Logger } from 'pino';
import { credentialsRepo, type UseContext } from '../repo.ts';
import { credentialSecrets, type SecretDeps } from './secrets.ts';
import { type CheckActor, recordToolCheck } from './tools/check.ts';

/**
 * Tool sign-ins opened for the agents' server tools (S7.1c, docs/subscriptions.md "Atlassian tools" and "GitHub tools"),
 * for the integrations module (Slack's since S7.1e): the secret is opened as its owner for `tool:<name>` (a `credential_uses` row naming the
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

/** A Slack sign-in opened for one call (S7.1e): its token, and whether it is a user's (posting as that person). */
export type OpenedSlack =
  | { readonly ok: true; readonly signIn: { readonly token: string; readonly asUser: boolean } }
  | { readonly ok: false; readonly message: string };

/** A GitHub sign-in opened for one call (or one turn's git), or why not. */
export type OpenedGitHub =
  | { readonly ok: true; readonly signIn: { readonly token: string } }
  | { readonly ok: false; readonly message: string };

/**
 * A Slack connection's opening of its bot sign-in (2026-11-13, docs/subscriptions.md "Slack: receiving messages"):
 * for Socket Mode (`socket_mode`: the connection holds the token for its messages' reads and notices, and records each
 * message's wake of an agent as `inbound`, which the hourly cap counts), an agent's answer (`inbound_reply`, with the
 * company, the agent, its chat and the agent as the one asking), a search of the workspace's people (`slack_people`).
 */
export type SlackConnectionUse =
  | { readonly purpose: 'socket_mode' | 'slack_people' }
  | ({ readonly purpose: 'inbound_reply' } & UseContext);

/** A Slack bot sign-in opened for its connection: its token and its account details (the bot, the workspace, scopes). */
export type OpenedSlackBot =
  | {
      readonly ok: true;
      readonly token: string;
      readonly meta: Readonly<Record<string, unknown>>;
      /** When the sign-in last changed (Sign in again puts a new token in): a holder opens it again after. */
      readonly updatedAt: string;
    }
  | { readonly ok: false; readonly message: string };

export const NOT_A_SLACK_BOT = 'This sign-in is not a Slack bot token (xoxb-).';

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
export const SLACK_SIGN_IN_GONE =
  "The Slack sign-in of this agent's profile is gone: its owner adds one on the Subscriptions page.";
export const SLACK_SIGN_IN_REVOKED =
  "The Slack sign-in of this agent's profile was revoked: its owner adds a token again on the Subscriptions page.";
export const NOT_SLACK = "The sign-in in this agent's profile's Slack part is not a Slack one.";

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
    /** Opens the owner's Slack sign-in for the use (S7.1e); a revoked or gone one is refused, recording nothing. */
    async slack(credentialId: string, ownerUserId: string, use: ToolUse): Promise<OpenedSlack> {
      const { purpose, ...context } = use;
      const used = await secrets.useCredentialSecret(credentialId, ownerUserId, purpose, context);
      if (!used.ok)
        return {
          ok: false,
          message: used.code === 'credential_revoked' ? SLACK_SIGN_IN_REVOKED : SLACK_SIGN_IN_GONE,
        };
      if (used.kind !== 'slack_bot_token' && used.kind !== 'slack_user_token')
        return { ok: false, message: NOT_SLACK };
      return { ok: true, signIn: { token: used.secret.token, asUser: used.kind === 'slack_user_token' } };
    },
    /** Opens the owner's Slack bot sign-in for its connection's use (see `SlackConnectionUse`). */
    async slackBot(
      credentialId: string,
      ownerUserId: string,
      use: SlackConnectionUse,
    ): Promise<OpenedSlackBot> {
      const { purpose, ...context } = use;
      const companyContext = 'companyId' in context ? (context as UseContext) : undefined;
      const used = await secrets.useCredentialSecret(credentialId, ownerUserId, purpose, companyContext);
      if (!used.ok)
        return {
          ok: false,
          message: used.code === 'credential_revoked' ? SLACK_SIGN_IN_REVOKED : SLACK_SIGN_IN_GONE,
        };
      if (used.kind !== 'slack_bot_token') return { ok: false, message: NOT_A_SLACK_BOT };
      const { accountMeta: meta, updatedAt } = used.credential;
      return { ok: true, token: used.secret.token, meta, updatedAt };
    },
    /**
     * Records a use of the token a connection opened for Socket Mode and holds (a message's wake): false when the
     * sign-in is gone or revoked meanwhile, recording nothing.
     */
    async recordSlackUse(
      credentialId: string,
      ownerUserId: string,
      use: { readonly purpose: 'inbound' } & UseContext,
    ): Promise<boolean> {
      const { purpose, ...context } = use;
      const o = owned(deps.db, ownerUserId);
      const repo = credentialsRepo();
      const row = await repo.get(o, credentialId);
      if (row === undefined || row.status === 'revoked') return false;
      await repo.recordUse(o, row, purpose, deps.clock(), context);
      return true;
    },
    /** How many uses of the owner's sign-in for `purpose` since `since` (a connection's wakes in the last hour). */
    usesSince: (credentialId: string, ownerUserId: string, purpose: string, since: Date): Promise<number> =>
      credentialsRepo().usesSince(owned(deps.db, ownerUserId), credentialId, purpose, since),
    /** The provider refused the sign-in (401): it needs signing in again, as its check would say. */
    async needsSignIn(credentialId: string, ownerUserId: string): Promise<void> {
      await recordToolCheck(deps, credentialId, ownerUserId, { ok: false, code: 'needs_sign_in' }, SYSTEM);
      deps.logger.warn({ credentialId }, 'a tool sign-in was refused by its provider; it needs a sign-in');
    },
  };
}

export type CredentialsForTools = ReturnType<typeof credentialsForTools>;
