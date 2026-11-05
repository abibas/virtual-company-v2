import type { Agent, Membership, OrgPosition } from '@mwc/db';
import type { MembershipRole } from '@mwc/shared/enums';
import { describe, expect, it } from 'vitest';
import type { ChartNode } from '../../../../src/modules/org/rules/chart.ts';
import {
  archiveMoves,
  chartRefusal,
  earliestOwner,
  moveRefusal,
  orgState,
  placeRefusal,
  positionChanges,
  positionRefusal,
} from '../../../../src/modules/org/rules/placement.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 10, minute));

const position = (principalId: string, reportsTo: string | null, title: string | null = null) =>
  ({ principalId, reportsToPrincipalId: reportsTo, title }) as OrgPosition;
const member = (principalId: string, role: MembershipRole, minute: number, id = principalId) =>
  ({ id, principalId, role, createdAt: at(minute) }) as Membership;
const agent = (principalId: string) => ({ principalId }) as Agent;

const person = (principalId: string, reportsTo: string | null): ChartNode => ({
  principalId,
  kind: 'person',
  reportsTo,
});
const bot = (principalId: string, reportsTo: string | null): ChartNode => ({
  principalId,
  kind: 'agent',
  reportsTo,
});

describe('orgState', () => {
  it('puts on the chart the positions of active members and live agents, in the positions’ order', () => {
    const state = orgState(
      [
        position('o', null),
        position('x', 'o'),
        position('a', 'o'),
        position('gone', 'o'),
        position('b', 'gone'),
      ],
      [member('o', 'owner', 0), member('x', 'member', 1)],
      [agent('a'), agent('b')],
    );
    expect(state.chart).toEqual([person('o', null), person('x', 'o'), bot('a', 'o'), bot('b', 'gone')]);
    expect(state.positions.get('gone')).toMatchObject({ reportsToPrincipalId: 'o' });
    expect([...state.members.keys()]).toEqual(['o', 'x']);
    expect([...state.agents.keys()]).toEqual(['a', 'b']);
  });
});

describe('earliestOwner', () => {
  it('is the active owner who joined first, by id on a tie; null without one', () => {
    expect(
      earliestOwner([member('m', 'admin', 0), member('late', 'owner', 9), member('first', 'owner', 3)]),
    ).toBe('first');
    expect(earliestOwner([member('b', 'owner', 3, 'id-b'), member('a', 'owner', 3, 'id-a')])).toBe('a');
    expect(earliestOwner([member('m', 'admin', 0)])).toBeNull();
  });
});

describe('the placement guards', () => {
  const chart = [person('o', null), bot('a', 'o'), bot('stray', 'gone')];

  it('refuse only the flaws a change adds, as 422s', () => {
    expect(chartRefusal(chart, [...chart, person('p', 'o')])).toBeUndefined();
    expect(chartRefusal(chart, [...chart, bot('b', null)])).toMatchObject({
      status: 422,
      code: 'agent_root',
    });
  });

  it('check a move and a new place with the org rules', () => {
    expect(moveRefusal(chart, 'a', 'o')).toBeUndefined();
    expect(moveRefusal(chart, 'a', 'a')).toMatchObject({ status: 422, code: 'self' });
    expect(placeRefusal(chart, bot('n', 'a'))).toBeUndefined();
    expect(placeRefusal(chart, bot('n', 'stray'))).toMatchObject({
      status: 422,
      code: 'chain_without_person',
    });
  });

  it('pass the moves of an archive that keep the chart as good as it was', () => {
    const moves = [{ principalId: 'n', reportsTo: 'o' }];
    expect(archiveMoves([...chart, bot('n', 'a')], 'a', moves)).toEqual({ ok: true, moves });
    expect(
      archiveMoves([...chart, bot('n', 'a')], 'a', [{ principalId: 'n', reportsTo: null }]),
    ).toMatchObject({
      status: 422,
      code: 'agent_root',
    });
  });
});

describe('positionRefusal', () => {
  it('lets admins and owners do anything, and members only title themselves', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(positionRefusal(role, { self: false, moves: true, titles: true })).toBeUndefined();
    }
    for (const role of ['member', 'viewer'] as const) {
      expect(positionRefusal(role, { self: true, moves: false, titles: true })).toBeUndefined();
      expect(positionRefusal(role, { self: true, moves: true, titles: false })).toMatchObject({
        status: 403,
      });
      expect(positionRefusal(role, { self: false, moves: false, titles: true })).toMatchObject({
        status: 403,
      });
    }
  });
});

describe('positionChanges', () => {
  it('keeps what differs, an empty title as none', () => {
    const stored = position('x', 'o', 'CTO');
    expect(positionChanges(stored, {})).toEqual({});
    expect(positionChanges(stored, { reportsTo: 'o', title: 'CTO' })).toEqual({});
    expect(positionChanges(stored, { reportsTo: null, title: '' })).toEqual({
      reportsToPrincipalId: null,
      title: null,
    });
    expect(positionChanges(position('x', 'o'), { title: '' })).toEqual({});
  });
});
