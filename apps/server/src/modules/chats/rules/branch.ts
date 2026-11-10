import type { ChatTurn } from '@mwc/db';
import { type BranchSupport, CHAT_TITLE } from '@mwc/shared/chats';
import type { TurnEvent } from '@mwc/shared/harness';
import { type Refusal, refuse } from '../rules.ts';

/**
 * Branching a conversation (docs/harness.md "Branching"): which replies may branch, where the branch's first turn
 * resumes the parent's session forked, and the branch's title. A reply is a finished message turn with a session; it is
 * the latest of its session when no later turn of the chat ran on that session. Claude Code forks from any reply (up
 * to its last message, `--resume-session-at`), unless the session was compacted after it or the reply was recorded
 * before message ids were; Codex forks a whole thread only, so only the latest reply. Pure.
 */

export const TURN_NOT_BRANCHABLE = refuse(
  409,
  'turn_not_branchable',
  "Only a finished reply of the agent can branch (not a running, waiting, compact or clear turn, nor one that didn't start a conversation)",
);

export const branchUnsupported = (reason: string) => refuse(409, 'branch_unsupported', reason);

export const BRANCH_PENDING = refuse(
  409,
  'branch_pending',
  "This branch hasn't forked its conversation yet: send it its first message, then open its terminal",
);

export const RUNNER_CANNOT_FORK = refuse(
  409,
  'runner_outdated',
  "The machine's runner is older than branching: update the runner to send this branch its first message",
);

/** Why only the latest reply can branch here. */
export const LATEST_ONLY = {
  codex:
    "Codex can't branch from an earlier reply: it forks a whole conversation, so branch from the latest reply",
  unrecorded:
    'This reply was recorded before branching from an earlier reply was possible: branch from the latest reply',
  compacted: 'The conversation was compacted after this reply: branch from a reply after the compaction',
  moved: 'The chat this branch came from went on since, so its reply can no longer be reached: branch again',
} as const;

export const branchLatestOnly = (why: string) => refuse(409, 'branch_latest_only', why);

/** A turn finished as a message: done, failed or stopped (a failed or stopped reply may still hold a conversation). */
export const isBranchable = (turn: Pick<ChatTurn, 'kind' | 'status'>): boolean =>
  turn.kind === 'message' &&
  (turn.status === 'done' || turn.status === 'failed' || turn.status === 'stopped');

/** One marker the facts read: a turn of the parent from the reply on, and one of its session, compact or result events. */
export interface BranchMarker {
  readonly turnId: string;
  readonly kind: ChatTurn['kind'];
  readonly event: TurnEvent;
}

/** What decides a branch from a reply: its session, its last message id, and what ran on that session after it. */
export interface BranchFacts {
  readonly sessionId: string | null;
  readonly messageId: string | undefined;
  /** No later turn ran on its session. */
  readonly latest: boolean;
  /** A later turn on its session compacted it (a Compact turn, or Claude Code's own compaction mid-turn). */
  readonly compactedAfter: boolean;
}

/** The facts of the reply `turnId` from the markers of its turn and the chat's later ones. */
export function branchFacts(markers: readonly BranchMarker[], turnId: string): BranchFacts {
  let sessionId: string | null = null;
  let messageId: string | undefined;
  for (const { turnId: id, event } of markers) {
    if (id !== turnId) continue;
    if (event.type === 'session' && sessionId === null) sessionId = event.sessionId;
    if (event.type === 'result') messageId = event.messageId;
  }
  const onSession = new Set(
    markers
      .filter((m) => m.turnId !== turnId && m.event.type === 'session' && m.event.sessionId === sessionId)
      .map((m) => m.turnId),
  );
  const compactedAfter = markers.some(
    (m) => onSession.has(m.turnId) && (m.kind === 'compact' || m.event.type === 'compact'),
  );
  return { sessionId, messageId, latest: onSession.size === 0, compactedAfter };
}

/** Where a branch from this reply resumes: the whole session (null) or up to a message, or why it cannot. */
export function branchPoint(
  support: BranchSupport,
  facts: BranchFacts,
): { readonly ok: true; readonly resumeAt: string | null } | Refusal<409> {
  if (typeof support === 'object') return branchUnsupported(support.unsupported);
  if (facts.latest) return { ok: true, resumeAt: null };
  if (support === 'latest') return branchLatestOnly(LATEST_ONLY.codex);
  if (facts.compactedAfter) return branchLatestOnly(LATEST_ONLY.compacted);
  if (facts.messageId === undefined) return branchLatestOnly(LATEST_ONLY.unrecorded);
  return { ok: true, resumeAt: facts.messageId };
}

const SUFFIX = ' (branch)';

/** The branch's title: the parent's, cut to fit, with " (branch)". */
export function branchTitle(parent: string | null): string {
  return `${(parent ?? 'Chat').slice(0, CHAT_TITLE.max - SUFFIX.length).trimEnd()}${SUFFIX}`;
}
