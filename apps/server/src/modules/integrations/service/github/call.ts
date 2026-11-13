import type { TenantDb } from '@mwc/db';
import { issueLines } from '@mwc/shared/flows';
import { type GitHubApi, isGitHubError } from '@mwc/tools-core';
import type { ServerToolTurn } from '../../../chats/index.ts';
import type { CredentialsForTools } from '../../../credentials/index.ts';
import type { TurnToolCall } from '../../../machines/index.ts';
import type { IntegrationsRepo } from '../../repo.ts';
import { githubRefusal, outsideRepos, repoInScope } from '../../rules/github/rights.ts';
import { GITHUB_INPUTS, GitHubTool, REFUSED_ARGUMENTS } from '../../schemas/github.ts';
import { refused, type ToolReply } from '../reply.ts';
import type { GitHubChange, GitHubContext } from './context.ts';
import { PULL_TOOLS } from './pulls.ts';
import { REPO_TOOLS } from './repos.ts';

/**
 * One call of a GitHub tool (S7.1d), checked again on the server whatever the runner relayed: the tool is one of them,
 * the turn's profile (read now, so a change since the turn began counts) has a GitHub part whose rights give it and a
 * sign-in, no argument asks for what is not offered, the input is valid, and the repository it names is in the part's
 * allowlist (a search is scoped by its tool). Then the sign-in is opened for `tool:<name>` (a `credential_uses` row) and
 * the tool runs with it; the token never leaves the server. GitHub's refusals are answered in words, and a 401 marks the
 * sign-in as needing a sign-in. A change is audited as the agent on the pull request, with the turn as its request.
 */

export interface GitHubCallDeps {
  readonly api: GitHubApi;
  readonly credentials: CredentialsForTools;
  readonly repo: IntegrationsRepo;
}

export const NO_PROFILE = 'This turn runs on no profile, so it has no GitHub tools.';
export const NO_PART = "This agent's profile has no GitHub part now.";
export const NO_SIGN_IN =
  "This agent's profile's GitHub part has no sign-in now: its owner chooses one on Profiles.";
export const NO_AGENT = 'This turn has no agent to act as.';

/** Why an argument of the call is refused, or undefined. */
function refusedArgument(tool: GitHubTool, input: Readonly<Record<string, unknown>>): string | undefined {
  const refusals = REFUSED_ARGUMENTS[tool] ?? {};
  const name = Object.keys(refusals).find((key) => input[key] !== undefined);
  return name === undefined ? undefined : refusals[name];
}

/** Runs the tool on its checked input. */
function run(tool: GitHubTool, ctx: GitHubContext, input: unknown): Promise<ToolReply> {
  const tools = { ...PULL_TOOLS, ...REPO_TOOLS } as Record<
    GitHubTool,
    (ctx: GitHubContext, input: unknown) => Promise<ToolReply>
  >;
  return tools[tool](ctx, input);
}

/** Why the repository the input names is outside the allowlist, or undefined (a search names none). */
function repoRefusal(input: unknown, repos: GitHubContext['rights']['repos']): string | undefined {
  const { owner, repo } = input as { readonly owner?: unknown; readonly repo?: unknown };
  if (typeof owner !== 'string' || typeof repo !== 'string' || repos === 'all') return undefined;
  return repoInScope(repos, owner, repo) ? undefined : outsideRepos(`${owner}/${repo}`, repos);
}

/** The tool's input checked: its arguments, its schema, its repository; or why not. */
function checkedInput(
  tool: GitHubTool,
  call: TurnToolCall,
  repos: GitHubContext['rights']['repos'],
): { readonly input: unknown } | { readonly refusal: string } {
  const argument = refusedArgument(tool, call.input);
  if (argument !== undefined) return { refusal: argument };
  const input = GITHUB_INPUTS[tool].safeParse(call.input);
  if (!input.success)
    return {
      refusal: `${tool} did nothing; fix its input and call it again:\n${issueLines(input.error.issues)}`,
    };
  const outside = tool.startsWith('search_') ? undefined : repoRefusal(input.data, repos);
  return outside === undefined ? { input: input.data } : { refusal: outside };
}

/** One call (see above). */
export async function callGitHub(
  deps: GitHubCallDeps,
  t: TenantDb,
  turn: ServerToolTurn,
  call: TurnToolCall,
): Promise<ToolReply> {
  const known = GitHubTool.safeParse(call.tool);
  if (!known.success) return refused(`Unknown tool: ${call.tool}`);
  const tool = known.data;
  if (turn.profileId === null) return refused(NO_PROFILE);
  const part = await deps.repo.githubPart(t, turn.profileId);
  if (part === undefined) return refused(NO_PART);
  const rights = githubRefusal(tool, part.rights);
  if (rights !== undefined) return refused(rights);
  if (part.credentialId === null) return refused(NO_SIGN_IN);
  const checked = checkedInput(tool, call, part.rights.repos);
  if ('refusal' in checked) return refused(checked.refusal);
  const agent = await deps.repo.agentOf(t, turn.agentPrincipalId);
  if (agent === undefined) return refused(NO_AGENT);
  const use = {
    purpose: `tool:${tool}` as const,
    companyId: t.companyId,
    agentId: agent.id,
    chatId: turn.chatId,
  };
  const opened = await deps.credentials.github(part.credentialId, part.ownerUserId, {
    ...use,
    principalId: turn.by,
  });
  if (!opened.ok) return refused(opened.message);
  const audit = (change: GitHubChange) =>
    deps.repo.audit(t, {
      actorKind: 'agent',
      actorPrincipalId: turn.agentPrincipalId,
      requestId: turn.turnId,
      entityType: 'github_pull_request',
      entityId: change.entityId,
      action: `tool:${tool}`,
      changes: change.changes.map((c) => ({ field: c.field, old: c.old ?? null, new: c.new })),
    });
  try {
    return await run(
      tool,
      { api: deps.api, signIn: opened.signIn, rights: part.rights, audit },
      checked.input,
    );
  } catch (error) {
    if (!isGitHubError(error)) throw error;
    if (error.code === 'needs_sign_in')
      await deps.credentials.needsSignIn(part.credentialId, part.ownerUserId);
    return refused(error.message);
  }
}
