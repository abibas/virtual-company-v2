import { newId } from '@mwc/shared/ids';
import { parseServerFrame, type ServerFrame } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import type { RunnerConnection } from '../../../../../../src/modules/machines/service/runner/connection.ts';
import {
  MACHINE_DISCONNECTED,
  type TerminalEnding,
  terminalBoard,
} from '../../../../../../src/modules/machines/service/runner/hub/terminals.ts';

/** A connection that only records what is sent on it. */
function connection() {
  const sent: ServerFrame[] = [];
  const link = {
    send: (text: string) => {
      const parsed = parseServerFrame(text);
      if (parsed.kind === 'frame') sent.push(parsed.frame);
    },
  };
  return { connection: { link } as unknown as RunnerConnection, sent };
}

/** A sink that records what it hears. */
function sink() {
  const heard: (string | TerminalEnding)[] = [];
  return {
    heard,
    sink: {
      opened: (shell: string) => heard.push(`opened ${shell}`),
      output: (data: string) => heard.push(`output ${data}`),
      exit: (ending: TerminalEnding) => heard.push(ending),
    },
  };
}

describe("the hub's terminals", () => {
  it('relay a session both ways, and send nothing for it once it ended', () => {
    const board = terminalBoard();
    const { connection: c, sent } = connection();
    const { sink: s, heard } = sink();
    const sessionId = newId();
    const channel = board.open(c, { sessionId, cols: 80, rows: 24 }, s);
    expect(channel.sessionId).toBe(sessionId);
    board.record(c, { type: 'terminal.opened', sessionId, shell: '/bin/sh' });
    board.record(c, { type: 'terminal.output', sessionId, data: 'aGk=' });
    channel.input('bHM=');
    channel.resize(100, 30);
    board.record(c, { type: 'terminal.exit', sessionId, code: 130, signal: 'SIGINT', error: 'idle_timeout' });
    channel.input('bHM=');
    channel.resize(90, 20);
    channel.close();
    expect(heard).toEqual([
      'opened /bin/sh',
      'output aGk=',
      { code: 130, signal: 'SIGINT', error: 'idle_timeout' },
    ]);
    expect(sent.map((frame) => frame.type)).toEqual(['terminal.open', 'terminal.input', 'terminal.resize']);
  });

  it('drop frames of no open session, and close a session once', () => {
    const board = terminalBoard();
    const { connection: c, sent } = connection();
    const other = connection();
    const { sink: s, heard } = sink();
    board.record(other.connection, { type: 'terminal.output', sessionId: newId(), data: 'aGk=' });
    const channel = board.open(c, { sessionId: newId(), cols: 80, rows: 24 }, s);
    board.record(c, { type: 'terminal.exit', sessionId: newId(), code: 0 });
    channel.close();
    channel.close();
    expect(heard).toEqual([]);
    expect(sent.map((frame) => frame.type)).toEqual(['terminal.open', 'terminal.close']);
  });

  it('end every session of a connection that closed with machine_disconnected, and nothing of another', () => {
    const board = terminalBoard();
    const { connection: c } = connection();
    const other = connection();
    const a = sink();
    const b = sink();
    const kept = sink();
    board.open(c, { sessionId: newId(), cols: 80, rows: 24 }, a.sink);
    const second = board.open(c, { sessionId: newId(), cols: 80, rows: 24 }, b.sink);
    board.open(other.connection, { sessionId: newId(), cols: 80, rows: 24 }, kept.sink);
    board.drop(c);
    board.drop(connection().connection);
    expect([a.heard, b.heard, kept.heard]).toEqual([[MACHINE_DISCONNECTED], [MACHINE_DISCONNECTED], []]);
    second.input('aGk=');
    expect(other.sent.map((frame) => frame.type)).toEqual(['terminal.open']);
  });

  it('count the terminals open on a machine’s connections', () => {
    const board = terminalBoard();
    const ofMachine = (machineId: string) => {
      const made = connection();
      return Object.assign(made.connection, { machineId });
    };
    const first = ofMachine('m1');
    const channel = board.open(first, { sessionId: newId(), cols: 80, rows: 24 }, sink().sink);
    board.open(ofMachine('m1'), { sessionId: newId(), cols: 80, rows: 24 }, sink().sink);
    board.open(ofMachine('m2'), { sessionId: newId(), cols: 80, rows: 24 }, sink().sink);
    expect([board.count('m1'), board.count('m2'), board.count('m3')]).toEqual([2, 1, 0]);
    channel.close();
    expect(board.count('m1')).toBe(1);
  });
});
