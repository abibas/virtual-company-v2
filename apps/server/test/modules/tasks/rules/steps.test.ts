import { FLOW_STEPS_MAX } from '@mwc/shared/flows';
import { describe, expect, it } from 'vitest';
import { planSteps, type StepInput } from '../../../../src/modules/tasks/rules/steps.ts';

const onChart = (id: string) => id !== 'gone';
const fresh = { existing: new Set<string>(), onChart };
const work = (name: string, extra: Partial<StepInput> = {}): StepInput => ({
  name,
  kind: 'work',
  assigneePrincipalId: 'dev',
  ...extra,
});
const check = (name: string, extra: Partial<StepInput> = {}): StepInput => ({
  name,
  kind: 'check',
  assigneePrincipalId: 'reviewer',
  ...extra,
});
const refusal = (items: StepInput[], context = fresh) => {
  const plan = planSteps(items, context);
  return plan.ok ? undefined : [plan.status, plan.code];
};

describe('planSteps', () => {
  it('plans the list in order with its defaults, targets as indexes and names trimmed', () => {
    const plan = planSteps(
      [
        work(' Develop '),
        check('Code review', { sendsBackTo: 'develop', sendBackLimit: 3, onReturn: 'fresh', starts: 'auto' }),
        { name: 'Approve', kind: 'signoff', assigneePrincipalId: 'ihor', sendsBackTo: 'Code review' },
      ],
      fresh,
    );
    expect(plan).toEqual({
      ok: true,
      removed: [],
      steps: [
        {
          id: undefined,
          position: 1,
          name: 'Develop',
          kind: 'work',
          assigneePrincipalId: 'dev',
          starts: 'manual',
          onReturn: 'keep',
          sendsBackTo: null,
          sendBackLimit: null,
        },
        expect.objectContaining({
          position: 2,
          starts: 'auto',
          onReturn: 'fresh',
          sendsBackTo: 0,
          sendBackLimit: 3,
        }),
        expect.objectContaining({ position: 3, kind: 'signoff', sendsBackTo: 1, sendBackLimit: null }),
      ],
    });
  });

  it('keeps the steps named by id, wherever they go, and removes the ones left out', () => {
    const context = { existing: new Set(['a', 'b', 'c']), onChart };
    const plan = planSteps([work('B', { id: 'b' }), work('New'), work('A', { id: 'a' })], context);
    expect(plan.ok && plan.steps.map((s) => [s.id, s.position])).toEqual([
      ['b', 1],
      [undefined, 2],
      ['a', 3],
    ]);
    expect(plan.ok && plan.removed).toEqual(['c']);
  });

  it('refuses an empty list, a long one, and two names alike whatever the case', () => {
    expect(refusal([])).toEqual([422, 'no_steps']);
    const many = Array.from({ length: FLOW_STEPS_MAX + 1 }, (_, i) => work(`S${i}`));
    expect(refusal(many)).toEqual([422, 'too_many_steps']);
    expect(refusal(many.slice(0, FLOW_STEPS_MAX))).toBeUndefined();
    expect(refusal([work('QA'), work(' qa')])).toEqual([422, 'duplicate_step_name']);
  });

  it('refuses an id of no step of this flow, or one id twice', () => {
    const context = { existing: new Set(['a']), onChart };
    expect(refusal([work('A', { id: 'z' })], context)).toEqual([422, 'unknown_step']);
    expect(refusal([work('A', { id: 'a' }), work('B', { id: 'a' })], context)).toEqual([422, 'unknown_step']);
  });

  it('refuses an assignee off the chart', () => {
    expect(refusal([work('A', { assigneePrincipalId: 'gone' })])).toEqual([422, 'assignee_not_found']);
  });

  it('refuses send-backs on Work steps, to a later or unknown step or itself, and a limit without a target', () => {
    expect(refusal([work('A'), work('B', { sendsBackTo: 'A' })])).toEqual([422, 'work_sends_back']);
    expect(refusal([work('A', { sendBackLimit: 1 })])).toEqual([422, 'work_sends_back']);
    expect(refusal([check('A', { sendsBackTo: 'B' }), work('B')])).toEqual([422, 'bad_send_back']);
    expect(refusal([check('A', { sendsBackTo: 'A' })])).toEqual([422, 'bad_send_back']);
    expect(refusal([work('A'), check('B', { sendsBackTo: 'Nowhere' })])).toEqual([422, 'bad_send_back']);
    expect(refusal([work('A'), check('B', { sendBackLimit: 2 })])).toEqual([422, 'bad_send_back']);
    expect(refusal([work('A'), check('B', { sendsBackTo: null, sendBackLimit: null })])).toBeUndefined();
  });
});
