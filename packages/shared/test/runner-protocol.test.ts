import { describe, expect, it } from 'vitest';
import {
  EVENT_BATCH_MAX_BYTES,
  encodeFrame,
  FrameError,
  type FrameParse,
  parseRunnerFrame,
  parseServerFrame,
  RUNNER_FRAME_MAX_BYTES,
  RUNNER_FRAMES,
  RunnerFrame,
  SERVER_FRAMES,
  ServerFrame,
} from '../src/runner-protocol.ts';
import { IDS, RUNNER_EXAMPLES, SERVER_EXAMPLES } from './fixtures/runner-protocol/frames.ts';

function errorOf(result: FrameParse<unknown>): FrameError {
  if (result.kind !== 'invalid') throw new Error(`Expected an invalid frame, got ${result.kind}`);
  return result.error;
}

/** A run.events frame whose encoded text is about `bytes` long. */
function eventsOfSize(bytes: number) {
  const frame = RUNNER_EXAMPLES['run.events'];
  const base = encodeFrame(frame).length;
  const event = { ...frame.events[0], data: { text: 'x'.repeat(bytes - base + 'Done.'.length) } };
  return { ...frame, events: [event] } as RunnerFrame;
}

describe('the frame lists', () => {
  it('have one schema per frame type, in the order of the reference', () => {
    expect(RUNNER_FRAMES.map((schema) => schema.shape.type.value)).toEqual(Object.keys(RUNNER_EXAMPLES));
    expect(SERVER_FRAMES.map((schema) => schema.shape.type.value)).toEqual(Object.keys(SERVER_EXAMPLES));
  });

  it('leave out the self-update frames, moved to S8', () => {
    const types = [...RUNNER_FRAMES, ...SERVER_FRAMES].map((schema) => schema.shape.type.value);
    expect(types).not.toContain('runner_releases');
    expect(SERVER_EXAMPLES['server.hello']).not.toHaveProperty('update');
  });
});

describe('parseRunnerFrame and parseServerFrame', () => {
  it.each(Object.values(RUNNER_EXAMPLES))('read a runner frame: $type', (frame) => {
    expect(parseRunnerFrame(encodeFrame(frame))).toEqual({ kind: 'frame', frame });
    expect(RunnerFrame.parse(frame)).toEqual(frame);
  });

  it.each(Object.values(SERVER_EXAMPLES))('read a server frame: $type', (frame) => {
    expect(parseServerFrame(encodeFrame(frame))).toEqual({ kind: 'frame', frame });
    expect(ServerFrame.parse(frame)).toEqual(frame);
  });

  it('report an unknown type, and the frames of the other direction, as unknown, never as errors', () => {
    expect(parseRunnerFrame('{"type":"runner.future","x":1}')).toEqual({
      kind: 'unknown',
      type: 'runner.future',
    });
    expect(parseServerFrame('{"type":"server.hello.update"}')).toEqual({
      kind: 'unknown',
      type: 'server.hello.update',
    });
    expect(parseRunnerFrame(encodeFrame(SERVER_EXAMPLES['run.ack']))).toEqual({
      kind: 'unknown',
      type: 'run.ack',
    });
    expect(parseServerFrame(encodeFrame(RUNNER_EXAMPLES['cmd.ack']))).toEqual({
      kind: 'unknown',
      type: 'cmd.ack',
    });
  });

  it('let unknown fields through, at the top and inside', () => {
    const hello = RUNNER_EXAMPLES['runner.hello'];
    const newer = { ...hello, os: 'darwin', caps: { ...hello.caps, gpus: 1 } };
    expect(parseRunnerFrame(JSON.stringify(newer))).toEqual({ kind: 'frame', frame: newer });
    const start = SERVER_EXAMPLES['run.start'];
    const spec = { ...start.spec, placement: { ...start.spec.placement, mode: 'container' }, priority: 2 };
    expect(parseServerFrame(JSON.stringify({ ...start, spec }))).toEqual({
      kind: 'frame',
      frame: { ...start, spec },
    });
  });

  it('refuse a text over the frame limit before reading it', () => {
    const error = errorOf(parseRunnerFrame(' '.repeat(RUNNER_FRAME_MAX_BYTES + 1)));
    expect(error).toBeInstanceOf(FrameError);
    expect(error.code).toBe('too_large');
    expect(error.frameType).toBeUndefined();
    // Bytes, not characters: 131,074 characters, 262,146 bytes in UTF-8.
    expect(errorOf(parseServerFrame(`"${'é'.repeat(RUNNER_FRAME_MAX_BYTES / 2)}"`)).code).toBe('too_large');
  });

  it('hold run.events to the event batch limit', () => {
    expect(parseRunnerFrame(JSON.stringify(eventsOfSize(EVENT_BATCH_MAX_BYTES))).kind).toBe('frame');
    const error = errorOf(parseRunnerFrame(JSON.stringify(eventsOfSize(EVENT_BATCH_MAX_BYTES + 1))));
    expect(error).toMatchObject({ code: 'too_large', frameType: 'run.events' });
    expect(error.message).toContain(`${EVENT_BATCH_MAX_BYTES}-byte`);
  });

  it('refuse a text that is not JSON, not an object, or has no string type', () => {
    expect(errorOf(parseRunnerFrame('{"type":')).code).toBe('not_json');
    for (const text of ['[]', '42', 'null', '"runner.hello"']) {
      expect(errorOf(parseRunnerFrame(text)).code).toBe('not_object');
    }
    expect(errorOf(parseRunnerFrame('{}')).code).toBe('no_type');
    expect(errorOf(parseRunnerFrame('{"type":7}')).code).toBe('no_type');
  });

  it('refuse a known frame that breaks its schema, with the issues', () => {
    const error = errorOf(parseRunnerFrame(JSON.stringify({ type: 'cmd.ack', cmdId: 'nope', ok: 'yes' })));
    expect(error).toMatchObject({ code: 'invalid', frameType: 'cmd.ack', name: 'FrameError' });
    expect(error.issues.map((issue) => issue.path)).toEqual([['cmdId'], ['ok']]);
    expect(error.message).toMatch(/^Invalid cmd\.ack frame: cmdId: .+; ok: .+$/);
  });

  it('name a whole-frame issue without a path', () => {
    const command = { ...SERVER_EXAMPLES['power.command'], action: 'set_timezone' };
    const error = errorOf(parseServerFrame(JSON.stringify(command)));
    expect(error.message).toBe(
      'Invalid power.command frame: args.timezone: set_timezone needs args.timezone',
    );
    const answer = { ...SERVER_EXAMPLES['attention.resolved'], answer: {} };
    const noAnswer = errorOf(parseServerFrame(JSON.stringify(answer)));
    expect(noAnswer.message).toBe(
      'Invalid attention.resolved frame: answer: an answer has options, text or a decision',
    );
  });
});

describe('encodeFrame', () => {
  it('writes a frame as its JSON text', () => {
    const frame = { type: 'run.ack', runId: IDS.run, ackedSeq: 3 } as const;
    expect(encodeFrame(frame)).toBe(`{"type":"run.ack","runId":"${IDS.run}","ackedSeq":3}`);
  });

  it('throws a too_large FrameError over the frame limit, and over the batch limit for run.events', () => {
    const big = { ...SERVER_EXAMPLES['run.input'], text: 'x'.repeat(RUNNER_FRAME_MAX_BYTES) };
    expect(() => encodeFrame(big)).toThrow(FrameError);
    expect(() => encodeFrame(big)).toThrow(`${RUNNER_FRAME_MAX_BYTES}-byte`);
    expect(() => encodeFrame(eventsOfSize(EVENT_BATCH_MAX_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'too_large', frameType: 'run.events' }),
    );
    expect(encodeFrame(eventsOfSize(EVENT_BATCH_MAX_BYTES))).toHaveLength(EVENT_BATCH_MAX_BYTES);
  });
});
