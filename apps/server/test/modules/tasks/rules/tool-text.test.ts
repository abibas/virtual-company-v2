import { describe, expect, it } from 'vitest';
import {
  attachedText,
  boardText,
  createdText,
  decisionText,
  movedText,
  taskText,
  whereText,
} from '../../../../src/modules/tasks/rules/tool-text.ts';
import type { BoardView } from '../../../../src/modules/tasks/schemas/board.ts';
import type { TaskDecisionView, TaskDetailView } from '../../../../src/modules/tasks/schemas/tasks.ts';

const agent = (name: string) => ({
  principalId: name,
  kind: 'agent' as const,
  name,
  slug: name.toLowerCase(),
});
const person = (name: string) => ({ principalId: name, kind: 'person' as const, name, slug: null });
const develop = { id: 's1', name: 'Develop', kind: 'work' as const };

const card = (key: string, more: Partial<BoardView['columns'][number]['cards'][number]> = {}) => ({
  id: key,
  key,
  title: `Task ${key}`,
  priority: 'normal' as const,
  round: null,
  stepState: null,
  blockedReason: null,
  assignee: null,
  stepId: null,
  artifacts: 0,
  leadNotifiedAt: null,
  updatedAt: '2026-11-11T10:00:00.000Z',
  ...more,
});

describe('the board in words', () => {
  it('names the flow, then each column with its cards', () => {
    const board: BoardView = {
      flow: { id: 'f', name: 'DEVBOX delivery', lead: agent('Coordinator') },
      columns: [
        { kind: 'queued', title: 'Queued', step: null, cards: [card('T-3', { priority: 'high' })], total: 1 },
        {
          kind: 'step',
          title: 'Develop',
          step: { id: 's1', kind: 'work', assignee: agent('Developer') },
          cards: [
            card('T-1', { stepState: 'working', round: 2 }),
            card('T-2', { stepState: 'blocked', blockedReason: 'No repo' }),
          ],
          total: 2,
        },
        { kind: 'done', title: 'Done', step: null, cards: [card('T-0')], total: 7 },
        { kind: 'escalated', title: 'Escalated', step: null, cards: [], total: 0 },
      ],
    };
    expect(boardText(board)).toBe(
      [
        'Flow "DEVBOX delivery" · Lead: Coordinator',
        '',
        'Queued (1)',
        '- T-3 · Task T-3 · high',
        '',
        'Develop · Work · Developer (2)',
        '- T-1 · Task T-1 · working · round 2',
        '- T-2 · Task T-2 · blocked · why: No repo',
        '',
        'Done (1 of 7)',
        '- T-0 · Task T-0',
        '',
        'Escalated (0)',
      ].join('\n'),
    );
  });
});

describe('a task in words', () => {
  const decision: TaskDecisionView = {
    action: 'hand_on',
    outcome: 'moved',
    to: { id: 's2', name: 'Code review' },
    reason: null,
    by: agent('Developer'),
    at: '2026-11-11T10:00:00.000Z',
  };

  it('says where it is and what its turn decided', () => {
    expect(
      whereText({ state: 'active', step: develop, stepState: 'ended_without_handoff', round: null }),
    ).toBe('active at "Develop" (its turn ended without a move)');
    expect(whereText({ state: 'escalated', step: develop, stepState: null, round: 2 })).toBe(
      'escalated to the team\'s Lead from "Develop"',
    );
    expect(whereText({ state: 'queued', step: null, stepState: null, round: null })).toBe('queued');
    expect(decisionText(decision)).toBe('Developer will hand on to "Code review"');
    expect(decisionText({ ...decision, outcome: 'done', action: 'approve', to: null })).toBe(
      'Developer will approve: the task is then done',
    );
    expect(decisionText({ ...decision, outcome: 'escalated', action: 'send_back' })).toBe(
      'Developer will send it back over the limit: it then goes to the Lead',
    );
    expect(
      decisionText({ ...decision, outcome: 'blocked', action: 'blocked', reason: 'No repo', to: null }),
    ).toBe('Developer will mark it blocked: No repo');
    expect(decisionText({ ...decision, to: null })).toBe('Developer will hand on to "the next step"');
  });

  it('shows its facts, description and latest history', () => {
    const task = {
      key: 'T-12',
      title: 'Fix the login',
      state: 'escalated',
      step: develop,
      stepState: null,
      round: 2,
      priority: 'high',
      assignee: agent('Coordinator'),
      createdBy: person('Ihor'),
      flow: { id: 'f', name: 'DEVBOX delivery', lead: agent('Coordinator') },
      blockedReason: 'No repo',
      escalation: { reason: 'Sent back 3 times', retryTo: develop },
      decision,
      artifacts: 2,
      conversations: [{}],
      description: '',
      history: [
        {
          id: 'e',
          kind: 'sent_back',
          actor: agent('Code Reviewer'),
          from: { id: 's2', name: 'Code review' },
          to: { id: 's1', name: 'Develop' },
          round: null,
          reason: 'Empty\npasswords',
          details: {},
          at: '2026-11-11T10:04:00.000Z',
        },
        {
          id: 'f',
          kind: 'created',
          actor: null,
          from: null,
          to: null,
          round: null,
          reason: null,
          details: {},
          at: '2026-11-11T10:00:00.000Z',
        },
      ],
    } as unknown as TaskDetailView;
    expect(taskText(task)).toBe(
      [
        '# T-12 · Fix the login',
        '',
        'State: escalated to the team\'s Lead from "Develop" · priority high',
        'Has it: Coordinator · flow DEVBOX delivery · made by Ihor',
        'Blocked: No repo',
        'Escalated: Sent back 3 times; a retry goes to "Develop"',
        'Decision in the running turn: Developer will hand on to "Code review"',
        'Artifacts: 2 · conversations: 1',
        '',
        '## Description',
        '',
        '(no description)',
        '',
        '## History (latest 2 of 2)',
        '',
        '- 2026-11-11 10:04 · sent back from "Code review" to "Develop" by Code Reviewer: Empty passwords',
        '- 2026-11-11 10:00 · created',
      ].join('\n'),
    );
    const plain = { ...task, assignee: null, escalation: { reason: 'x', retryTo: null }, decision: null };
    expect(taskText(plain as TaskDetailView)).toContain('Has it: nobody');
  });

  it('says what a move did, a task made and an artifact kept', () => {
    const summary = {
      key: 'T-1',
      title: 'Fix',
      state: 'active',
      step: develop,
      stepState: 'working',
      round: 1,
    };
    expect(movedText('moved', summary as never)).toBe(
      'Done: T-1 is now active at "Develop" (working), round 1.',
    );
    expect(movedText('done', summary as never)).toBe('Done: T-1 is done.');
    expect(movedText('cancelled', summary as never)).toBe('Done: T-1 is cancelled.');
    expect(createdText({ ...summary, state: 'queued', step: null } as never)).toBe(
      'Created T-1 "Fix": queued.',
    );
    expect(attachedText('Plan', 'note', { key: 'T-1', step: 'Develop', round: 1 })).toBe(
      'Attached "Plan" to T-1 (Develop, round 1) as a note.',
    );
  });
});
