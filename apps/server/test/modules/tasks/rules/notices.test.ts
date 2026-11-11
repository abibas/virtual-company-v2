import { describe, expect, it } from 'vitest';
import {
  type MoveNoticeInput,
  moveNotices,
  runNotices,
} from '../../../../src/modules/tasks/rules/notices.ts';
import type { StepRule } from '../../../../src/modules/tasks/rules.ts';

const step = (name: string, kind: StepRule['kind'], assigneePrincipalId: string): StepRule => ({
  id: name,
  position: 1,
  name,
  kind,
  assigneePrincipalId,
  starts: 'manual',
  sendsBackToStepId: null,
  sendBackLimit: null,
});
const base: MoveNoticeInput = {
  taskId: 't1',
  lead: 'lead',
  leadPerson: 'manager',
  creator: 'maker',
  entered: null,
  outcome: 'moved',
  from: undefined,
};
const about = { about: 'lead', task: 't1' };

describe('moveNotices', () => {
  it('tells whoever the task came to: their step, or their sign-off', () => {
    expect(moveNotices({ ...base, entered: step('QA', 'check', 'tester') })).toEqual([
      { kind: 'task_at_step', recipient: 'tester', payload: { ...about, step: 'QA' } },
    ]);
    expect(moveNotices({ ...base, entered: step('Approve', 'signoff', 'ihor') })).toEqual([
      { kind: 'task_signoff', recipient: 'ihor', payload: { ...about, step: 'Approve' } },
    ]);
  });

  it("tells the Lead's nearest person of an escalation, naming the step it came from", () => {
    const from = step('Code review', 'check', 'reviewer');
    expect(moveNotices({ ...base, outcome: 'escalated', from })).toEqual([
      { kind: 'task_escalated', recipient: 'manager', payload: { ...about, step: 'Code review' } },
    ]);
    expect(moveNotices({ ...base, outcome: 'escalated' })).toEqual([
      { kind: 'task_escalated', recipient: 'manager', payload: about },
    ]);
    expect(moveNotices({ ...base, outcome: 'escalated', leadPerson: null })).toEqual([]);
  });

  it('tells its creator and the Lead’s nearest person that it is done', () => {
    expect(moveNotices({ ...base, outcome: 'done' })).toEqual([
      { kind: 'task_done', recipient: 'maker', payload: about },
      { kind: 'task_done', recipient: 'manager', payload: about },
    ]);
    expect(moveNotices({ ...base, outcome: 'done', leadPerson: null })).toHaveLength(1);
  });

  it('tells nobody of a start, a cancel or a move into nobody’s step', () => {
    expect(moveNotices({ ...base, outcome: 'started' })).toEqual([]);
    expect(moveNotices({ ...base, outcome: 'cancelled' })).toEqual([]);
  });
});

describe('runNotices (S5.3b)', () => {
  it('tells the Lead’s nearest person and the step’s assignee once each', () => {
    const develop = step('Develop', 'work', 'developer');
    const payload = { about: 'developer', task: 't1', step: 'Develop' };
    expect(
      runNotices({ taskId: 't1', leadPerson: 'manager', step: develop, kind: 'task_turn_ended' }),
    ).toEqual([
      { kind: 'task_turn_ended', recipient: 'manager', payload },
      { kind: 'task_turn_ended', recipient: 'developer', payload },
    ]);
    const own = step('QA', 'check', 'manager');
    expect(runNotices({ taskId: 't1', leadPerson: 'manager', step: own, kind: 'task_blocked' })).toHaveLength(
      1,
    );
    expect(runNotices({ taskId: 't1', leadPerson: null, step: develop, kind: 'task_blocked' })).toEqual([
      { kind: 'task_blocked', recipient: 'developer', payload },
    ]);
  });
});
