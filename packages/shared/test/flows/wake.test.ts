import { describe, expect, it } from 'vitest';
import { LeadWakeKind, LeadWakeOutcome } from '../../src/enums.ts';
import {
  clipLine,
  LEAD_WAKE_DEFAULTS,
  LEAD_WAKE_LISTED,
  LEAD_WAKE_REASON_MAX,
  type LeadWakeItem,
  leadWakeMessage,
} from '../../src/flows.ts';

const task = (n: number, title = 'Fix the login') => ({ key: `T-${n}`, title });

const escalated: LeadWakeItem = {
  kind: 'escalated',
  task: task(12),
  step: 'Code review',
  reason: 'Code review sent it back 3 times already, its limit; this time: the tests still fail',
};
const ended: LeadWakeItem = { kind: 'turn_ended', task: task(14, 'Add SSO'), step: 'Develop', reason: null };

describe('the Lead wake-ups’ contract', () => {
  it('lists the kinds and outcomes the database CHECKs allow', () => {
    expect(LeadWakeKind.options).toEqual(['escalated', 'blocked', 'turn_ended', 'done', 'signoff_waiting']);
    expect(LeadWakeOutcome.options).toEqual(['pending', 'woke', 'capped', 'unreachable', 'dropped']);
  });

  it('wakes on escalations, blocks and ended turns by default, within a minute, six an hour', () => {
    expect(LEAD_WAKE_DEFAULTS).toEqual({
      escalated: true,
      blocked: true,
      turnEnded: true,
      done: false,
      signoffHours: null,
      windowSeconds: 60,
      maxPerHour: 6,
      maxPerDay: 40,
    });
  });

  it('folds whitespace and clips a line', () => {
    expect(clipLine('  two\n lines  ', 20)).toBe('two lines');
    expect(clipLine('abcdefghij', 5)).toBe('abcd…');
  });
});

describe('leadWakeMessage', () => {
  it('tells an escalation with its step, reason and the decision’s tools', () => {
    const text = leadWakeMessage({ flow: 'DEVBOX delivery', person: 'Ihor Herasko', events: [escalated] });
    expect(text).toBe(
      [
        'Most Wanted · DEVBOX delivery: 1 task needs your decision.',
        '',
        '- T-12 “Fix the login” was escalated to you from Code review: Code review sent it back 3 times already, ' +
          'its limit; this time: the tests still fail',
        '  Decide: task_retry / task_route / task_cancel, or ask Ihor Herasko (ask_user_question).',
        '',
        'Act with your tools now; team_board shows the whole board. Keep your reply to a line or two.',
      ].join('\n'),
    );
  });

  it('tells a turn that ended without a hand-off', () => {
    const text = leadWakeMessage({ flow: 'DEVBOX delivery', person: null, events: [ended] });
    expect(text).toContain('- T-14 “Add SSO”: its turn ended at Develop without a hand-off\n');
    expect(text).toContain(
      '  Decide: task_show, then task_start / task_route / task_cancel, or ask a person (ask_user_question).',
    );
  });

  it('tells a block, a sign-off’s wait and the done tasks as a digest', () => {
    const text = leadWakeMessage({
      flow: 'DEVBOX delivery',
      person: 'Ihor',
      events: [
        { kind: 'done', task: task(3, 'Docs'), step: null, reason: null },
        {
          kind: 'blocked',
          task: task(15),
          step: 'QA',
          reason: 'The agent’s machine has no connected runner',
        },
        { kind: 'done', task: task(4, 'Logo'), step: null, reason: null },
        {
          kind: 'signoff_waiting',
          task: task(16, 'Ship it'),
          step: 'Approve',
          reason: null,
          waiting: { who: 'Ihor', hours: 26 },
        },
      ],
    });
    expect(text.split('\n')[0]).toBe(
      'Most Wanted · DEVBOX delivery: 2 tasks need your decision; 2 tasks are done.',
    );
    expect(text).toContain(
      '- T-15 “Fix the login” is blocked at QA: The agent’s machine has no connected runner',
    );
    expect(text).toContain(
      '  Decide: fix the cause, then task_start; or task_route / task_cancel, or ask Ihor',
    );
    expect(text).toContain(
      '- T-16 “Ship it” has waited 26 h for Ihor’s sign-off at Approve'.replace('’', "'"),
    );
    expect(text).toContain('  Decide: remind them (ask_user_question), or leave it.');
    expect(text).toContain('- Done: T-3 “Docs”, T-4 “Logo”.');
  });

  it('says only the digest when everything is done', () => {
    const text = leadWakeMessage({
      flow: 'F',
      person: null,
      events: [{ kind: 'done', task: task(3, 'Docs'), step: null, reason: null }],
    });
    expect(text.split('\n')[0]).toBe('Most Wanted · F: 1 task is done.');
    expect(text).not.toContain('Decide');
  });

  it('clips a long reason and title, folds a reason’s lines, and tells a task’s repeated event once', () => {
    const long: LeadWakeItem = {
      kind: 'blocked',
      task: task(20, 'T'.repeat(200)),
      step: null,
      reason: `first\nsecond ${'x'.repeat(LEAD_WAKE_REASON_MAX)}`,
    };
    const text = leadWakeMessage({ flow: 'F', person: null, events: [ended, long, { ...ended }] });
    const line = text.split('\n').find((l) => l.startsWith('- T-20')) as string;
    expect(line).toContain(': first second x');
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(80 + LEAD_WAKE_REASON_MAX + 40);
    expect(line).toContain('is blocked: ');
    expect(text.match(/T-14/g)).toHaveLength(1);
  });

  it('lists ten tasks and counts the rest; a done digest still names one', () => {
    const events = Array.from(
      { length: LEAD_WAKE_LISTED + 3 },
      (_, i): LeadWakeItem => ({ ...ended, task: task(100 + i) }),
    );
    const done = [1, 2].map((n): LeadWakeItem => ({ kind: 'done', task: task(n), step: null, reason: null }));
    const text = leadWakeMessage({ flow: 'F', person: null, events: [...events, ...done] });
    expect(text.match(/^- T-1\d\d/gm)).toHaveLength(LEAD_WAKE_LISTED);
    expect(text).toContain('- Done: T-1 “Fix the login” and 1 more.');
    expect(text).toContain('- And 3 more tasks: read them with team_board.');
    expect(text.length).toBeLessThan(20_000);
  });

  it('is empty without events', () => {
    expect(leadWakeMessage({ flow: 'F', person: null, events: [] })).toBe('');
  });
});
