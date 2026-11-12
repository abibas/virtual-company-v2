import type { ChartNode } from '@mwc/shared/org-chart';
import { describe, expect, it } from 'vitest';
import {
  capWords,
  mayWrite,
  movedLine,
  notAskedWords,
  overCap,
  recipients,
  roomMembers,
  stoppedLine,
} from '../../../../src/modules/tasks/rules/room.ts';

// The owner at the top; under the owner the manager and an outsider; under the manager the Lead agent; under the Lead
// two agents and a person; a step's person (the tester) sits under the owner.
const chart: ChartNode[] = [
  { principalId: 'owner', kind: 'person', reportsTo: null },
  { principalId: 'manager', kind: 'person', reportsTo: 'owner' },
  { principalId: 'outsider', kind: 'person', reportsTo: 'owner' },
  { principalId: 'tester', kind: 'person', reportsTo: 'owner' },
  { principalId: 'lead', kind: 'agent', reportsTo: 'manager' },
  { principalId: 'dev', kind: 'agent', reportsTo: 'lead' },
  { principalId: 'qa', kind: 'agent', reportsTo: 'lead' },
  { principalId: 'helper', kind: 'person', reportsTo: 'lead' },
];

describe('who is in a team room', () => {
  it('holds the Lead and the steps’ agents, the people who lead the team, those under the Lead and the steps’ people', () => {
    const members = roomMembers(chart, 'lead', ['dev', 'tester', 'dev', 'qa', 'owner', 'gone']);
    expect(members).toEqual({
      agents: ['lead', 'dev', 'qa'],
      people: ['manager', 'owner', 'helper', 'tester'],
    });
  });

  it('holds a person Lead among the people, and no agent off the chart', () => {
    expect(roomMembers(chart, 'manager', ['tester', 'archived-agent'])).toEqual({
      agents: [],
      people: ['manager', 'owner', 'helper', 'tester'],
    });
  });

  it('lets the team’s people (member and up) and the company’s admins and owners write', () => {
    const members = roomMembers(chart, 'lead', ['dev', 'tester']);
    expect(mayWrite({ principalId: 'tester', role: 'member' }, members)).toBe(true);
    expect(mayWrite({ principalId: 'helper', role: 'viewer' }, members)).toBe(false);
    expect(mayWrite({ principalId: 'outsider', role: 'member' }, members)).toBe(false);
    expect(mayWrite({ principalId: 'outsider', role: 'admin' }, members)).toBe(true);
    expect(mayWrite({ principalId: 'outsider', role: 'owner' }, members)).toBe(true);
  });
});

describe('whom a message asks, and the cap', () => {
  const agents = [
    { principalId: 'lead', name: 'Vega', slug: 'vega' },
    { principalId: 'dev', name: 'Developer', slug: 'developer' },
  ];

  it('asks every agent, or only those it names with "@"', () => {
    expect(recipients('Ship it?', agents)).toEqual(['lead', 'dev']);
    expect(recipients('@developer ship it?', agents)).toEqual(['dev']);
  });

  it('is over the cap only when the answers asked would pass it', () => {
    expect(overCap(28, 2, 30)).toBe(false);
    expect(overCap(29, 2, 30)).toBe(true);
    expect(overCap(30, 0, 30)).toBe(false);
  });

  it('says who was not asked and why', () => {
    expect(capWords(['Vega', 'Developer'], 30)).toBe(
      'Not asked: Vega, Developer. The room is at its 30 answers this hour.',
    );
    expect(notAskedWords([{ name: 'Vega', why: 'The agent is paused' }])).toBe(
      'Vega was not asked: The agent is paused',
    );
    expect(
      notAskedWords([
        { name: 'Vega', why: 'a' },
        { name: 'Developer', why: 'b' },
      ]),
    ).toBe('Not asked:\n- Vega: a\n- Developer: b');
  });
});

describe('a step’s end as a line', () => {
  const decision = (
    action: 'hand_on' | 'pass' | 'approve' | 'send_back',
    note: string | null,
    reason: string | null = null,
  ) => ({ action, note, reason, round: 2 }) as const;

  it('takes the move from the transition and the words from the decision, else the reply', () => {
    expect(
      movedLine(decision('hand_on', 'Three scripts'), 'Develop', { outcome: 'moved', to: 'Review' }, 'x'),
    ).toEqual({
      details: { action: 'hand_on', from: 'Develop', to: 'Review', round: 2 },
      words: 'Three scripts',
    });
    expect(movedLine(decision('pass', null), 'Review', { outcome: 'moved', to: 'QA' }, 'PASS\nok')).toEqual({
      details: { action: 'pass', from: 'Review', to: 'QA', round: 2 },
      words: 'PASS ok',
    });
    expect(movedLine(decision('approve', null), 'Approve', { outcome: 'done', to: 'Approve' }, null)).toEqual(
      {
        details: { action: 'approve', from: 'Approve', to: null, round: 2 },
        words: '',
      },
    );
  });

  it('says a send-back with its reason, and an escalation going to no step', () => {
    const back = decision('send_back', 'findings', 'Empty passwords pass');
    expect(movedLine(back, 'Review', { outcome: 'moved', to: 'Develop' }, null)).toEqual({
      details: { action: 'send_back', from: 'Review', to: 'Develop', round: 2 },
      words: 'Empty passwords pass',
    });
    expect(movedLine(back, 'Review', { outcome: 'escalated', to: 'Review' }, null).details).toEqual({
      action: 'escalated',
      from: 'Review',
      to: null,
      round: 2,
    });
  });

  it('says a step that stopped there with its words on one line', () => {
    expect(stoppedLine('turn_ended', 'Develop', 1, 'Looked.\nNothing yet.')).toEqual({
      details: { action: 'turn_ended', from: 'Develop', to: null, round: 1 },
      words: 'Looked. Nothing yet.',
    });
    expect(stoppedLine('blocked', 'Develop', 1, null).words).toBe('');
  });
});
