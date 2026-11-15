import type { Chat, TenantDb } from '@mwc/db';
import type { ChatTurnKind } from '@mwc/shared/enums';
import { refuse } from '../rules.ts';
import { type DecisionsHook, withDecisionTool } from './decisions.ts';
import { type ServerToolsHook, serverToolsOf } from './server-tools.ts';
import type { Target } from './target.ts';
import { type TaskTurnDraft, type TaskTurnHook, toolsOf } from './task-hook.ts';

/**
 * What a turn's spec carries for its tools (split from `turns.ts`, T-17): the agents' tools, the decision log's and the
 * server's own, and why a spec that fails its schema is refused. A started turn, a queued one (`drain.ts`) and a turn
 * started again after a lost session (`session-lost.ts`) build theirs here.
 */

/** The hooks a turn's tools come from; each one left out gives a turn none of its tools. */
export interface SpecToolsDeps {
  /** The tasks module's side of a task's conversation (S5.3b); none: chats know nothing of tasks. */
  readonly tasks?: TaskTurnHook | undefined;
  /** The server's own tools (S7.1c, the Atlassian tools); none: a turn gets none. */
  readonly serverTools?: ServerToolsHook | undefined;
  /** The decision log (2026-11-14); none: a turn gets no `record_decision`. */
  readonly decisions?: DecisionsHook | undefined;
}

export const INVALID_SPEC = (paths: string) =>
  refuse(422, 'invalid_spec', `The agent's settings cannot start a turn (${paths}): fix them on the agent`);

/**
 * What a turn's spec adds for the tools when its runner offers them: the agents' tools' names (S6a) with the decision
 * log's (2026-11-14), the server's own tools of its profile (S7.1c) with, on a runner that takes it, the GitHub sign-in
 * for git and gh (S7.1d), and its instructions with each one's line.
 */
export async function specTools(
  deps: SpecToolsDeps,
  t: TenantDb,
  turn: {
    readonly chat: Chat;
    readonly target: Target;
    readonly kind: ChatTurnKind;
    readonly draft: TaskTurnDraft | undefined;
  },
) {
  const { target, kind } = turn;
  const tasks = await toolsOf(deps.tasks, t, {
    chat: turn.chat,
    agent: target.agent,
    kind,
    draft: turn.draft,
    offers: target.agentTools,
    known: target.agentToolNames,
    instructions: target.spec.instructions,
  });
  const decisions = { hook: deps.decisions, offers: target.decisions, kind };
  const agent = withDecisionTool(tasks, { ...decisions, instructions: target.spec.instructions });
  const instructions = agent.instructions ?? target.spec.instructions;
  const offers = target.serverTools;
  const git = target.github ? { chatId: turn.chat.id, agentId: target.agent.id, by: target.by } : undefined;
  const server = await serverToolsOf(deps.serverTools, t, {
    profileId: target.profileId,
    kind,
    offers,
    instructions,
    git,
    max: target.serverToolsMax,
  });
  return { ...agent, ...server };
}

/** Why a spec failed its schema: the paths of its issues, once each. */
export const specIssues = (error: {
  readonly issues: readonly { readonly path: readonly PropertyKey[] }[];
}) => [...new Set(error.issues.map((i) => i.path.join('.')))].join(', ');
