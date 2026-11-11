import { describe, expect, it } from 'vitest';
import { FlowStepKind, TaskAction, TaskEventKind, TaskState, TaskStepState } from '../src/enums.ts';
import { flowText, taskKey, taskNumber, type WrittenStep } from '../src/flows.ts';

describe('the flows’ enums', () => {
  it('lists the values the database CHECKs allow, re-exported by the enums', () => {
    expect(FlowStepKind.options).toEqual(['work', 'check', 'signoff']);
    expect(TaskState.options).toEqual(['queued', 'active', 'escalated', 'done', 'cancelled']);
    expect(TaskStepState.options).toEqual([
      'waiting',
      'working',
      'needs_person',
      'blocked',
      'ended_without_handoff',
    ]);
    expect(TaskEventKind.options).toHaveLength(13);
    expect(TaskAction.options).toEqual([
      'start',
      'hand_on',
      'pass',
      'approve',
      'send_back',
      'route',
      'retry',
      'cancel',
    ]);
  });
});

describe('taskKey and taskNumber', () => {
  it('write and read a task key in any case', () => {
    expect(taskKey(12)).toBe('T-12');
    expect(taskNumber('T-12')).toBe(12);
    expect(taskNumber(' t-3 ')).toBe(3);
  });

  it('read nothing that is not a key', () => {
    for (const key of ['T-0', 'T-012', 'T12', '12', 'T-', 'T-1234567890', 'X-1'])
      expect(taskNumber(key)).toBeUndefined();
  });
});

describe('flowText', () => {
  const step = (name: string, extra: Partial<WrittenStep>): WrittenStep => ({
    name,
    kind: 'work',
    who: name,
    whoKind: 'agent',
    onReturn: 'keep',
    sendsBackTo: null,
    sendBackLimit: null,
    ...extra,
  });

  it('writes the DEVBOX flow of docs/processes.md exactly', () => {
    const text = flowText({
      name: 'DEVBOX delivery',
      lead: 'DEVBOX Platform Coordinator',
      steps: [
        step('Develop', { who: 'Developer' }),
        step('Code review', {
          kind: 'check',
          who: 'Code Reviewer',
          sendsBackTo: 'Develop',
          sendBackLimit: 3,
        }),
        step('QA', { kind: 'check', who: 'QA', onReturn: 'fresh', sendsBackTo: 'Develop', sendBackLimit: 2 }),
        step('Approve', { kind: 'signoff', who: 'Ihor', whoKind: 'person', sendsBackTo: 'Develop' }),
      ],
    });
    expect(text).toBe(
      [
        'Flow: DEVBOX delivery · Lead: DEVBOX Platform Coordinator',
        '',
        'Step          Kind       Who             Comes back again   Sends back to   Limit',
        'Develop       Work       Developer       Keep               —               —',
        'Code review   Check      Code Reviewer   Keep               Develop         3 → Lead',
        'QA            Check      QA              Fresh              Develop         2 → Lead',
        'Approve       Sign-off   Ihor            —                  Develop         —',
        '→ Done',
        '',
      ].join('\n'),
    );
  });

  it('widens a column to its widest cell and never ends a line in spaces', () => {
    const text = flowText({
      name: 'F',
      lead: 'L',
      steps: [step('A very long step name indeed', { who: 'X', onReturn: 'fresh' })],
    });
    expect(text.split('\n')[2]).toBe(
      `${'Step'.padEnd(31)}Kind   Who   Comes back again   Sends back to   Limit`,
    );
    expect(text.split('\n').every((line) => line === line.trimEnd())).toBe(true);
  });
});
