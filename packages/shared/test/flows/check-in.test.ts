import { describe, expect, it } from 'vitest';
import {
  durationWords,
  isStuck,
  LEAD_CHECK_IN_CLOSING,
  LEAD_WAKE_LISTED,
  type LeadCheckInTask,
  leadCheckInMessage,
} from '../../src/flows.ts';

const working = (n: number, turn: LeadCheckInTask['turn'], minutes = 4): LeadCheckInTask => ({
  task: { key: `T-${n}`, title: 'Fix the login' },
  state: 'active',
  step: 'Code review',
  stepState: 'working',
  minutes,
  turn,
  reason: null,
});

describe('a check-in’s digest', () => {
  it('lists each open task with its step, state, time and turn, the stuck ones first', () => {
    const blocked: LeadCheckInTask = {
      task: { key: 'T-2', title: 'Run the test task' },
      state: 'active',
      step: 'Develop',
      stepState: 'blocked',
      minutes: 12,
      turn: 'none',
      reason: 'Airia devbox had no free slot for 30 minutes (2 of 2 in use)',
    };
    const escalated: LeadCheckInTask = {
      task: { key: 'T-4', title: 'Ship it' },
      state: 'escalated',
      step: 'QA',
      stepState: null,
      minutes: 125,
      turn: 'none',
      reason: 'QA sent it back 3 times already, its limit',
    };
    const text = leadCheckInMessage({
      flow: 'DEVBOX delivery',
      tasks: [working(3, 'live'), escalated, working(5, 'none', 7), blocked, working(6, 'waiting', 0)],
    });
    expect(text).toBe(
      [
        'Most Wanted · DEVBOX delivery: check-in, 5 open tasks (2 stuck).',
        '',
        '- T-5 “Fix the login” · Code review · working 7 min · no turn (stuck)',
        '- T-2 “Run the test task” · Develop · blocked 12 min: Airia devbox had no free slot for 30 minutes (2 of 2 in use)',
        '- T-3 “Fix the login” · Code review · working 4 min · turn live',
        '- T-4 “Ship it” · QA · escalated 2 h 5 min: QA sent it back 3 times already, its limit',
        '- T-6 “Fix the login” · Code review · working under a minute · turn waiting to start',
        '',
        LEAD_CHECK_IN_CLOSING,
      ].join('\n'),
    );
  });

  it('says one open task and no stuck count when nothing is stuck; other states without a turn say none', () => {
    const waiting: LeadCheckInTask = { ...working(7, 'none'), stepState: 'needs_person', step: null };
    const text = leadCheckInMessage({ flow: 'F', tasks: [waiting] });
    expect(text.split('\n')[0]).toBe('Most Wanted · F: check-in, 1 open task.');
    expect(text).toContain('- T-7 “Fix the login” · waiting for a person 4 min\n');
    const unknown: LeadCheckInTask = { ...working(8, 'none'), stepState: null };
    expect(leadCheckInMessage({ flow: 'F', tasks: [unknown] })).toContain('· waiting to start 4 min\n');
  });

  it('lists ten and counts the rest; no tasks make no message', () => {
    const many = Array.from({ length: LEAD_WAKE_LISTED + 3 }, (_, i) => working(i + 1, 'live'));
    const text = leadCheckInMessage({ flow: 'F', tasks: many });
    expect(text.match(/^- T-/gm)).toHaveLength(LEAD_WAKE_LISTED);
    expect(text).toContain('- And 3 more tasks: team_board lists them.');
    expect(
      leadCheckInMessage({ flow: 'F', tasks: [{ ...working(1, 'live') }, ...many.slice(0, 10)] }),
    ).toContain('- And 1 more task: team_board lists them.');
    expect(leadCheckInMessage({ flow: 'F', tasks: [] })).toBe('');
  });

  it('tells it to end its turn rather than wait', () => {
    expect(LEAD_CHECK_IN_CLOSING).toContain('then end your turn: never wait for a step’s agent');
  });
});

describe('stuck and durations', () => {
  it('a blocked task, or one working with no turn, is stuck; a live or waiting turn is not', () => {
    expect(isStuck(working(1, 'none'))).toBe(true);
    expect(isStuck(working(1, 'live'))).toBe(false);
    expect(isStuck(working(1, 'waiting'))).toBe(false);
    expect(isStuck({ state: 'active', stepState: 'blocked', turn: 'none' })).toBe(true);
    expect(isStuck({ state: 'active', stepState: 'ended_without_handoff', turn: 'none' })).toBe(false);
    expect(isStuck({ state: 'escalated', stepState: null, turn: 'none' })).toBe(false);
  });

  it('words a duration', () => {
    expect(durationWords(0.5)).toBe('under a minute');
    expect(durationWords(-3)).toBe('under a minute');
    expect(durationWords(59)).toBe('59 min');
    expect(durationWords(60)).toBe('1 h');
    expect(durationWords(61)).toBe('1 h 1 min');
    expect(durationWords(24 * 60)).toBe('1 d');
    expect(durationWords(27 * 60 + 30)).toBe('1 d 3 h');
  });
});
