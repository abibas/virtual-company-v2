import type { TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import type { ChatTurnKind } from '@mwc/shared/enums';
import type { ServerToolDef } from '@mwc/shared/harness';
import type { TurnToolCall, TurnToolReply } from '../../machines/index.ts';

/**
 * The port of the server's own tools (S7.1c, docs/harness.md "Server tools"): tools the server defines and answers
 * whole, offered by the profile a turn runs on (the Atlassian tools by its Atlassian part's rights). The integrations
 * module implements it and `app.ts` passes it in, so the chats module knows nothing of Atlassian but this. A turn's spec
 * carries the tools only to a runner that says `caps.serverTools`, with a line for its standing instructions; their calls
 * come back through the turn's sink. Its methods never throw: they answer in words.
 */

/** A turn as a server tool's call sees it: the turn, its chat, the chat's agent, the profile it runs on, who sent it. */
export interface ServerToolTurn {
  readonly turnId: string;
  readonly chatId: string;
  readonly agentPrincipalId: string;
  readonly profileId: string | null;
  /** Who sent the turn's prompt. */
  readonly by: string;
}

/** What a turn gets of the server's tools: their definitions, and a line for its standing instructions. */
export interface ServerToolsPlan {
  readonly tools: readonly ServerToolDef[];
  readonly instructions?: string | undefined;
}

export interface ServerToolsHook {
  /** The tools a message turn on this profile gets (none when its profile gives none). */
  toolsFor(t: TenantDb, turn: { readonly profileId: string }): Promise<ServerToolsPlan>;
  /** True for a tool of its own, whose calls go to `tool`. */
  owns(tool: string): boolean;
  /** A call of one of them during the turn, checked again and answered. */
  tool(t: TenantDb, turn: ServerToolTurn, call: TurnToolCall): Promise<TurnToolReply>;
}

/**
 * What a turn's spec adds for the server's tools when its runner takes them (`offers`, `caps.serverTools`) and it is a
 * message turn: their definitions, and the standing instructions so far with the plan's line after them (left out when
 * it would not fit).
 */
export async function serverToolsOf(
  hook: ServerToolsHook | undefined,
  t: TenantDb,
  turn: {
    readonly profileId: string;
    readonly kind: ChatTurnKind;
    readonly offers: boolean;
    readonly instructions: string | undefined;
  },
): Promise<{ readonly serverTools?: ServerToolDef[]; readonly instructions?: string }> {
  if (!turn.offers || turn.kind !== 'message' || hook === undefined) return {};
  const plan = await hook.toolsFor(t, { profileId: turn.profileId });
  if (plan.tools.length === 0) return {};
  const joined = [turn.instructions, plan.instructions].filter((part) => part !== undefined).join('\n\n');
  const fits = plan.instructions !== undefined && joined.length <= STANDING_INSTRUCTIONS_MAX;
  return { serverTools: [...plan.tools], ...(fits ? { instructions: joined } : {}) };
}
