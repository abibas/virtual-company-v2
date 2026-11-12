import type { TurnSpec } from '@mwc/shared/harness';
import { newId } from '@mwc/shared/ids';
import { describe, expect, it } from 'vitest';
import type { RunnerConnection } from '../../../../../../src/modules/machines/service/runner/connection.ts';
import {
  type TurnEnding,
  type TurnSink,
  turnBoard,
} from '../../../../../../src/modules/machines/service/runner/hub/turns.ts';

const COMPANY = '019a0000-0000-7000-8000-0000000000c1';

/** A connection of `machineId` that keeps what it sends; `keeps`: its runner keeps turns across a dropped link. */
function connection(machineId: string, keeps = false) {
  const sent: unknown[] = [];
  const caps = { reattach: keeps };
  const link = { send: (text: string) => sent.push(JSON.parse(text)) };
  const conn = {
    machineId,
    runner: { companyId: COMPANY },
    hello: { caps },
    link,
  } as unknown as RunnerConnection;
  return { conn, sent };
}

/** A sink that keeps its end and whether it was told its runner went away. */
function sinkOf() {
  const seen: { ended?: TurnEnding; detached: boolean[] } = { detached: [] };
  const sink: TurnSink = {
    events: () => {},
    question: () => {},
    end: (ending) => {
      seen.ended = ending;
    },
    detached: (away) => seen.detached.push(away),
  };
  return { sink, seen };
}

const spec = {} as TurnSpec;
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the hub's turns", () => {
  it('count the turns running on a machine’s connections, until they end or their connection closes', () => {
    const board = turnBoard();
    const { conn: first } = connection('m1');
    const { conn: second } = connection('m1');
    const { sink } = sinkOf();
    const turnId = newId();
    board.start(first, { turnId, spec }, sink);
    board.start(first, { turnId: newId(), spec }, sink);
    board.start(second, { turnId: newId(), spec }, sink);
    board.start(connection('m2').conn, { turnId: newId(), spec }, sink);
    expect([board.count('m1'), board.count('m2'), board.count('m3')]).toEqual([3, 1, 0]);
    board.record(first, { type: 'turn.end', turnId, ok: true, exitCode: 0 });
    expect(board.count('m1')).toBe(2);
    board.drop(first);
    expect(board.count('m1')).toBe(1);
  });

  it("end an older runner's turns when its link drops, in words that name the machine", async () => {
    const board = turnBoard({ machineName: async () => 'Airia devbox' });
    const { conn } = connection('m1');
    const { sink, seen } = sinkOf();
    board.start(conn, { turnId: newId(), spec }, sink);
    board.drop(conn);
    await settle();
    expect(seen.ended).toEqual({
      ok: false,
      exitCode: null,
      error:
        'machine_disconnected: Airia devbox disconnected, and its runner is too old to keep a turn across a dropped link: the turn stopped. Update the runner on the Machines page.',
    });
  });

  it('fail a waiting turn once the grace runs out, saying how long its machine was unreachable', async () => {
    const board = turnBoard({ graceMs: 20, machineName: async () => 'Airia devbox' });
    const { conn } = connection('m1', true);
    const { sink, seen } = sinkOf();
    board.start(conn, { turnId: newId(), spec }, sink);
    board.drop(conn);
    expect(seen.detached).toEqual([true]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen.ended?.error).toBe(
      'machine_disconnected: Airia devbox was unreachable for under a second: the turn stopped.',
    );
    expect(board.count('m1')).toBe(0);
  });

  it('call the machine "The machine" when its name cannot be read', async () => {
    const board = turnBoard({
      machineName: async () => {
        throw new Error('gone');
      },
    });
    const { conn } = connection('m1');
    const { sink, seen } = sinkOf();
    board.start(conn, { turnId: newId(), spec }, sink);
    board.drop(conn);
    await settle();
    expect(seen.ended?.error).toMatch(/^machine_disconnected: The machine disconnected, /);
  });

  it('end a turn stopped while its runner is away at once, and send a stop on a live link', async () => {
    const board = turnBoard({ graceMs: 60_000 });
    const { conn, sent } = connection('m1', true);
    const away = sinkOf();
    const live = sinkOf();
    const awayTurn = board.start(conn, { turnId: newId(), spec }, away.sink);
    const liveTurn = board.start(conn, { turnId: newId(), spec }, live.sink);
    liveTurn.stop();
    expect(sent.at(-1)).toEqual({ type: 'turn.stop', turnId: liveTurn.turnId });
    board.drop(conn);
    awayTurn.stop();
    await settle();
    expect(away.seen.ended).toEqual({ ok: false, exitCode: null, error: 'stopped' });
    expect(board.count('m1')).toBe(1);
    board.close();
  });
});
