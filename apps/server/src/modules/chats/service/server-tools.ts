import type { Chat, TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import type { ChatTurnKind } from '@mwc/shared/enums';
import type { ServerToolDef, TurnGitHub } from '@mwc/shared/harness';
import type { RunnerHub, TurnToolCall, TurnToolReply } from '../../machines/index.ts';
import { chatsRepo } from '../repo.ts';

/**
 * The port of the server's own tools (S7.1c, docs/harness.md "Server tools"): tools the server defines and answers
 * whole, offered by the profile a turn runs on (the Atlassian tools by its Atlassian part's rights). The integrations
 * module implements it and `app.ts` passes it in, so the chats module knows nothing of Atlassian or GitHub but this. A
 * turn's spec carries the tools only to a runner that says `caps.serverTools`, with a line for its standing instructions;
 * their calls come back through the turn's sink. Since S7.1d a turn whose runner says `caps.github` also gets the
 * profile's GitHub sign-in for git and gh when its GitHub part may push (`TurnSpec.github`), opened by the hook for that
 * turn. Its methods never throw: they answer in words.
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

/**
 * Who a message turn's git sign-in is opened for (S7.1d): its chat, its agent and who sent its prompt. Given to
 * `toolsFor` only for a turn about to start on a runner that takes it (`caps.serverTools` and `caps.github`).
 */
export interface GitUse {
  readonly chatId: string;
  readonly agentId: string;
  readonly by: string;
}

/**
 * What a turn gets of the server's tools: their definitions, a line for its standing instructions, and what they are for
 * in a few words ("Jira and Confluence"), for a turn whose runner is too old to take them and the chat's notice; and
 * (S7.1d) the GitHub sign-in for git and gh, opened only when a `git` use was given and the profile may push, with what
 * pushing waits for when the runner cannot take it (`pushLabel`, present whenever the profile may push).
 */
export interface ServerToolsPlan {
  readonly tools: readonly ServerToolDef[];
  readonly instructions?: string | undefined;
  readonly label?: string | undefined;
  readonly github?: TurnGitHub | undefined;
  readonly pushLabel?: string | undefined;
}

/** What the tools are called when the plan does not say. */
export const SERVER_TOOLS_LABEL = 'Most Wanted tools';

/**
 * The line a message turn gets instead of the tools when its profile gives some but its runner is older than S7.1c (no
 * `caps.serverTools`): the access is configured, the tools are not on this machine, and what the person can do about it.
 */
export const runnerTooOldLine = (label: string): string =>
  `${label}: configured, but this machine's runner is too old to provide the tools, so you have none of them now; ` +
  'tell the person to update the runner on the Machines page.';

export interface ServerToolsHook {
  /** The tools a message turn on this profile gets (none when its profile gives none), and its git sign-in for `git`. */
  toolsFor(
    t: TenantDb,
    turn: { readonly profileId: string; readonly git?: GitUse },
  ): Promise<ServerToolsPlan>;
  /** True for a tool of its own, whose calls go to `tool`. */
  owns(tool: string): boolean;
  /** A call of one of them during the turn, checked again and answered. */
  tool(t: TenantDb, turn: ServerToolTurn, call: TurnToolCall): Promise<TurnToolReply>;
}

/** The standing instructions so far with a line after them, or nothing when there is no line or it would not fit. */
function withLine(
  instructions: string | undefined,
  line: string | undefined,
): { readonly instructions?: string } {
  if (line === undefined) return {};
  const joined = [instructions, line].filter((part) => part !== undefined).join('\n\n');
  return joined.length <= STANDING_INSTRUCTIONS_MAX ? { instructions: joined } : {};
}

/**
 * What a message turn's spec adds for the server's tools its profile gives. A runner that takes them (`offers`,
 * `caps.serverTools`) gets their definitions, and the standing instructions so far with the plan's line after them, and
 * (S7.1d) with `git` the GitHub sign-in for git and gh when the profile may push; an older one gets no tool, only
 * `runnerTooOldLine` after them, so the agent does not hunt for tools it was told it has. A line is left out when it
 * would not fit.
 */
export async function serverToolsOf(
  hook: ServerToolsHook | undefined,
  t: TenantDb,
  turn: {
    readonly profileId: string;
    readonly kind: ChatTurnKind;
    readonly offers: boolean;
    readonly instructions: string | undefined;
    /** Given when the runner takes a GitHub sign-in for git (`caps.github`). */
    readonly git?: GitUse | undefined;
  },
): Promise<{
  readonly serverTools?: ServerToolDef[];
  readonly instructions?: string;
  readonly github?: TurnGitHub;
}> {
  if (turn.kind !== 'message' || hook === undefined) return {};
  const git = turn.offers && turn.git !== undefined ? { git: turn.git } : {};
  const plan = await hook.toolsFor(t, { profileId: turn.profileId, ...git });
  if (plan.tools.length === 0) return {};
  if (!turn.offers) return withLine(turn.instructions, runnerTooOldLine(plan.label ?? SERVER_TOOLS_LABEL));
  return {
    serverTools: [...plan.tools],
    ...withLine(turn.instructions, plan.instructions),
    ...(plan.github === undefined ? {} : { github: plan.github }),
  };
}

/**
 * What the profile a chat runs on (its own, else its agent's) gives of the server's tools that its machine's runner is too
 * old to take, in a few words ("Jira and Confluence"; "git push" when only the GitHub sign-in for git waits, S7.1d), for
 * the chat's notice; null when it gives none, the runner takes them, or it is not connected here (nothing is known of it
 * then).
 */
export async function runnerUpdateFor(
  deps: { readonly hub: RunnerHub; readonly serverTools?: ServerToolsHook | undefined },
  t: TenantDb,
  chat: Pick<Chat, 'agentId' | 'machineId' | 'profileId'>,
): Promise<string | null> {
  const runner = deps.hub.connected(chat.machineId);
  const hook = deps.serverTools;
  if (hook === undefined || runner?.companyId !== t.companyId) return null;
  if (runner.caps.serverTools && runner.caps.github) return null;
  const profileId = chat.profileId ?? (await chatsRepo.agentOf(t, chat.agentId))?.profileId ?? null;
  if (profileId === null) return null;
  const plan = await hook.toolsFor(t, { profileId });
  if (plan.tools.length === 0) return null;
  return runner.caps.serverTools ? (plan.pushLabel ?? null) : (plan.label ?? SERVER_TOOLS_LABEL);
}
