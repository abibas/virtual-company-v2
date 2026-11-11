import type { MembershipRole } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  actRefusal,
  allowedActions,
  editRefusal,
  leadRefusal,
  leads,
  mayActAt,
} from '../../../../src/modules/tasks/rules/access.ts';
import type { StepRule, TaskNow } from '../../../../src/modules/tasks/rules.ts';

const team = { leadPeople: ['manager', 'ceo'] };
const who = (principalId: string, role: MembershipRole = 'member') => ({ principalId, role });
const review: StepRule = {
  id: 'review',
  position: 2,
  name: 'Code review',
  kind: 'check',
  assigneePrincipalId: 'tester',
  starts: 'manual',
  sendsBackToStepId: 'develop',
  sendBackLimit: 3,
};
const atReview: TaskNow = {
  state: 'active',
  currentStepId: 'review',
  stepState: 'waiting',
  rounds: {},
  escalationReason: null,
  escalationTargetStepId: null,
};

describe('who leads a team', () => {
  it('is its Lead people and the company’s admins and owners', () => {
    expect(leads(who('manager'), team)).toBe(true);
    expect(leads(who('ceo', 'viewer'), team)).toBe(true);
    expect(leads(who('anyone', 'admin'), team)).toBe(true);
    expect(leads(who('anyone', 'owner'), team)).toBe(true);
    expect(leads(who('anyone'), team)).toBe(false);
    expect(leadRefusal(who('anyone'), team)).toMatchObject({ status: 403, code: 'not_lead' });
    expect(leadRefusal(who('manager'), team)).toBeUndefined();
  });
});

describe('who moves a task', () => {
  it('at a step: its assignee, and whoever leads the team', () => {
    expect(mayActAt(who('tester'), team, review)).toBe(true);
    expect(mayActAt(who('manager'), team, review)).toBe(true);
    expect(mayActAt(who('anyone'), team, review)).toBe(false);
    expect(mayActAt(who('anyone'), team, undefined)).toBe(false);
    expect(actRefusal(who('anyone'), team, 'pass', review)).toMatchObject({
      status: 403,
      code: 'not_your_step',
    });
    expect(actRefusal(who('tester'), team, 'pass', review)).toBeUndefined();
  });

  it("the Lead's moves: only whoever leads the team, not the step's assignee", () => {
    for (const action of ['route', 'retry', 'cancel'] as const) {
      expect(actRefusal(who('tester'), team, action, review)).toMatchObject({ code: 'not_lead' });
      expect(actRefusal(who('manager'), team, action, review)).toBeUndefined();
    }
  });

  it('edits: its creator, and whoever leads the team', () => {
    expect(editRefusal(who('maker'), team, 'maker')).toBeUndefined();
    expect(editRefusal(who('manager'), team, 'maker')).toBeUndefined();
    expect(editRefusal(who('tester'), team, 'maker')).toMatchObject({ status: 403, code: 'not_yours' });
  });
});

describe('allowedActions', () => {
  it('lists the moves the task has and the caller may make', () => {
    expect(allowedActions(who('tester'), team, atReview, review)).toEqual(['start', 'pass', 'send_back']);
    expect(allowedActions(who('manager'), team, atReview, review)).toEqual([
      'start',
      'pass',
      'send_back',
      'route',
      'cancel',
    ]);
    expect(allowedActions(who('anyone'), team, atReview, review)).toEqual([]);
    const escalated = { ...atReview, state: 'escalated' as const, stepState: null, escalationReason: 'r' };
    expect(allowedActions(who('anyone', 'admin'), team, escalated, review)).toEqual([
      'route',
      'retry',
      'cancel',
    ]);
  });

  it('gives viewers none, even when they lead', () => {
    expect(allowedActions(who('ceo', 'viewer'), team, atReview, review)).toEqual([]);
  });
});
