import { describe, expect, it } from 'vitest';
import {
  arrivalOf,
  blocked,
  conversationTitle,
  noteBytes,
  previousEntryAt,
  replyStarted,
  skipWords,
  turnEnded,
} from '../../../../src/modules/tasks/rules/runs.ts';
import type { StepRule, TaskNow } from '../../../../src/modules/tasks/rules.ts';

const develop: StepRule = {
  id: 'dev',
  position: 1,
  name: 'Develop',
  kind: 'work',
  assigneePrincipalId: 'developer',
  starts: 'auto',
  sendsBackToStepId: null,
  sendBackLimit: null,
};
const at = (stepState: TaskNow['stepState'], overrides: Partial<TaskNow> = {}): TaskNow => ({
  state: 'active',
  currentStepId: 'dev',
  stepState,
  rounds: { dev: { entries: 2, sendBacks: 0 } },
  escalationReason: null,
  escalationTargetStepId: null,
  ...overrides,
});
const row = (kind: string, toStepId: string | null, extra: Record<string, unknown> = {}) => ({
  kind: kind as never,
  toStepId,
  fromStepId: null,
  fromStepName: null,
  reason: null,
  createdAt: new Date(0),
  ...extra,
});

describe('arrivalOf', () => {
  it('reads the history row that brought the task to the step this time', () => {
    const history = [
      row('routed', 'dev'),
      row('entered', 'dev'),
      row('handed_on', 'cr', { fromStepId: 'dev', fromStepName: 'Develop' }),
      row('sent_back', 'dev', { fromStepId: 'cr', fromStepName: 'Code review', reason: 'Tests fail' }),
      row('entered', 'dev'),
    ];
    expect(arrivalOf(history, 'dev')).toEqual({
      kind: 'sent_back',
      from: 'Code review',
      fromStepId: 'cr',
      reason: 'Tests fail',
    });
    expect(arrivalOf(history, 'cr')).toMatchObject({ kind: 'handed_on', from: 'Develop' });
  });

  it('calls a first entry from the queue new, and a route with a reason or from a step a route', () => {
    expect(arrivalOf([row('routed', 'dev')], 'dev')).toEqual({
      kind: 'new',
      from: null,
      fromStepId: null,
      reason: null,
    });
    expect(arrivalOf([], 'dev').kind).toBe('new');
    expect(arrivalOf([row('routed', 'dev', { reason: 'Skip triage' })], 'dev')).toMatchObject({
      kind: 'routed',
      reason: 'Skip triage',
    });
    expect(
      arrivalOf([row('retried', 'dev', { fromStepId: 'cr', fromStepName: 'Code review' })], 'dev').kind,
    ).toBe('retried');
  });
});

describe('previousEntryAt', () => {
  it('is when the task entered the step the time before, none on its first entry', () => {
    const first = row('entered', 'dev', { createdAt: new Date(1000) });
    const second = row('entered', 'dev', { createdAt: new Date(2000) });
    expect(previousEntryAt([first], 'dev')).toBeUndefined();
    expect(previousEntryAt([first, row('entered', 'cr'), second], 'dev')).toEqual(new Date(1000));
  });
});

describe('what a run makes of the task', () => {
  it('blocks a task worked on at the step, with the reason cut to fit; nothing once it moved', () => {
    expect(blocked(at('working'), develop, 'machine_offline')).toEqual({
      stepState: 'blocked',
      blockedReason: 'machine_offline',
      event: { kind: 'blocked', system: true, to: develop, round: 2, reason: 'machine_offline' },
    });
    expect(blocked(at('working'), develop, '  ')?.blockedReason).toBe('The turn failed');
    expect(blocked(at('working'), develop, 'x'.repeat(3000))?.blockedReason).toHaveLength(2000);
    expect(blocked(at('waiting'), develop, 'x')).toBeUndefined();
    expect(blocked(at('working', { currentStepId: 'cr' }), develop, 'x')).toBeUndefined();
    expect(blocked(at(null, { state: 'done', currentStepId: null }), develop, 'x')).toBeUndefined();
  });

  it('a turn’s end: failed blocks, done and stopped end without a hand-off', () => {
    expect(turnEnded(at('working'), develop, { status: 'failed', error: 'spawn_failed' })?.stepState).toBe(
      'blocked',
    );
    expect(turnEnded(at('working'), develop, { status: 'failed', error: null })?.blockedReason).toBe(
      'The turn failed',
    );
    expect(turnEnded(at('working'), develop, { status: 'done', error: null })).toEqual({
      stepState: 'ended_without_handoff',
      blockedReason: null,
      event: { kind: 'turn_ended', system: true, to: develop, round: 2, reason: undefined },
    });
    expect(turnEnded(at('working'), develop, { status: 'stopped', error: 'stopped' })?.event.reason).toBe(
      'The turn was stopped',
    );
    expect(turnEnded(at('blocked'), develop, { status: 'done', error: null })).toBeUndefined();
  });

  it('a reply works on a task that waits, ended or is blocked at the step; not one already worked on', () => {
    for (const state of ['waiting', 'blocked', 'ended_without_handoff'] as const)
      expect(replyStarted(at(state), develop)).toEqual({
        stepState: 'working',
        blockedReason: null,
        event: { kind: 'started', to: develop },
      });
    expect(replyStarted(at('working'), develop)).toBeUndefined();
    expect(replyStarted(at('waiting', { currentStepId: 'cr' }), develop)).toBeUndefined();
    expect(replyStarted(at(null, { state: 'escalated' }), develop)).toBeUndefined();
  });
});

describe('words', () => {
  it('titles a conversation by key, step and title, cut to a chat title', () => {
    expect(conversationTitle('T-12', 'Develop', 'Fix   the login')).toBe('T-12 · Develop · Fix the login');
    const long = conversationTitle('T-12', 'Develop', 'x'.repeat(100));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('says why a file was not collected', () => {
    expect(skipWords('too_many')).toBe('Not collected: over the 20 files a turn collects');
    expect(skipWords('total_limit')).toBe('Not collected: over the 10.0 MB a turn collects');
    expect(skipWords('unreadable')).toBe('Not collected: the runner could not read it');
  });
});

describe('noteBytes', () => {
  it('keeps a reply as UTF-8, cut to 2 MB on a character', () => {
    expect(new TextDecoder().decode(noteBytes('Done ✓'))).toBe('Done ✓');
    expect(noteBytes('a'.repeat(3 * 1024 * 1024))).toHaveLength(2 * 1024 * 1024);
    // "é" is two bytes: an odd cut would fall inside one, so the half character goes.
    const cut = noteBytes(`a${'é'.repeat(1024 * 1024)}`);
    expect(cut).toHaveLength(2 * 1024 * 1024 - 1);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(cut).endsWith('é')).toBe(true);
  });
});
