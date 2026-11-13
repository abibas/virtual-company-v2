import type { TenantDb } from '@mwc/db';
import type { AtlassianApi } from '@mwc/tools-core';
import type { Logger } from 'pino';
import type { ServerToolsHook, ServerToolsPlan, ServerToolTurn } from '../../../chats/index.ts';
import { credentialsForTools, type SecretDeps } from '../../../credentials/index.ts';
import type { TurnToolCall, TurnToolReply } from '../../../machines/index.ts';
import { type IntegrationsRepo, integrationsRepo } from '../../repo.ts';
import { offeredTools } from '../../rules/atlassian/rights.ts';
import { atlassianLabel, atlassianLine, toolDef } from '../../rules/atlassian/words.ts';
import { AtlassianTool } from '../../schemas/atlassian.ts';
import { callAtlassian } from './call.ts';

/**
 * The Atlassian tools as the chats module's `ServerToolsHook` (S7.1c): a message turn on a profile whose Atlassian part
 * has a sign-in gets the tools its rights give (only Jira's and Confluence's read tools, or with their changes and
 * writes), with one line for its standing instructions and the products they reach (`label`); each call is `call.ts`'s.
 * It never throws: a failure is logged and answered in words.
 */

export interface AtlassianToolsDeps extends SecretDeps {
  readonly logger: Logger;
  /** The Atlassian port (the connector, wired in `app.ts`). */
  readonly atlassian: AtlassianApi;
}

export const TOOL_FAILED = 'The tool could not be carried out on the server; nothing was changed.';

/** The tools a turn on this profile gets (see above). */
export async function atlassianToolsFor(
  repo: IntegrationsRepo,
  t: TenantDb,
  turn: { readonly profileId: string },
): Promise<ServerToolsPlan> {
  const part = await repo.atlassianPart(t, turn.profileId);
  if (part === undefined || part.credentialId === null) return { tools: [] };
  const tools = offeredTools(part.rights);
  if (tools.length === 0) return { tools: [] };
  return {
    tools: tools.map(toolDef),
    instructions: atlassianLine(part, part.rights, tools),
    label: atlassianLabel(tools),
  };
}

/** The hook on these deps. */
export function atlassianTools(deps: AtlassianToolsDeps): ServerToolsHook {
  const repo = integrationsRepo;
  const credentials = credentialsForTools(deps);
  const call = { api: deps.atlassian, credentials, repo };
  return {
    async toolsFor(t, turn) {
      try {
        return await atlassianToolsFor(repo, t, turn);
      } catch (error) {
        deps.logger.error(
          { err: error, profileId: turn.profileId },
          'integrations: could not offer the Atlassian tools',
        );
        return { tools: [] };
      }
    },
    owns: (tool) => AtlassianTool.safeParse(tool).success,
    async tool(t: TenantDb, turn: ServerToolTurn, toolCall: TurnToolCall): Promise<TurnToolReply> {
      try {
        return await callAtlassian(call, t, turn, toolCall);
      } catch (error) {
        deps.logger.error(
          { err: error, turnId: turn.turnId, tool: toolCall.tool },
          'integrations: an Atlassian tool failed',
        );
        return { ok: false, text: TOOL_FAILED };
      }
    },
  };
}
