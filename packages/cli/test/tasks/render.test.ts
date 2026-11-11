import { describe, expect, it } from 'vitest';
import type { TaskArtifact, TaskDetail, TaskEvent } from '../../src/api/tasks.ts';
import { artifactLine, eventLine, movedText, sizeText, standing, taskText } from '../../src/tasks/render.ts';

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

describe('a task’s run (S5.3b)', () => {
  const artifact = (extra: Partial<TaskArtifact>): TaskArtifact => ({
    id: 'a',
    step: { id: 's', name: 'Develop' },
    round: 1,
    name: 'notes.md',
    kind: 'file',
    contentType: 'text/markdown; charset=utf-8',
    size: 1229,
    note: null,
    updatedAt: '2026-11-11T10:02:03.000Z',
    ...extra,
  });

  it('says a blocked or ended turn by itself with its round, sizes and artifact lines', () => {
    expect(eventLine(event({ kind: 'blocked', round: 2, reason: 'machine_offline' }))).toBe(
      '2026-11-11 10:02  blocked QA (round 2) by itself: machine_offline',
    );
    expect(eventLine(event({ kind: 'turn_ended', round: 1 }))).toBe(
      '2026-11-11 10:02  turn ended QA (round 1) by itself',
    );
    expect([sizeText(340), sizeText(1229), sizeText(3 * 1024 * 1024)]).toEqual(['340 B', '1.2 KB', '3.0 MB']);
    expect(artifactLine(artifact({}))).toBe('Develop · round 1 · notes.md · file · 1.2 KB');
    expect(
      artifactLine(artifact({ kind: 'skipped', name: 'a.zip', size: 9, note: 'Not collected: binary' })),
    ).toBe('Develop · round 1 · a.zip · skipped, 9 B (Not collected: binary)');
  });

  it('ends a task with why it is blocked, its conversations and its artifacts', () => {
    const task = {
      key: 'T-1',
      title: 'Fix',
      flow: { id: 'f', name: 'Delivery', lead: { name: 'Lead' } },
      state: 'active',
      step: { id: 's', name: 'Develop', kind: 'work' },
      stepState: 'blocked',
      blockedReason: 'machine_offline',
      round: 2,
      priority: 'normal',
      assignee: { name: 'Developer' },
      createdBy: { name: 'Olga' },
      escalation: null,
      actions: ['start'],
      description: '',
      history: [],
      conversations: [
        {
          chatId: 'c1',
          step: { id: 's', name: 'Develop' },
          round: 1,
          agent: { name: 'Developer' },
          started: true,
        },
        { chatId: 'c2', step: { id: 's', name: 'Develop' }, round: 2, agent: null, started: false },
      ],
    } as unknown as TaskDetail;
    const lines = taskText(task, [artifact({})])
      .trimEnd()
      .split('\n');
    expect(lines).toContain('Blocked: machine_offline');
    expect(lines.slice(-7)).toEqual([
      '',
      'Conversations:',
      '  Develop · round 1 · Developer · chat c1',
      '  Develop · round 2 · chat c2 (not started)',
      '',
      'Artifacts:',
      '  Develop · round 1 · notes.md · file · 1.2 KB',
    ]);
  });
});
