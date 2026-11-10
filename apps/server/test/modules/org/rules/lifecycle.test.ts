import type { Agent, Membership, OrgPosition } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import {
  chartWithLeaver,
  earliestOwnerBut,
  joiningManager,
  leavingPlan,
} from '../../../../src/modules/org/rules/lifecycle.ts';
import { orgState } from '../../../../src/modules/org/rules/placement.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 10, minute));

const position = (principalId: string, reportsTo: string | null) =>
  ({ principalId, reportsToPrincipalId: reportsTo, title: null }) as OrgPosition;
const member = (principalId: string, role: MembershipRole, minute: number) =>
  ({ id: `m-${principalId}`, principalId, role, createdAt: at(minute) }) as Membership;
const agent = (principalId: string) => ({ principalId }) as Agent;

/**
 * Two owners (o1 joined first, at the top; o2 under o1), an admin under o1 with a member and an agent under them, the
 * agent with an agent of its own, and an agent under o2.
 */
const company = () =>
  orgState(
    [
      position('o1', null),
      position('o2', 'o1'),
      position('admin', 'o1'),
      position('m', 'admin'),
      position('a', 'admin'),
      position('a2', 'a'),
      position('b', 'o2'),
    ],
    [
      member('o1', 'owner', 0),
      member('o2', 'owner', 1),
      member('admin', 'admin', 2),
      member('m', 'member', 3),
    ],
    [agent('a'), agent('a2'), agent('b')],
  );

describe('earliestOwnerBut', () => {
  it('is the earliest active owner on the chart other than the person', () => {
    expect(earliestOwnerBut(company(), 'admin')).toBe('o1');
    expect(earliestOwnerBut(company(), 'o1')).toBe('o2');
  });

  it('skips an owner who is not on the chart, and is null when no other owner is', () => {
    const offChart = orgState(
      [position('o2', null)],
      [member('o1', 'owner', 0), member('o2', 'owner', 1)],
      [],
    );
    expect(earliestOwnerBut(offChart, 'x')).toBe('o2');
    expect(earliestOwnerBut(offChart, 'o2')).toBeNull();
  });
});

describe('joiningManager', () => {
  const by = (invitedBy: string | null, reportsTo: string | null = null) => ({ invitedBy, reportsTo });

  it('is the inviter when they are a person on the chart', () => {
    expect(joiningManager(company(), 'new', by('admin'))).toBe('admin');
    expect(joiningManager(company(), 'new', by('o2'))).toBe('o2');
  });

  it('falls back on the earliest other owner for an inviter who left, an agent, oneself or nobody', () => {
    expect(joiningManager(company(), 'new', by('gone'))).toBe('o1');
    expect(joiningManager(company(), 'new', by('a'))).toBe('o1');
    expect(joiningManager(company(), 'o1', by('o1'))).toBe('o2');
    expect(joiningManager(company(), 'new', by(null))).toBe('o1');
    expect(joiningManager(company(), 'new', undefined)).toBe('o1');
  });

  it("is the invitation's manager when that is still a person on the chart, ahead of the inviter", () => {
    expect(joiningManager(company(), 'new', by('o2', 'm'))).toBe('m');
    expect(joiningManager(company(), 'new', by(null, 'admin'))).toBe('admin');
  });

  it("falls back on the inviter's rule when the invitation's manager left, is an agent or is the newcomer", () => {
    expect(joiningManager(company(), 'new', by('admin', 'gone'))).toBe('admin');
    expect(joiningManager(company(), 'new', by('o2', 'a'))).toBe('o2');
    expect(joiningManager(company(), 'm', by(null, 'm'))).toBe('o1');
  });

  it('is the top when nobody else is there to report to (an owner added with no inviter)', () => {
    expect(joiningManager(orgState([], [member('first', 'owner', 0)], []), 'first', by(null))).toBeNull();
  });
});

describe('chartWithLeaver', () => {
  it('is the chart itself while the person is on it, or when they have no position', () => {
    const org = company();
    expect(chartWithLeaver(org, 'admin')).toBe(org.chart);
    expect(chartWithLeaver(org, 'nobody')).toBe(org.chart);
  });

  it('puts back a person whose membership ended already where their position is, in the positions’ order', () => {
    const left = orgState(
      [position('o1', null), position('admin', 'o1'), position('a', 'admin')],
      [member('o1', 'owner', 0)],
      [agent('a')],
    );
    expect(left.chart.map((node) => node.principalId)).toEqual(['o1', 'a']);
    expect(chartWithLeaver(left, 'admin')).toEqual([
      { principalId: 'o1', kind: 'person', reportsTo: null },
      { principalId: 'admin', kind: 'person', reportsTo: 'o1' },
      { principalId: 'a', kind: 'agent', reportsTo: 'admin' },
    ]);
  });
});

describe('leavingPlan', () => {
  it('moves a middle manager’s people and agents up to their manager, adding no flaw', () => {
    expect(leavingPlan(company(), 'admin')).toEqual({
      moves: [
        { principalId: 'm', reportsTo: 'o1' },
        { principalId: 'a', reportsTo: 'o1' },
      ],
      violations: [],
    });
  });

  it('moves a root owner’s people to the top and their agents to the earliest other owner', () => {
    expect(leavingPlan(company(), 'o1')).toEqual({
      moves: [
        { principalId: 'o2', reportsTo: null },
        { principalId: 'admin', reportsTo: null },
      ],
      violations: [],
    });
    const rootWithAgent = orgState(
      [position('o1', null), position('o2', 'o1'), position('a', 'o1')],
      [member('o1', 'owner', 0), member('o2', 'owner', 1)],
      [agent('a')],
    );
    expect(leavingPlan(rootWithAgent, 'o1').moves).toEqual([
      { principalId: 'o2', reportsTo: null },
      { principalId: 'a', reportsTo: 'o2' },
    ]);
  });

  it('works the same once the membership has ended (the person no longer on the chart)', () => {
    const left = orgState(
      [position('o1', null), position('admin', 'o1'), position('a', 'admin')],
      [member('o1', 'owner', 0)],
      [agent('a')],
    );
    expect(leavingPlan(left, 'admin')).toEqual({
      moves: [{ principalId: 'a', reportsTo: 'o1' }],
      violations: [],
    });
  });

  it('lists what the chart breaks afterwards when no other owner can take the agents', () => {
    const alone = orgState(
      [position('o', null), position('a', 'o')],
      [member('o', 'owner', 0)],
      [agent('a')],
    );
    expect(leavingPlan(alone, 'o')).toMatchObject({
      moves: [{ principalId: 'a', reportsTo: null }],
      violations: [{ code: 'agent_root', principalId: 'a' }],
    });
  });

  it('moves nobody for a person with no position', () => {
    expect(leavingPlan(company(), 'nobody')).toEqual({ moves: [], violations: [] });
  });
});
