import { describe, expect, it } from 'vitest';
import {
  afterFailure,
  agentStatusKind,
  agentStatusNotices,
  batchReady,
  chartMoveNotices,
  deliverable,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_MAX_WAIT_MS,
  EMAIL_QUIET_MS,
  membershipNotices,
  type Notice,
} from '../../../src/modules/notifications/rules.ts';

const brief = (notices: readonly Notice[]) => notices.map((notice) => `${notice.recipient}:${notice.kind}`);

describe('chartMoveNotices', () => {
  it('tells the moved one, the old manager and the new one; nothing when nothing moved', () => {
    const notices = chartMoveNotices({ principalId: 'm', from: 'a', to: 'b' });
    expect(brief(notices)).toEqual(['m:manager_changed', 'a:report_removed', 'b:report_added']);
    expect(notices[0]?.payload).toEqual({ about: 'm', from: 'a', to: 'b' });
    expect(chartMoveNotices({ principalId: 'm', from: 'a', to: 'a' })).toEqual([]);
  });

  it('has no manager to tell at the top, and spares the one leaving the chart', () => {
    expect(brief(chartMoveNotices({ principalId: 'm', from: null, to: 'b' }))).toEqual([
      'm:manager_changed',
      'b:report_added',
    ]);
    expect(brief(chartMoveNotices({ principalId: 'm', from: 'a', to: null }))).toEqual([
      'm:manager_changed',
      'a:report_removed',
    ]);
    expect(brief(chartMoveNotices({ principalId: 'm', from: 'a', to: 'b' }, { leaving: true }))).toEqual([
      'm:manager_changed',
      'b:report_added',
    ]);
  });
});

describe('agentStatusNotices', () => {
  it('names a pause, a resume and an archive, and nothing else', () => {
    expect(agentStatusKind('active', 'paused')).toBe('agent_paused');
    expect(agentStatusKind('paused', 'active')).toBe('agent_resumed');
    expect(agentStatusKind('active', 'archived')).toBe('agent_archived');
    expect(agentStatusKind('paused', 'archived')).toBe('agent_archived');
    expect(agentStatusKind('archived', 'active')).toBeUndefined();
    expect(agentStatusKind('archived', 'archived')).toBeUndefined();
    expect(agentStatusKind('active', 'active')).toBeUndefined();
  });

  it('goes to the manager it reported to, when it had one', () => {
    expect(agentStatusNotices({ principalId: 'g', from: 'active', to: 'paused', manager: 'a' })).toEqual([
      { kind: 'agent_paused', recipient: 'a', payload: { about: 'g' } },
    ]);
    expect(agentStatusNotices({ principalId: 'g', from: 'active', to: 'paused', manager: null })).toEqual([]);
    expect(agentStatusNotices({ principalId: 'g', from: 'archived', to: 'active', manager: 'a' })).toEqual(
      [],
    );
  });
});

describe('membershipNotices', () => {
  const after = (status: 'active' | 'suspended' | 'removed' | 'invited', role = 'member' as const) => ({
    principalId: 'p',
    status,
    role,
  });

  it('tells the person of a suspension, a reactivation and a removal', () => {
    const active = { status: 'active', role: 'member' } as const;
    const suspended = { status: 'suspended', role: 'member' } as const;
    expect(brief(membershipNotices(active, after('suspended'), null))).toEqual(['p:membership_suspended']);
    expect(brief(membershipNotices(suspended, after('active'), null))).toEqual(['p:membership_reactivated']);
    expect(brief(membershipNotices(active, after('removed'), null))).toEqual(['p:membership_removed']);
    expect(brief(membershipNotices(suspended, after('removed'), null))).toEqual(['p:membership_removed']);
    expect(membershipNotices({ status: 'removed', role: 'member' }, after('removed'), null)).toEqual([]);
    expect(membershipNotices({ status: 'removed', role: 'member' }, after('active'), 'i')).toEqual([]);
  });

  it('tells the person of a role change while active, with both roles', () => {
    const notices = membershipNotices(
      { status: 'active', role: 'member' },
      after('active', 'admin' as never),
      null,
    );
    expect(notices).toEqual([
      {
        kind: 'role_changed',
        recipient: 'p',
        payload: { about: 'p', role: 'admin', previousRole: 'member' },
      },
    ]);
    expect(membershipNotices({ status: 'active', role: 'member' }, after('active'), null)).toEqual([]);
    expect(membershipNotices({ status: 'suspended', role: 'admin' }, after('suspended'), null)).toEqual([]);
  });

  it('tells the inviter when a membership starts, and nobody without one', () => {
    expect(membershipNotices(undefined, after('active'), 'i')).toEqual([
      { kind: 'invitation_accepted', recipient: 'i', payload: { about: 'p', role: 'member' } },
    ]);
    expect(brief(membershipNotices({ status: 'invited', role: 'member' }, after('active'), 'i'))).toEqual([
      'i:invitation_accepted',
    ]);
    expect(membershipNotices(undefined, after('active'), null)).toEqual([]);
    expect(membershipNotices(undefined, after('invited'), 'i')).toEqual([]);
  });
});

describe('deliverable', () => {
  const notice = (recipient: string, about = 'x'): Notice => ({
    kind: 'report_added',
    recipient,
    payload: { about },
  });

  it('leaves out the actor, agents and repeats', () => {
    const people = new Set(['a', 'b', 'actor']);
    const kept = deliverable(
      [notice('a'), notice('actor'), notice('agent'), notice('a'), notice('a', 'y'), notice('b')],
      'actor',
      people,
    );
    expect(kept.map((one) => `${one.recipient}:${one.payload.about}`)).toEqual(['a:x', 'a:y', 'b:x']);
    expect(deliverable([notice('actor')], null, people)).toHaveLength(1);
  });

  it('keeps one notice per task, so two tasks of one Lead both reach the person', () => {
    const done = (task: string): Notice => ({
      kind: 'task_done',
      recipient: 'a',
      payload: { about: 'lead', task },
    });
    const kept = deliverable([done('t1'), done('t2'), done('t1')], null, new Set(['a']));
    expect(kept.map((one) => one.payload.task)).toEqual(['t1', 't2']);
  });
});

describe('batchReady', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const row = (queued: Date | null, next: Date | null = null) => ({
    emailQueuedAt: queued,
    emailNextAt: next,
  });

  it('waits a quiet minute after the newest notice', () => {
    expect(batchReady([], now)).toBe(false);
    expect(batchReady([row(ago(EMAIL_QUIET_MS))], now)).toBe(true);
    expect(batchReady([row(ago(EMAIL_QUIET_MS - 1))], now)).toBe(false);
    expect(batchReady([row(ago(2 * EMAIL_QUIET_MS)), row(ago(1000))], now)).toBe(false);
    // A notice the loop has not seen yet counts as seen now.
    expect(batchReady([row(ago(2 * EMAIL_QUIET_MS)), row(null)], now)).toBe(false);
  });

  it('never waits longer than five minutes after the oldest, and waits for a retry', () => {
    expect(batchReady([row(ago(EMAIL_MAX_WAIT_MS)), row(ago(1000))], now)).toBe(true);
    expect(batchReady([row(ago(EMAIL_MAX_WAIT_MS), new Date(now.getTime() + 1))], now)).toBe(false);
    expect(batchReady([row(ago(EMAIL_MAX_WAIT_MS), now)], now)).toBe(true);
  });
});

describe('afterFailure', () => {
  const now = new Date('2026-11-10T12:00:00Z');

  it('counts the try from the batch’s most tried notice and backs off, then gives up', () => {
    expect(afterFailure([{ emailAttempts: 0 }], now)).toEqual({
      attempts: 1,
      nextAt: new Date(now.getTime() + 30_000),
    });
    expect(afterFailure([{ emailAttempts: 2 }, { emailAttempts: 0 }], now)).toEqual({
      attempts: 3,
      nextAt: new Date(now.getTime() + 120_000),
    });
    expect(afterFailure([{ emailAttempts: EMAIL_MAX_ATTEMPTS - 1 }], now)).toEqual({
      attempts: EMAIL_MAX_ATTEMPTS,
      nextAt: null,
    });
  });
});
