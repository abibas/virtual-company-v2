import type { TenantDb } from '@mwc/db';
import type { SlackApi } from '@mwc/tools-core';
import type { Logger } from 'pino';
import type { ServerToolsHook, ServerToolsPlan } from '../../../chats/index.ts';
import { credentialsForTools, type SecretDeps } from '../../../credentials/index.ts';
import { type IntegrationsRepo, integrationsRepo } from '../../repo.ts';
import { offeredSlackTools } from '../../rules/slack/rights.ts';
import { SLACK_LABEL, slackLine, slackToolDef } from '../../rules/slack/words.ts';
import { SlackTool } from '../../schemas/slack.ts';
import { TOOL_FAILED } from '../reply.ts';
import { accessOf, callSlack } from './call.ts';

/**
 * The Slack tools as a `ServerToolsHook` (S7.1e): a message turn on a profile whose Slack part has a sign-in gets the
 * tools its rights give as its token's scopes let them work (`offeredSlackTools`), with one line for its standing
 * instructions. Each call is `call.ts`'s; the token never leaves the server. It never throws: a failure is logged and
 * answered in words.
 */

export interface SlackToolsDeps extends SecretDeps {
  readonly logger: Logger;
  /** The Slack port (the connector, wired in `app.ts`). */
  readonly slack: SlackApi;
}

/** The tools a turn on this profile gets (see above). */
export async function slackToolsFor(
  deps: { readonly repo: IntegrationsRepo },
  t: TenantDb,
  turn: { readonly profileId: string },
): Promise<ServerToolsPlan> {
  const part = await deps.repo.slackPart(t, turn.profileId);
  if (part === undefined || part.credentialId === null) return { tools: [] };
  const access = accessOf(part);
  const tools = offeredSlackTools(access);
  if (tools.length === 0) return { tools: [] };
  return { tools: tools.map(slackToolDef), instructions: slackLine(part, access, tools), label: SLACK_LABEL };
}

/** The hook on these deps. */
export function slackTools(deps: SlackToolsDeps): ServerToolsHook {
  const repo = integrationsRepo;
  const call = { api: deps.slack, credentials: credentialsForTools(deps), repo };
  return {
    async toolsFor(t, turn) {
      try {
        return await slackToolsFor({ repo }, t, turn);
      } catch (error) {
        deps.logger.error(
          { err: error, profileId: turn.profileId },
          'integrations: could not offer the Slack tools',
        );
        return { tools: [] };
      }
    },
    owns: (tool) => SlackTool.safeParse(tool).success,
    async tool(t, turn, toolCall) {
      try {
        return await callSlack(call, t, turn, toolCall);
      } catch (error) {
        deps.logger.error(
          { err: error, turnId: turn.turnId, tool: toolCall.tool },
          'integrations: a Slack tool failed',
        );
        return { ok: false, text: TOOL_FAILED };
      }
    },
  };
}
