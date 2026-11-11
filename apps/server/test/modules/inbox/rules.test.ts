import { describe, expect, it } from 'vitest';
import {
  answersQuestions,
  byUrgency,
  KIND_RANK,
  lastMove,
  type Ranked,
  type StepLook,
  taskKind,
} from '../../../src/modules/inbox/rules.ts';

const ME = 'me';
const member = { principalId: ME, role: 'member' as const };
const mine = (kind: StepLook['kind']): StepLook => ({ kind, assigneePrincipalId: ME });
const theirs = (kind: StepLook['kind']): StepLook => ({ kind, assigneePrincipalId: 'agent' });
const active = (stepState: string) => ({ state: 'active', stepState });

describe('taskKind', () => {
  it("names the viewer's own step: a Sign-off, or another step, whatever its state", () => {
    expect(taskKind(member, active('needs_person'), mine('signoff'), [])).toBe('signoff');
    expect(taskKind(member, active('waiting'), mine('check'), [])).toBe('step');
    expect(taskKind(member, active('working'), mine('work'), [])).toBe('step');
  });

  it("gives the Lead's people escalated, blocked and ended tasks, and the step's own person a block or an end", () => {
    const escalated = { state: 'escalated', stepState: null };
    expect(taskKind(member, escalated, theirs('check'), [ME])).toBe('escalated');
    expect(taskKind(member, escalated, mine('check'), [])).toBeUndefined();
    expect(taskKind(member, active('blocked'), theirs('work'), [ME])).toBe('blocked');
    expect(taskKind(member, active('blocked'), mine('work'), [])).toBe('blocked');
    expect(taskKind(member, active('ended_without_handoff'), theirs('work'), [ME])).toBe('turn_ended');
    expect(taskKind(member, active('ended_without_handoff'), mine('work'), [])).toBe('turn_ended');
  });

  it("leaves out others' steps, queued and closed tasks, a task without its step, and viewers", () => {
    expect(taskKind(member, active('needs_person'), theirs('signoff'), [ME])).toBeUndefined();
    expect(taskKind(member, active('blocked'), theirs('work'), ['someone'])).toBeUndefined();
    expect(taskKind(member, { state: 'queued', stepState: null }, undefined, [ME])).toBeUndefined();
    expect(taskKind(member, { state: 'done', stepState: null }, mine('signoff'), [ME])).toBeUndefined();
    expect(taskKind(member, active('waiting'), undefined, [ME])).toBeUndefined();
    const viewer = { principalId: ME, role: 'viewer' as const };
    expect(taskKind(viewer, active('needs_person'), mine('signoff'), [ME])).toBeUndefined();
    expect(taskKind({ principalId: ME, role: 'owner' }, active('blocked'), theirs('work'), [ME])).toBe(
      'blocked',
    );
  });
});

describe('answersQuestions', () => {
  it('is for admins and owners, as the answers route', () => {
    expect(['owner', 'admin', 'member', 'viewer'].map((role) => answersQuestions(role as never))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('lastMove', () => {
  it('is the latest row that moved or stopped the task, past the rows that only follow a move', () => {
    const rows = [
      { kind: 'created', id: 1 },
      { kind: 'handed_on', id: 2 },
      { kind: 'entered', id: 3 },
      { kind: 'started', id: 4 },
      { kind: 'edited', id: 5 },
    ] as const;
    expect(lastMove(rows)?.id).toBe(2);
    expect(lastMove([...rows, { kind: 'blocked', id: 6 }])?.id).toBe(6);
    expect(lastMove([{ kind: 'entered' }])).toBeUndefined();
  });
});

describe('byUrgency', () => {
  it('puts the urgent first, then the kind, then the longest waiting; a question counts as normal', () => {
    const items: (Ranked & { name: string })[] = [
      { name: 'late sign-off', kind: 'signoff', priority: 'normal', at: '2026-11-11T10:05:00Z' },
      { name: 'blocked', kind: 'blocked', priority: 'normal', at: '2026-11-11T09:00:00Z' },
      { name: 'urgent end', kind: 'turn_ended', priority: 'urgent', at: '2026-11-11T11:00:00Z' },
      { name: 'question', kind: 'question', priority: null, at: '2026-11-11T08:00:00Z' },
      { name: 'early sign-off', kind: 'signoff', priority: 'normal', at: '2026-11-11T10:00:00Z' },
      { name: 'low step', kind: 'step', priority: 'low', at: '2026-11-11T07:00:00Z' },
    ];
    expect([...items].sort(byUrgency).map((item) => item.name)).toEqual([
      'urgent end',
      'early sign-off',
      'late sign-off',
      'question',
      'blocked',
      'low step',
    ]);
    expect(Object.keys(KIND_RANK)).toHaveLength(6);
  });
});
