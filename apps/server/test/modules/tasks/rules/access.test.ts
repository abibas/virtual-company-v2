import type { MembershipRole } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  actRefusal,
  allowedActions,
  editRefusal,
  intoStepRefusal,
  leadRefusal,
  leads,
  mayActAt,
} from '../../../../src/modules/tasks/rules/access.ts';
import type { StepRule, TaskNow } from '../../../../src/modules/tasks/rules.ts';

const team = { lead: 'lead-agent', leadPeople: ['manager', 'ceo'] };
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

describe('agents, through their tools (S6a)', () => {
  const leadAgent = { principalId: 'lead-agent', role: 'member' as const, agent: 'lead' as const };
  const otherLead = { ...leadAgent, principalId: 'other-lead' };
  const stepAgent = { principalId: 'tester', role: 'member' as const, agent: 'decision' as const };

  it('the Lead agent routes, starts, retries and cancels in its own flow, and puts new tasks into a step', () => {
    for (const action of ['route', 'start', 'retry', 'cancel'] as const) {
      expect(actRefusal(leadAgent, team, action, review)).toBeUndefined();
      expect(actRefusal(otherLead, team, action, review)).toMatchObject({ status: 403, code: 'not_lead' });
    }
    for (const action of ['hand_on', 'pass', 'approve', 'send_back'] as const)
      expect(actRefusal(leadAgent, team, action, review)).toMatchObject({ code: 'not_lead' });
    expect(intoStepRefusal(leadAgent, team)).toBeUndefined();
    expect(intoStepRefusal(otherLead, team)).toMatchObject({ code: 'not_lead' });
    expect(intoStepRefusal(who('manager'), team)).toBeUndefined();
    expect(intoStepRefusal(who('anyone'), team)).toMatchObject({ code: 'not_lead' });
  });

  it("a step's agent makes its step's moves on its own step only, never the Lead's", () => {
    expect(actRefusal(stepAgent, team, 'pass', review)).toBeUndefined();
    expect(actRefusal(stepAgent, team, 'send_back', review)).toBeUndefined();
    expect(actRefusal({ ...stepAgent, principalId: 'x' }, team, 'pass', review)).toMatchObject({
      code: 'not_your_step',
    });
    expect(actRefusal(stepAgent, team, 'pass', undefined)).toMatchObject({ code: 'not_your_step' });
    for (const action of ['start', 'route', 'cancel'] as const)
      expect(actRefusal(stepAgent, team, action, review)).toMatchObject({ code: 'not_your_step' });
  });

  it('never leads, changes the flow or edits a task, even its own', () => {
    expect(leads({ ...leadAgent, role: 'owner' }, team)).toBe(false);
    expect(leadRefusal(leadAgent, team)).toMatchObject({ code: 'not_lead' });
    expect(mayActAt(stepAgent, team, review)).toBe(false);
    expect(editRefusal(leadAgent, team, 'lead-agent')).toMatchObject({ code: 'not_yours' });
    expect(allowedActions(leadAgent, team, atReview, review)).toEqual(['start', 'route', 'cancel']);
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
