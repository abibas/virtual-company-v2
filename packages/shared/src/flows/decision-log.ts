import { z } from 'zod';
import { ASK_SERVER } from '../chats.ts';
import { DecisionOutcome } from './enums.ts';

/**
 * The decision log (2026-11-14, docs/processes.md "Decisions"): an agent records each real decision it makes (approve
 * or reject a review, accept or decline a request, choose between options that matter, refuse something) with the
 * `record_decision` tool, offered in every message turn of every agent whose runner knows it (`caps.decisions`): what
 * it decided, why, the sources it relied on and, when it says, the outcome. The server keeps it with the turn, the
 * chat, the agent and the task (`decisions`), and people read it in the chat, on the agent's page and on the task's.
 * The limits here are the tool's input check and the table's CHECKs.
 */

/** The tool's name, among the agents' tools (`flows/tools.ts`). */
export const DECISION_TOOL = 'record_decision';

/** Its call as each harness names it (Claude Code's, Codex's): the thread shows the decision's card in its place. */
export const DECISION_TOOL_CALLS = [
  `mcp__${ASK_SERVER}__${DECISION_TOOL}`,
  `mcp:${ASK_SERVER}/${DECISION_TOOL}`,
] as const;

/** How long each part may be, and how many sources a decision names. */
export const DECISION_LIMITS = {
  /** What it decided, in one line. */
  what: 200,
  /** Why. */
  why: 1000,
  /** The sources it relied on. */
  sources: 20,
  /** One source: a link, a Jira key, a file path. */
  source: 500,
} as const;

/** Whitespace folded to one space: `what` is one line. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ');

/** One source a decision relied on: a link or a reference, as the agent gives it. */
export const DecisionSource = z
  .string()
  .trim()
  .min(1)
  .max(DECISION_LIMITS.source)
  .describe('A link or reference you relied on: a PR or Slack URL, a Jira key, a file path');

/** The tool's input. The runner checks it before relaying the call, the server again before it stores it. */
export const RecordDecisionInput = z.object({
  what: z
    .string()
    .trim()
    .min(1)
    .max(DECISION_LIMITS.what)
    .transform(oneLine)
    .describe('What you decided, in one line'),
  why: z.string().trim().min(1).max(DECISION_LIMITS.why).describe('Why you decided it, in a few sentences'),
  sources: z
    .array(DecisionSource)
    .max(DECISION_LIMITS.sources)
    .optional()
    .describe('The links and references you relied on'),
  outcome: DecisionOutcome.optional().describe(
    'approved, rejected, done, declined, deferred or other, when one fits',
  ),
});
export type RecordDecisionInput = z.output<typeof RecordDecisionInput>;

/** The one line a turn's standing instructions get while its runner offers the tool. */
export const DECISION_LINE =
  'Call record_decision {what, why, sources?, outcome?} for every real decision you make (approving or rejecting a ' +
  'review, accepting or declining a request, choosing between options that matter, refusing something), never for ' +
  'routine steps.';

/** A recorded decision as the API, the chat's stream and the pages read it. */
export interface DecisionView {
  readonly id: string;
  readonly agentId: string;
  readonly chatId: string;
  readonly turnId: string;
  /** The task whose step the turn belonged to; null for any other turn. */
  readonly taskId: string | null;
  /** The contact the turn's conversation is with (a Slack chat's); null when none is known. */
  readonly contactId: string | null;
  readonly what: string;
  readonly why: string;
  readonly sources: readonly string[];
  readonly outcome: DecisionOutcome | null;
  /** The turn's last event stored when it was recorded: the thread shows it after that one; null: at the reply's end. */
  readonly eventSeq: number | null;
  /** ISO 8601. */
  readonly createdAt: string;
}
