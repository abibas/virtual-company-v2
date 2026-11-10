import type { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it } from 'vitest';
import type { RunnerConnection } from '../../../../../../src/modules/machines/service/runner/connection.ts';
import { turnBoard } from '../../../../../../src/modules/machines/service/runner/hub/turns.ts';

/** A connection of `machineId` that sends nowhere. */
const connection = (machineId: string) =>
  ({ machineId, link: { send: () => {} } }) as unknown as RunnerConnection;
const sink = { events: () => {}, question: () => {}, end: () => {} };
const spec = {} as TurnSpec;

describe("the hub's turns", () => {
  it('count the turns running on a machine’s connections, until they end or their connection closes', () => {
    const board = turnBoard();
    const first = connection('m1');
    const second = connection('m1');
    const turnId = newId();
    board.start(first, { turnId, spec }, sink);
    board.start(first, { turnId: newId(), spec }, sink);
    board.start(second, { turnId: newId(), spec }, sink);
    board.start(connection('m2'), { turnId: newId(), spec }, sink);
    expect([board.count('m1'), board.count('m2'), board.count('m3')]).toEqual([3, 1, 0]);
    board.record(first, { type: 'turn.end', turnId, ok: true, exitCode: 0 });
    expect(board.count('m1')).toBe(2);
    board.drop(first);
    expect(board.count('m1')).toBe(1);
  });
});
