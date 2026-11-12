import { describe, expect, it } from 'vitest';
import {
  chatStanding,
  firstBy,
  reportOrder,
  type StandingTurn,
} from '../../../../src/modules/chats/rules/reports.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 12, 9, minute));

const turn = (seq: number, fields: Partial<StandingTurn> = {}): StandingTurn => ({
  id: `t${seq}`,
  chatId: 'c1',
  seq,
  kind: 'message',
  status: 'done',
  system: false,
  createdBy: 'me',
  createdAt: at(seq),
  startedAt: at(seq),
  endedAt: at(seq + 1),
  ...fields,
});

describe('firstBy', () => {
  it('keeps the first row of each key', () => {
    const rows = [
      { k: 'a', n: 1 },
      { k: 'b', n: 2 },
      { k: 'a', n: 3 },
    ];
    expect([...firstBy(rows, (r) => r.k).values()].map((r) => r.n)).toEqual([1, 2]);
  });
});

describe('chatStanding', () => {
  it('is empty for a chat without turns', () => {
    expect(chatStanding([], 'me')).toEqual({
      lastTurnId: null,
      lastTurn: null,
      working: false,
      replyAt: null,
      messageAt: null,
    });
  });

  it('reads the last turn, a running one, the latest reply and my latest message, in any order', () => {
    const turns = [
      turn(4, { status: 'queued', startedAt: null, endedAt: null }),
      turn(1),
      turn(3, { status: 'running', endedAt: null, createdBy: 'someone' }),
      turn(2, { kind: 'compact' }),
    ];
    expect(chatStanding(turns, 'me')).toEqual({
      lastTurnId: 't4',
      lastTurn: { status: 'queued', at: at(4) },
      working: true,
      replyAt: at(2),
      messageAt: at(4),
    });
  });

  it('dates a running last turn by its start, and leaves out a system message', () => {
    const turns = [turn(1), turn(2, { status: 'running', endedAt: null, system: true })];
    expect(chatStanding(turns, 'me')).toMatchObject({
      lastTurn: { status: 'running', at: at(2) },
      messageAt: at(1),
    });
  });
});

describe('reportOrder', () => {
  const r = (name: string, lead = false, id = name) => ({ name, lead, id });
  it('puts the Leads first, then sorts by name whatever the case, then by id', () => {
    const sorted = [r('beta'), r('Zed', true), r('Alpha'), r('alpha', false, 'a0')].sort(reportOrder);
    expect(sorted.map((x) => x.id)).toEqual(['Zed', 'a0', 'Alpha', 'beta']);
  });
});
