import { describe, expect, it } from 'vitest';
import { move, type TaskNow, type Transition } from '../../../../src/modules/tasks/rules/machine.ts';
import type { StepRule } from '../../../../src/modules/tasks/rules.ts';

// The DEVBOX flow of docs/processes.md: Develop (an agent's, manual), Code review (limit 3), QA (a person's, limit 2,
// starts by itself), Approve (a person's sign-off), as the rules read them.
const step = (
  id: string,
  position: number,
  kind: StepRule['kind'],
  extra: Partial<StepRule> = {},
): StepRule => ({
  id,
  position,
  name: id,
  kind,
  assigneePrincipalId: `${id}-who`,
  starts: 'manual',
  sendsBackToStepId: null,
  sendBackLimit: null,
  ...extra,
});
const develop = step('develop', 1, 'work');
const review = step('review', 2, 'check', { sendsBackToStepId: 'develop', sendBackLimit: 3 });
const qa = step('qa', 3, 'check', { sendsBackToStepId: 'develop', sendBackLimit: 2, starts: 'auto' });
const approve = step('approve', 4, 'signoff', { sendsBackToStepId: 'develop' });
// Listed out of order on purpose: the rules follow `position`.
const steps = [approve, qa, develop, review];
const people = new Set(['qa-who', 'approve-who']);
const isPerson = (id: string) => people.has(id);

const queued: TaskNow = {
  state: 'queued',
  currentStepId: null,
  stepState: null,
  rounds: {},
  escalationReason: null,
  escalationTargetStepId: null,
};
const at = (stepId: string, extra: Partial<TaskNow> = {}): TaskNow => ({
  ...queued,
  state: 'active',
  currentStepId: stepId,
  stepState: 'waiting',
  rounds: { [stepId]: { entries: 1, sendBacks: 0 } },
  ...extra,
});
const ok = (result: ReturnType<typeof move>): Transition => {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
};
const kinds = (t: Transition) =>
  t.events.map((e) => [e.kind, e.from?.id ?? null, e.to?.id ?? null, e.system ?? false]);

describe('the forward moves', () => {
  it('hands a Work step on to the next step, waiting there when it starts by hand', () => {
    const t = ok(move(at('develop'), steps, { action: 'hand_on' }, isPerson));
    expect(t.task).toMatchObject({ state: 'active', currentStepId: 'review', stepState: 'waiting' });
    expect(t.task.rounds).toEqual({
      develop: { entries: 1, sendBacks: 0 },
      review: { entries: 1, sendBacks: 0 },
    });
    expect([t.outcome, t.entered?.id]).toEqual(['moved', 'review']);
    expect(kinds(t)).toEqual([
      ['handed_on', 'develop', 'review', false],
      ['entered', null, 'review', false],
    ]);
  });

  it('passes a Check into a step that starts by itself, with a system `started` row', () => {
    const t = ok(move(at('review'), steps, { action: 'pass' }, isPerson));
    expect(t.task).toMatchObject({ currentStepId: 'qa', stepState: 'working' });
    expect(kinds(t)).toEqual([
      ['passed', 'review', 'qa', false],
      ['entered', null, 'qa', false],
      ['started', null, 'qa', true],
    ]);
  });

  it("waits for a person's sign-off, and for an agent's like any step", () => {
    expect(ok(move(at('qa'), steps, { action: 'pass' }, isPerson)).task.stepState).toBe('needs_person');
    expect(ok(move(at('qa'), steps, { action: 'pass' }, () => false)).task.stepState).toBe('waiting');
  });

  it('closes the task after the last step’s approval, a pass or a hand-on', () => {
    const t = ok(move(at('approve', { stepState: 'needs_person' }), steps, { action: 'approve' }, isPerson));
    expect(t.task).toMatchObject({ state: 'done', currentStepId: null, stepState: null });
    expect([t.outcome, t.entered]).toEqual(['done', null]);
    expect(kinds(t)).toEqual([
      ['signed_off', 'approve', null, false],
      ['done', 'approve', null, false],
    ]);
    expect(ok(move(at('develop'), [develop], { action: 'hand_on' }, isPerson)).outcome).toBe('done');
    expect(ok(move(at('review'), [develop, review], { action: 'pass' }, isPerson)).outcome).toBe('done');
  });

  it('starts a waiting, blocked or stopped task, and only those', () => {
    for (const stepState of ['waiting', 'blocked', 'ended_without_handoff'] as const) {
      const t = ok(move(at('develop', { stepState }), steps, { action: 'start' }, isPerson));
      expect([t.task.stepState, t.outcome, kinds(t)]).toEqual([
        'working',
        'started',
        [['started', null, 'develop', false]],
      ]);
    }
    for (const stepState of ['working', 'needs_person'] as const) {
      expect(move(at('develop', { stepState }), steps, { action: 'start' }, isPerson)).toMatchObject({
        status: 409,
        code: 'wrong_state',
      });
    }
  });
});

describe('send-backs and their limit', () => {
  it('sends a task back to the step its step names, counting the send-back and the new round', () => {
    const task = at('review', {
      rounds: { develop: { entries: 1, sendBacks: 0 }, review: { entries: 1, sendBacks: 0 } },
    });
    const t = ok(move(task, steps, { action: 'send_back', reason: ' Tests fail ' }, isPerson));
    expect(t.task).toMatchObject({ currentStepId: 'develop', stepState: 'waiting' });
    expect(t.task.rounds).toEqual({
      develop: { entries: 2, sendBacks: 0 },
      review: { entries: 1, sendBacks: 1 },
    });
    expect(t.events[0]).toMatchObject({ kind: 'sent_back', reason: 'Tests fail' });
    expect(t.events[1]).toMatchObject({ kind: 'entered', round: 2 });
  });

  it('escalates to the Lead instead once the step sent it back as often as its limit', () => {
    const task = at('review', { rounds: { review: { entries: 4, sendBacks: 3 } } });
    const t = ok(move(task, steps, { action: 'send_back', reason: 'Still failing' }, isPerson));
    expect(t.task).toMatchObject({
      state: 'escalated',
      currentStepId: 'review',
      stepState: null,
      escalationTargetStepId: 'develop',
      escalationReason: 'review sent it back 3 times already, its limit; this time: Still failing',
    });
    expect(t.task.rounds).toEqual(task.rounds);
    expect([t.outcome, t.entered]).toEqual(['escalated', null]);
    expect(t.events).toEqual([
      expect.objectContaining({
        kind: 'escalated',
        reason: 'Still failing',
        details: { code: 'limit_reached', limit: 3, sendBacks: 3 },
      }),
    ]);
    const once = { ...qa, sendBackLimit: 1 };
    const qaTask = at('qa', { rounds: { qa: { entries: 2, sendBacks: 1 } } });
    const long = 'x'.repeat(3_000);
    const reason = ok(move(qaTask, [develop, once], { action: 'send_back', reason: long }, isPerson)).task
      .escalationReason as string;
    expect([reason.startsWith('qa sent it back once already'), reason.length, reason.endsWith('…')]).toEqual([
      true,
      2_000,
      true,
    ]);
  });

  it('has no limit when the step sets none', () => {
    const task = at('approve', { rounds: { approve: { entries: 50, sendBacks: 49 } } });
    expect(ok(move(task, steps, { action: 'send_back', reason: 'No' }, isPerson)).outcome).toBe('moved');
  });

  it('refuses a send-back without a reason, from a Work step, or from a step that names no target', () => {
    expect(move(at('review'), steps, { action: 'send_back', reason: '  ' }, isPerson)).toMatchObject({
      status: 422,
      code: 'reason_required',
    });
    expect(move(at('develop'), steps, { action: 'send_back', reason: 'x' }, isPerson)).toMatchObject({
      code: 'wrong_kind',
    });
    const lone = { ...review, sendsBackToStepId: null };
    expect(move(at('review'), [develop, lone], { action: 'send_back', reason: 'x' }, isPerson)).toMatchObject(
      {
        code: 'no_send_back_target',
      },
    );
    const gone = { ...review, sendsBackToStepId: 'removed' };
    expect(move(at('review'), [develop, gone], { action: 'send_back', reason: 'x' }, isPerson)).toMatchObject(
      {
        code: 'no_send_back_target',
      },
    );
  });
});

describe("the Lead's moves", () => {
  it('routes a queued, an active or an escalated task into any step', () => {
    const fromQueue = ok(
      move(queued, steps, { action: 'route', toStepId: 'qa', reason: 'urgent' }, isPerson),
    );
    expect(fromQueue.task).toMatchObject({ state: 'active', currentStepId: 'qa', stepState: 'working' });
    expect(kinds(fromQueue).slice(0, 2)).toEqual([
      ['routed', null, 'qa', false],
      ['entered', null, 'qa', false],
    ]);
    expect(fromQueue.events[0]?.reason).toBe('urgent');
    expect(
      ok(move(at('qa'), steps, { action: 'route', toStepId: 'develop' }, isPerson)).task.currentStepId,
    ).toBe('develop');
    const escalated = {
      ...at('review'),
      state: 'escalated' as const,
      stepState: null,
      escalationReason: 'r',
    };
    const rerouted = ok(move(escalated, steps, { action: 'route', toStepId: 'approve' }, isPerson));
    expect(rerouted.task).toMatchObject({
      state: 'active',
      currentStepId: 'approve',
      escalationReason: null,
    });
  });

  it('refuses a route without a step, to no step of the flow, or to the step an active task is at', () => {
    expect(move(queued, steps, { action: 'route' }, isPerson)).toMatchObject({
      status: 422,
      code: 'step_required',
    });
    expect(move(queued, steps, { action: 'route', toStepId: 'elsewhere' }, isPerson)).toMatchObject({
      code: 'unknown_step',
    });
    expect(move(at('qa'), steps, { action: 'route', toStepId: 'qa' }, isPerson)).toMatchObject({
      status: 409,
      code: 'already_at_step',
    });
  });

  it('retries an escalated task into the send-back it stopped, giving its step a fresh count', () => {
    const escalated: TaskNow = {
      ...at('review', {
        rounds: { develop: { entries: 4, sendBacks: 0 }, review: { entries: 4, sendBacks: 3 } },
      }),
      state: 'escalated',
      stepState: null,
      escalationReason: 'r',
      escalationTargetStepId: 'develop',
    };
    const t = ok(move(escalated, steps, { action: 'retry' }, isPerson));
    expect(t.task).toMatchObject({ state: 'active', currentStepId: 'develop', escalationTargetStepId: null });
    expect(t.task.rounds).toEqual({
      develop: { entries: 5, sendBacks: 0 },
      review: { entries: 4, sendBacks: 0 },
    });
    expect(kinds(t)[0]).toEqual(['retried', 'review', 'develop', false]);
    const noTarget = { ...escalated, escalationTargetStepId: null };
    expect(ok(move(noTarget, steps, { action: 'retry' }, isPerson)).task.currentStepId).toBe('review');
    expect(
      move({ ...noTarget, currentStepId: 'removed' }, steps, { action: 'retry' }, isPerson),
    ).toMatchObject({
      code: 'unknown_step',
    });
  });

  it('cancels a queued, active or escalated task, and nothing closed', () => {
    for (const task of [
      queued,
      at('qa'),
      { ...at('review'), state: 'escalated' as const, stepState: null },
    ]) {
      const t = ok(move(task, steps, { action: 'cancel', reason: 'dup' }, isPerson));
      expect([t.task.state, t.task.currentStepId, t.outcome, t.events[0]?.kind]).toEqual([
        'cancelled',
        null,
        'cancelled',
        'cancelled',
      ]);
    }
    for (const state of ['done', 'cancelled'] as const) {
      expect(move({ ...queued, state }, steps, { action: 'cancel' }, isPerson)).toMatchObject({
        code: 'wrong_state',
      });
    }
  });
});
