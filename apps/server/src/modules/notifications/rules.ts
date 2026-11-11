import type { AgentStatus, MembershipRole, MembershipStatus, NotificationKind } from '@mwc/shared/enums';
import { RETRY_MAX_ATTEMPTS, retryDelayMs } from '../../platform/jobs/retry.ts';

/**
 * The notifications' pure rules (S2.9, docs/notifications.md): which notices a change makes and for whom, who is left
 * out (the actor, agents), and when a person's pending notices go out as one email.
 */

/** What a notice says, by principal id; names are read when it is shown, so they stay current. */
export interface NoticePayload {
  /** Whom the change is about. */
  readonly about: string;
  /** The manager before a move (null: at the top). */
  readonly from?: string | null;
  /** The manager after a move (null: at the top). */
  readonly to?: string | null;
  /** The role now (a role change, an accepted invitation). */
  readonly role?: MembershipRole;
  /** The role before a role change. */
  readonly previousRole?: MembershipRole;
  /** The task a task's notice is about (S5.3a); its key and title are read when it is shown. */
  readonly task?: string;
  /** The step a task's notice names, as it was called then. */
  readonly step?: string;
}

/** One notification to write: its kind, who gets it, and what it says. */
export interface Notice {
  readonly kind: NotificationKind;
  readonly recipient: string;
  readonly payload: NoticePayload;
}

/** A principal moved to another manager on the chart. */
export interface ChartMove {
  readonly principalId: string;
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * A move's notices: the moved principal learns their new manager, the old manager that they left (unless the old
 * manager is the one leaving the chart, `leaving`), the new manager that they joined. Nothing when nothing moved.
 */
export function chartMoveNotices(move: ChartMove, options: { readonly leaving?: boolean } = {}): Notice[] {
  if (move.from === move.to) return [];
  const payload = { about: move.principalId, from: move.from, to: move.to };
  const notices: Notice[] = [{ kind: 'manager_changed', recipient: move.principalId, payload }];
  if (move.from !== null && !options.leaving)
    notices.push({ kind: 'report_removed', recipient: move.from, payload });
  if (move.to !== null) notices.push({ kind: 'report_added', recipient: move.to, payload });
  return notices;
}

/** An agent's status change, with the manager it reported to before it (null: none). */
export interface AgentStatusChange {
  readonly principalId: string;
  readonly from: AgentStatus;
  readonly to: AgentStatus;
  readonly manager: string | null;
}

/** The kind of an agent's status change its manager hears of: paused, resumed or archived (a restore: none). */
export function agentStatusKind(from: AgentStatus, to: AgentStatus): NotificationKind | undefined {
  if (to === 'archived' && from !== 'archived') return 'agent_archived';
  if (from === 'active' && to === 'paused') return 'agent_paused';
  if (from === 'paused' && to === 'active') return 'agent_resumed';
  return undefined;
}

/** An agent's status notice, to the manager it reported to. */
export function agentStatusNotices(change: AgentStatusChange): Notice[] {
  const kind = agentStatusKind(change.from, change.to);
  if (kind === undefined || change.manager === null) return [];
  return [{ kind, recipient: change.manager, payload: { about: change.principalId } }];
}

/** A membership as a notice reads it. */
export interface MemberState {
  readonly principalId: string;
  readonly status: MembershipStatus;
  readonly role: MembershipRole;
}

/** The kind of a membership's status change the person hears of: suspended, back, or removed. */
function statusKind(before: MembershipStatus, after: MembershipStatus): NotificationKind | undefined {
  if (before === 'active' && after === 'suspended') return 'membership_suspended';
  if (before === 'suspended' && after === 'active') return 'membership_reactivated';
  if ((before === 'active' || before === 'suspended') && after === 'removed') return 'membership_removed';
  return undefined;
}

/**
 * A membership's notices: to the person when it is suspended, reactivated or removed, or their role changes while
 * active; to the inviter (`inviter`, when it came from an invitation someone here sent) when it starts.
 */
export function membershipNotices(
  before: Omit<MemberState, 'principalId'> | undefined,
  after: MemberState,
  inviter: string | null,
): Notice[] {
  const about = { about: after.principalId };
  if (before === undefined || before.status === 'invited') {
    if (after.status !== 'active' || inviter === null) return [];
    return [{ kind: 'invitation_accepted', recipient: inviter, payload: { ...about, role: after.role } }];
  }
  const kind = statusKind(before.status, after.status);
  if (kind) return [{ kind, recipient: after.principalId, payload: about }];
  if (before.status !== 'active' || after.status !== 'active' || before.role === after.role) return [];
  const payload = { ...about, role: after.role, previousRole: before.role };
  return [{ kind: 'role_changed', recipient: after.principalId, payload }];
}

/**
 * The notices to write: never to the actor about their own action, only to people (`people`: the recipients that are
 * a person; agents get none), each kind about the same principal (and task) once per recipient.
 */
export function deliverable(
  notices: readonly Notice[],
  actor: string | null,
  people: ReadonlySet<string>,
): Notice[] {
  const seen = new Set<string>();
  return notices.filter((notice) => {
    const key = `${notice.kind}:${notice.recipient}:${notice.payload.about}:${notice.payload.task ?? ''}`;
    if (notice.recipient === actor || !people.has(notice.recipient) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A batch waits this long after its newest notice: several moves within a minute become one email. */
export const EMAIL_QUIET_MS = 60_000;
/** ...but never longer than this after its oldest, however busy the chart is. */
export const EMAIL_MAX_WAIT_MS = 5 * 60_000;
/** Tries of one email before its notices are given up as `failed` (the jobs' retry policy: about a day). */
export const EMAIL_MAX_ATTEMPTS = RETRY_MAX_ATTEMPTS;

/** A pending notice as the batching reads it. */
export interface PendingEmail {
  readonly emailQueuedAt: Date | null;
  readonly emailNextAt: Date | null;
}

/**
 * True when a person's pending notices go out now: none waits for a retry, and the newest has been quiet for
 * `EMAIL_QUIET_MS` or the oldest has waited `EMAIL_MAX_WAIT_MS` (a notice not queued yet counts as queued now).
 */
export function batchReady(rows: readonly PendingEmail[], now: Date): boolean {
  if (rows.length === 0) return false;
  if (rows.some((row) => row.emailNextAt !== null && row.emailNextAt > now)) return false;
  const queued = rows.map((row) => (row.emailQueuedAt ?? now).getTime());
  return (
    Math.max(...queued) <= now.getTime() - EMAIL_QUIET_MS ||
    Math.min(...queued) <= now.getTime() - EMAIL_MAX_WAIT_MS
  );
}

/** After a failed try: the batch's tries so far, and either the next try's time or that it is given up. */
export function afterFailure(
  rows: readonly { readonly emailAttempts: number }[],
  now: Date,
): { readonly attempts: number; readonly nextAt: Date | null } {
  const attempts = Math.max(0, ...rows.map((row) => row.emailAttempts)) + 1;
  if (attempts >= EMAIL_MAX_ATTEMPTS) return { attempts, nextAt: null };
  return { attempts, nextAt: new Date(now.getTime() + retryDelayMs(attempts)) };
}
