import { describe, expect, it } from 'vitest';
import type { TaskDetail, TaskEvent } from '../../src/api/tasks.ts';
import { eventLine, movedText, standing } from '../../src/tasks/render.ts';

const event = (extra: Partial<TaskEvent>): TaskEvent => ({
  kind: 'started',
  actor: null,
  from: null,
  to: { name: 'QA' },
  round: null,
  reason: null,
  at: '2026-11-11T10:02:03.000Z',
  ...extra,
});

describe('eventLine', () => {
  it('says a step that started by itself, and an unknown kind as it is', () => {
    expect(eventLine(event({}))).toBe('2026-11-11 10:02  started QA by itself');
    expect(eventLine(event({ kind: 'paused', to: null }))).toBe('2026-11-11 10:02  paused');
  });
});

describe('standing and movedText', () => {
  const task = {
    key: 'T-1',
    state: 'active',
    step: { id: 's', name: 'QA', kind: 'check' },
    stepState: null,
    round: null,
    escalation: null,
  } as unknown as TaskDetail;

  it('fills what a task lacks with a dash or round 1', () => {
    expect(standing(task)).toBe('active at QA (-), round 1');
    expect(standing({ ...task, state: 'escalated', step: null })).toBe('escalated');
    expect(movedText({ outcome: 'escalated', task })).toBe('T-1: escalated to the Lead: \n');
  });
});
