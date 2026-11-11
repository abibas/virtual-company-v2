import type { TaskDecision } from '@mwc/shared/flows';
import { describe, expect, it } from 'vitest';
import {
  actionWords,
  decidedBlock,
  decisionAnswer,
  decisionFailed,
  decisionInput,
  decisionNote,
  decisionOf,
  decisionRow,
  previewDecision,
  stepToolRefusal,
} from '../../../../src/modules/tasks/rules/decision.ts';
import type { StepRule, TaskNow } from '../../../../src/modules/tasks/rules.ts';

const step = (
  id: string,
  position: number,
  kind: StepRule['kind'],
  more: Partial<StepRule> = {},
): StepRule => ({
  id,
  position,
  name: id[0]?.toUpperCase() + id.slice(1),
  kind,
  assigneePrincipalId: `${id}-agent`,
  starts: 'auto',
  sendsBackToStepId: null,
  sendBackLimit: null,
  ...more,
});
const develop = step('develop', 1, 'work');
const review = step('review', 2, 'check', { sendsBackToStepId: 'develop', sendBackLimit: 1 });
const approve = step('approve', 3, 'signoff', { sendsBackToStepId: 'develop' });
const steps = [develop, review, approve];
const at = (stepId: string, rounds: TaskNow['rounds'] = {}): TaskNow => ({
  state: 'active',
  currentStepId: stepId,
  stepState: 'working',
  rounds,
  escalationReason: null,
  escalationTargetStepId: null,
});
const agents = () => false;

describe('a decision tool’s input', () => {
  it('says the action, its reason and its note', () => {
    expect(decisionInput('task_hand_on', { summary: 'Done' })).toEqual({
      action: 'hand_on',
      reason: null,
      note: 'Done',
    });
    expect(decisionInput('task_pass', {})).toEqual({ action: 'pass', reason: null, note: null });
    expect(decisionInput('task_approve', { note: 'Ship it' })).toEqual({
      action: 'approve',
      reason: null,
      note: 'Ship it',
    });
    expect(decisionInput('task_approve', {})).toMatchObject({ note: null });
    expect(decisionInput('task_send_back', { reason: 'Why', findings: 'What' })).toEqual({
      action: 'send_back',
      reason: 'Why',
      note: 'What',
    });
    expect(decisionInput('task_blocked', { reason: 'Stuck' })).toEqual({
      action: 'blocked',
      reason: 'Stuck',
      note: null,
    });
  });
});

describe('who may use a step’s tool', () => {
  const turn = { stepId: 'review', agentPrincipalId: 'review-agent' };
  it('the step’s agent while the task is at its step, with its kind’s moves', () => {
    expect(stepToolRefusal(at('review'), review, turn, 'task_pass')).toBeUndefined();
    expect(stepToolRefusal(at('review'), review, turn, 'task_attach')).toBeUndefined();
    expect(stepToolRefusal(at('develop'), review, turn, 'task_pass')).toMatchObject({
      status: 409,
      code: 'task_moved',
    });
    expect(stepToolRefusal({ ...at('review'), state: 'done' }, review, turn, 'task_pass')).toMatchObject({
      code: 'task_moved',
    });
    expect(stepToolRefusal(at('review'), undefined, turn, 'task_pass')).toMatchObject({
      code: 'not_your_step',
    });
    expect(
      stepToolRefusal(at('review'), { ...review, assigneePrincipalId: 'x' }, turn, 'task_pass'),
    ).toMatchObject({
      status: 403,
      code: 'not_your_step',
    });
    expect(stepToolRefusal(at('review'), review, turn, 'task_approve')).toMatchObject({
      status: 422,
      code: 'wrong_kind',
      message: 'task_approve is not a move of "Review", a check step: use task_pass or task_send_back.',
    });
  });
});

describe('what a decision makes', () => {
  it('forward, done after the last step, back for another round, escalated over the limit, blocked', () => {
    const hand = { action: 'hand_on', reason: null, note: 'x' } as const;
    expect(previewDecision(at('develop'), steps, hand, agents)).toEqual({ outcome: 'moved', to: review });
    const yes = { action: 'approve', reason: null, note: null } as const;
    expect(previewDecision(at('approve'), steps, yes, agents)).toEqual({ outcome: 'done', to: null });
    const back = { action: 'send_back', reason: 'Why', note: 'What' } as const;
    expect(previewDecision(at('review'), steps, back, agents)).toEqual({ outcome: 'moved', to: develop });
    const over = at('review', { review: { entries: 2, sendBacks: 1 } });
    expect(previewDecision(over, steps, back, agents)).toEqual({ outcome: 'escalated', to: develop });
    const block = { action: 'blocked', reason: 'Stuck', note: null } as const;
    expect(previewDecision(at('develop'), steps, block, agents)).toEqual({ outcome: 'blocked', to: null });
    const lost = [develop, { ...review, sendsBackToStepId: 'gone' }];
    expect(previewDecision(at('review'), lost, back, agents)).toMatchObject({
      ok: false,
      code: 'no_send_back_target',
    });
  });

  it('the answer says what was recorded, what it makes, a replaced decision first', () => {
    const context = { task: at('review'), step: review, lead: 'DEVBOX Coordinator' };
    const back = { action: 'send_back', reason: 'Why', note: 'What' } as const;
    expect(decisionAnswer(context, back, { outcome: 'moved', to: develop }, null)).toBe(
      'Recorded: when your turn ends the task goes back to "Develop" for round 1. End your turn now.',
    );
    expect(decisionAnswer(context, back, { outcome: 'escalated', to: develop }, 'pass')).toBe(
      'This replaces your earlier decision (pass). Recorded: "Review" has sent this task back once already, its ' +
        "limit, so when your turn ends it is escalated to the team's Lead (DEVBOX Coordinator) instead of going " +
        'back to "Develop". End your turn now.',
    );
    const yes = { action: 'approve', reason: null, note: null } as const;
    expect(decisionAnswer(context, yes, { outcome: 'done', to: null }, null)).toBe(
      'Recorded: when your turn ends the task is done. End your turn now.',
    );
    expect(decisionAnswer(context, yes, { outcome: 'escalated', to: null }, null)).toContain(
      '(DEVBOX Coordinator).',
    );
    const pass = { action: 'pass', reason: null, note: null } as const;
    expect(decisionAnswer(context, pass, { outcome: 'moved', to: null }, null)).toContain(
      'goes to "the next step"',
    );
    expect(actionWords('send_back')).toBe('send back');
  });
});

describe('a decision kept and applied', () => {
  const now = new Date('2026-11-11T10:00:00.000Z');
  const turn = { turnId: 't1', chatId: 'c1', stepId: 'review', round: 2 };
  const back = { action: 'send_back', reason: 'Why', note: 'What' } as const;
  const row: TaskDecision = decisionRow(turn, 'review-agent', back, { outcome: 'moved', to: develop }, now);

  it('is kept with its turn, and only its own turn finds it', () => {
    expect(row).toEqual({
      turnId: 't1',
      chatId: 'c1',
      stepId: 'review',
      round: 2,
      action: 'send_back',
      reason: 'Why',
      note: 'What',
      by: 'review-agent',
      at: '2026-11-11T10:00:00.000Z',
      outcome: 'moved',
      toStepId: 'develop',
      toStepName: 'Develop',
    });
    expect(decisionOf({ decision: row }, 't1')).toBe(row);
    expect(decisionOf({ decision: row }, 't2')).toBeUndefined();
    expect(decisionOf({ decision: null }, 't1')).toBeUndefined();
  });

  it('leaves its words as the hand-off note: a send-back’s reason first; a block keeps the reply', () => {
    expect(decisionNote(row)).toBe('**Sent back:** Why\n\nWhat');
    expect(decisionNote({ ...row, action: 'hand_on', reason: null, note: 'Summary' })).toBe('Summary');
    expect(decisionNote({ ...row, action: 'pass', reason: null, note: null })).toBeNull();
    expect(decisionNote({ ...row, action: 'blocked', note: null })).toBeNull();
  });

  it('blocks by the agent, or leaves the task for a person when it cannot be applied', () => {
    expect(decidedBlock(at('review', { review: { entries: 2, sendBacks: 0 } }), review, ' No repo ')).toEqual(
      {
        stepState: 'blocked',
        blockedReason: 'No repo',
        event: { kind: 'blocked', to: review, round: 2, reason: 'No repo' },
      },
    );
    expect(decidedBlock(at('develop'), review, 'x')).toBeUndefined();
    expect(decidedBlock(at('review'), review, 'y'.repeat(2500))?.blockedReason).toHaveLength(2000);
    expect(decisionFailed(at('review'), review, row, 'No such step')).toEqual({
      stepState: 'ended_without_handoff',
      blockedReason: null,
      event: {
        kind: 'turn_ended',
        system: true,
        to: review,
        round: 0,
        reason: "The agent's decision (send back) could not be applied: No such step",
      },
    });
  });
});
