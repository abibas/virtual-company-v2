import { describe, expect, it } from 'vitest';
import { moveRefusal } from '../../../../src/modules/tasks/rules/moves.ts';
import type { StepRule, TaskNow } from '../../../../src/modules/tasks/rules.ts';

const step = (id: string, kind: StepRule['kind'], sendsBackToStepId: string | null = null): StepRule => ({
  id,
  position: 1,
  name: id,
  kind,
  assigneePrincipalId: 'who',
  starts: 'manual',
  sendsBackToStepId,
  sendBackLimit: null,
});
const develop = step('develop', 'work');
const review = step('review', 'check', 'develop');
const approve = step('approve', 'signoff', 'develop');
const queued: TaskNow = {
  state: 'queued',
  currentStepId: null,
  stepState: null,
  rounds: {},
  escalationReason: null,
  escalationTargetStepId: null,
};
const at = (stepId: string): TaskNow => ({
  ...queued,
  state: 'active',
  currentStepId: stepId,
  stepState: 'waiting',
});

describe('moveRefusal', () => {
  it('names the moves each step kind has', () => {
    expect(moveRefusal(at('develop'), develop, 'hand_on')).toBeUndefined();
    expect(moveRefusal(at('review'), review, 'pass')).toBeUndefined();
    expect(moveRefusal(at('review'), review, 'send_back')).toBeUndefined();
    expect(moveRefusal(at('approve'), approve, 'approve')).toBeUndefined();
    expect(moveRefusal(at('approve'), approve, 'send_back')).toBeUndefined();
    expect(moveRefusal(at('review'), review, 'approve')).toMatchObject({ status: 422, code: 'wrong_kind' });
    expect(moveRefusal(at('approve'), approve, 'pass')).toMatchObject({ code: 'wrong_kind' });
    expect(moveRefusal(at('develop'), develop, 'send_back')).toMatchObject({ code: 'wrong_kind' });
    expect(moveRefusal(at('review'), step('review', 'check'), 'send_back')).toMatchObject({
      code: 'no_send_back_target',
    });
  });

  it("refuses a step's move on a task at no step, and every move on a closed one", () => {
    expect(moveRefusal(at('develop'), undefined, 'hand_on')).toMatchObject({
      status: 409,
      code: 'wrong_state',
    });
    expect(moveRefusal(queued, undefined, 'start')).toMatchObject({ code: 'wrong_state' });
    expect(moveRefusal(queued, undefined, 'retry')).toMatchObject({ code: 'wrong_state' });
    expect(moveRefusal(queued, undefined, 'route')).toBeUndefined();
    for (const state of ['done', 'cancelled'] as const) {
      for (const action of ['cancel', 'route', 'retry', 'start', 'hand_on'] as const) {
        expect(moveRefusal({ ...queued, state }, undefined, action)).toMatchObject({ code: 'wrong_state' });
      }
    }
  });
});
