import type { TenantDb } from '@mwc/db';
import type { TurnGitHub } from '@mwc/shared/harness';
import type { GitHubApi } from '@mwc/tools-core';
import type { Logger } from 'pino';
import type { GitUse, ServerToolsHook, ServerToolsPlan } from '../../../chats/index.ts';
import {
  type CredentialsForTools,
  credentialsForTools,
  type SecretDeps,
} from '../../../credentials/index.ts';
import { type GitHubPart, type IntegrationsRepo, integrationsRepo } from '../../repo.ts';
import { offeredGitHubTools } from '../../rules/github/rights.ts';
import {
  GITHUB_LABEL,
  GITHUB_PUSH_LABEL,
  type GitState,
  githubLine,
  githubToolDef,
} from '../../rules/github/words.ts';
import { GitHubTool } from '../../schemas/github.ts';
import { TOOL_FAILED } from '../reply.ts';
import { callGitHub } from './call.ts';

/**
 * The GitHub tools as a `ServerToolsHook` (S7.1d): a message turn on a profile whose GitHub part has a sign-in and
 * reaches a repository gets the read tools, and the pull request tools with `pullRequests`, with one line for its
 * standing instructions. When the part may push and the turn's runner takes it (`git`), the sign-in's token is opened for
 * `tool:git` (a `credential_uses` row) and goes in the turn's spec for git and gh (`TurnSpec.github`), with the
 * allowlist its pre-push hook checks; the line says what git and gh get. Each call is `call.ts`'s. It never throws: a
 * failure is logged and answered in words.
 */

export interface GitHubToolsDeps extends SecretDeps {
  readonly logger: Logger;
  /** The GitHub port (the connector, wired in `app.ts`). */
  readonly github: GitHubApi;
}

/** The sign-in for git in this turn, or what git gets instead. */
async function gitSignIn(
  credentials: CredentialsForTools,
  t: TenantDb,
  part: GitHubPart & { readonly credentialId: string },
  git: GitUse | undefined,
): Promise<{ readonly state: GitState; readonly github?: TurnGitHub }> {
  if (!part.rights.push) return { state: { kind: 'off' } };
  if (git === undefined) return { state: { kind: 'runner' } };
  const use = {
    purpose: 'tool:git' as const,
    companyId: t.companyId,
    agentId: git.agentId,
    chatId: git.chatId,
  };
  const opened = await credentials.github(part.credentialId, part.ownerUserId, {
    ...use,
    principalId: git.by,
  });
  if (!opened.ok) return { state: { kind: 'failed', message: opened.message } };
  const { repos } = part.rights;
  const allowed = repos === 'all' ? 'all' : repos.map((entry) => entry.toLowerCase());
  return { state: { kind: 'token' }, github: { token: opened.signIn.token, repos: allowed } };
}

/** The tools (and the git sign-in) a turn on this profile gets (see above). */
export async function githubToolsFor(
  deps: { readonly repo: IntegrationsRepo; readonly credentials: CredentialsForTools },
  t: TenantDb,
  turn: { readonly profileId: string; readonly git?: GitUse },
): Promise<ServerToolsPlan> {
  const part = await deps.repo.githubPart(t, turn.profileId);
  if (part === undefined || part.credentialId === null) return { tools: [] };
  const tools = offeredGitHubTools(part.rights);
  if (tools.length === 0) return { tools: [] };
  const { credentialId } = part;
  const git = await gitSignIn(deps.credentials, t, { ...part, credentialId }, turn.git);
  return {
    tools: tools.map(githubToolDef),
    instructions: githubLine(part.account, part.rights, tools, git.state),
    label: GITHUB_LABEL,
    ...(git.github === undefined ? {} : { github: git.github }),
    ...(part.rights.push ? { pushLabel: GITHUB_PUSH_LABEL } : {}),
  };
}

/** The hook on these deps. */
export function githubTools(deps: GitHubToolsDeps): ServerToolsHook {
  const repo = integrationsRepo;
  const credentials = credentialsForTools(deps);
  const call = { api: deps.github, credentials, repo };
  return {
    async toolsFor(t, turn) {
      try {
        return await githubToolsFor({ repo, credentials }, t, turn);
      } catch (error) {
        deps.logger.error(
          { err: error, profileId: turn.profileId },
          'integrations: could not offer the GitHub tools',
        );
        return { tools: [] };
      }
    },
    owns: (tool) => GitHubTool.safeParse(tool).success,
    async tool(t, turn, toolCall) {
      try {
        return await callGitHub(call, t, turn, toolCall);
      } catch (error) {
        deps.logger.error(
          { err: error, turnId: turn.turnId, tool: toolCall.tool },
          'integrations: a GitHub tool failed',
        );
        return { ok: false, text: TOOL_FAILED };
      }
    },
  };
}
