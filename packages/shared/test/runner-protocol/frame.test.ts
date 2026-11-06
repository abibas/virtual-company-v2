import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { frame } from '../../src/runner-protocol/common.ts';
import { EVENT_BATCH_MAX_BYTES, RUNNER_FRAME_MAX_BYTES } from '../../src/runner-protocol/constants.ts';
import {
  encodeFrameText,
  FrameError,
  frameTable,
  maxBytesOf,
  parseFrame,
  utf8Bytes,
} from '../../src/runner-protocol/frame.ts';

const Ping = frame('test.ping', { n: z.int() });
const Pong = frame('test.pong', {});
const Never = frame('test.never', {}).refine(() => false, 'never valid');
const TABLE = frameTable<z.infer<typeof Ping> | z.infer<typeof Pong> | z.infer<typeof Never>>([
  Ping,
  Pong,
  Never,
]);

describe('FrameError', () => {
  it('is an Error with its code, and no type or issues unless given', () => {
    const error = new FrameError('not_json', 'A frame is JSON');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: 'FrameError', code: 'not_json', message: 'A frame is JSON' });
    expect(error.frameType).toBeUndefined();
    expect(error.issues).toEqual([]);
  });
});

describe('frame tables and limits', () => {
  it('index a direction by type', () => {
    expect([...TABLE.keys()]).toEqual(['test.ping', 'test.pong', 'test.never']);
  });

  it('hold run.events to the batch limit and every other frame to the frame limit', () => {
    expect(maxBytesOf('run.events')).toBe(EVENT_BATCH_MAX_BYTES);
    expect(maxBytesOf('run.start')).toBe(RUNNER_FRAME_MAX_BYTES);
    expect(maxBytesOf('runner.future')).toBe(RUNNER_FRAME_MAX_BYTES);
  });

  it('count UTF-8 bytes', () => {
    expect(utf8Bytes('')).toBe(0);
    expect(utf8Bytes('a')).toBe(1);
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('€')).toBe(3);
    expect(utf8Bytes('😀')).toBe(4);
  });
});

describe('parseFrame and encodeFrameText', () => {
  it('read the frames of a table and nothing else', () => {
    expect(parseFrame('{"type":"test.ping","n":2}', TABLE)).toEqual({
      kind: 'frame',
      frame: { type: 'test.ping', n: 2 },
    });
    expect(parseFrame('{"type":"run.ack"}', TABLE)).toEqual({ kind: 'unknown', type: 'run.ack' });
    const result = parseFrame('{"type":"test.ping","n":"2"}', TABLE);
    expect(result.kind === 'invalid' && result.error.message).toMatch(/^Invalid test\.ping frame: n: /);
  });

  it('name an issue of the whole frame without a path', () => {
    const result = parseFrame('{"type":"test.never"}', TABLE);
    expect(result.kind === 'invalid' && result.error.message).toBe('Invalid test.never frame: never valid');
  });

  it('write a frame and refuse one over its limit', () => {
    expect(encodeFrameText({ type: 'test.pong' })).toBe('{"type":"test.pong"}');
    const big = { type: 'test.ping', pad: 'x'.repeat(RUNNER_FRAME_MAX_BYTES) };
    expect(() => encodeFrameText(big)).toThrow(
      expect.objectContaining({ code: 'too_large', frameType: 'test.ping' }),
    );
  });
});
