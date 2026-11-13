import type { TenantDb } from '@mwc/db';
import { issueLines } from '@mwc/shared/flows';
import { type AtlassianApi, isAtlassianError } from '@mwc/tools-core';
import type { ServerToolTurn } from '../../../chats/index.ts';
import type { CredentialsForTools } from '../../../credentials/index.ts';
import type { TurnToolCall } from '../../../machines/index.ts';
import type { IntegrationsRepo } from '../../repo.ts';
import { toolRefusal } from '../../rules/atlassian/rights.ts';
import { ATLASSIAN_INPUTS, AtlassianTool, REFUSED_ARGUMENTS } from '../../schemas/atlassian.ts';
import { CONFLUENCE_TOOLS } from './confluence.ts';
import { refused, type ToolChange, type ToolContext, type ToolReply } from './context.ts';
import { JIRA_TOOLS } from './jira.ts';

/**
 * One call of an Atlassian tool (S7.1c), checked again on the server whatever the runner relayed: the tool is one of
 * them, the turn's profile (read now, so a change since the turn began counts) has an Atlassian part whose rights give
 * it and a sign-in, no argument asks for what is not offered, and the input is valid. Then the sign-in is opened for
 * `tool:<name>` (a `credential_uses` row) and the tool runs with it; the token never leaves the server. Atlassian's
 * refusals are answered in words, and a 401 marks the sign-in as needing a sign-in. A change is audited as the agent,
 * with the turn as its request.
 */

export interface AtlassianCallDeps {
  readonly api: AtlassianApi;
  readonly credentials: CredentialsForTools;
  readonly repo: IntegrationsRepo;
}

export const NO_PROFILE = 'This turn runs on no profile, so it has no Atlassian tools.';
export const NO_PART = "This agent's profile has no Atlassian part now.";
export const NO_SIGN_IN =
  "This agent's profile's Atlassian part has no sign-in now: its owner chooses one on Profiles.";
export const NO_AGENT = 'This turn has no agent to act as.';

/** Why an argument of the call is refused, or undefined. */
function refusedArgument(tool: AtlassianTool, input: Readonly<Record<string, unknown>>): string | undefined {
  const refusals = REFUSED_ARGUMENTS[tool] ?? {};
  const name = Object.keys(refusals).find((key) => input[key] !== undefined);
  return name === undefined ? undefined : refusals[name];
}

/** Runs the tool on its checked input. */
function run(tool: AtlassianTool, ctx: ToolContext, input: unknown): Promise<ToolReply> {
  const tools = { ...JIRA_TOOLS, ...CONFLUENCE_TOOLS } as Record<
    AtlassianTool,
    (ctx: ToolContext, input: unknown) => Promise<ToolReply>
  >;
  return tools[tool](ctx, input);
}

/** One call (see above). */
export async function callAtlassian(
  deps: AtlassianCallDeps,
  t: TenantDb,
  turn: ServerToolTurn,
  call: TurnToolCall,
): Promise<ToolReply> {
  const known = AtlassianTool.safeParse(call.tool);
  if (!known.success) return refused(`Unknown tool: ${call.tool}`);
  const tool = known.data;
  if (turn.profileId === null) return refused(NO_PROFILE);
  const part = await deps.repo.atlassianPart(t, turn.profileId);
  if (part === undefined) return refused(NO_PART);
  const rights = toolRefusal(tool, part.rights);
  if (rights !== undefined) return refused(rights);
  if (part.credentialId === null) return refused(NO_SIGN_IN);
  const argument = refusedArgument(tool, call.input);
  if (argument !== undefined) return refused(argument);
  const input = ATLASSIAN_INPUTS[tool].safeParse(call.input);
  if (!input.success)
    return refused(
      `${tool} did nothing; fix its input and call it again:\n${issueLines(input.error.issues)}`,
    );
  const agent = await deps.repo.agentOf(t, turn.agentPrincipalId);
  if (agent === undefined) return refused(NO_AGENT);
  const use = {
    purpose: `tool:${tool}` as const,
    companyId: t.companyId,
    agentId: agent.id,
    chatId: turn.chatId,
  };
  const opened = await deps.credentials.atlassian(part.credentialId, part.ownerUserId, {
    ...use,
    principalId: turn.by,
  });
  if (!opened.ok) return refused(opened.message);
  const audit = (change: ToolChange) =>
    deps.repo.audit(t, {
      actorKind: 'agent',
      actorPrincipalId: turn.agentPrincipalId,
      requestId: turn.turnId,
      entityType: change.entityType,
      entityId: change.entityId,
      action: `tool:${tool}`,
      changes: change.changes.map((c) => ({ field: c.field, old: c.old ?? null, new: c.new })),
    });
  try {
    return await run(tool, { api: deps.api, signIn: opened.signIn, rights: part.rights, audit }, input.data);
  } catch (error) {
    if (!isAtlassianError(error)) throw error;
    if (error.code === 'needs_sign_in')
      await deps.credentials.needsSignIn(part.credentialId, part.ownerUserId);
    return refused(error.message);
  }
}
