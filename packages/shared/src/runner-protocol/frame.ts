import type { z } from 'zod';
import { EVENT_BATCH_MAX_BYTES, RUNNER_FRAME_MAX_BYTES } from './constants.ts';

/**
 * Reading and writing frames for both directions: the size check, JSON, then the schema of the frame's `type`. An
 * unknown `type` is reported, never an error (a newer peer may send frames this side does not know yet).
 */

/** Why a text is not a valid frame. */
export type FrameErrorCode = 'too_large' | 'not_json' | 'not_object' | 'no_type' | 'invalid';

/** A frame that cannot be read or sent: its code, its `type` when it had one, and the schema's issues for `invalid`. */
export class FrameError extends Error {
  readonly code: FrameErrorCode;
  readonly frameType: string | undefined;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(
    code: FrameErrorCode,
    message: string,
    details: { frameType?: string; issues?: readonly z.core.$ZodIssue[] } = {},
  ) {
    super(message);
    this.name = 'FrameError';
    this.code = code;
    this.frameType = details.frameType;
    this.issues = details.issues ?? [];
  }
}

/** A parsed text: a known frame, a frame of a type this side does not know (ignore it), or an invalid one. */
export type FrameParse<F> =
  | { readonly kind: 'frame'; readonly frame: F }
  | { readonly kind: 'unknown'; readonly type: string }
  | { readonly kind: 'invalid'; readonly error: FrameError };

/** A frame schema as the parser uses it. */
export interface FrameSchema<F> {
  readonly shape: { readonly type: { readonly value: string } };
  safeParse(value: unknown): { success: true; data: F } | { success: false; error: z.ZodError };
}

/** One direction's frame schemas by `type`. */
export type FrameTable<F> = ReadonlyMap<string, FrameSchema<F>>;

export function frameTable<F>(schemas: readonly FrameSchema<F>[]): FrameTable<F> {
  return new Map(schemas.map((schema) => [schema.shape.type.value, schema]));
}

/** The largest text of a frame of this type: `run.events` is held to the event batch limit. */
export function maxBytesOf(type: string): number {
  return type === 'run.events' ? EVENT_BATCH_MAX_BYTES : RUNNER_FRAME_MAX_BYTES;
}

const encoder = new TextEncoder();

/** The length of a text in UTF-8, the unit of the frame limits. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}

function invalid<F>(code: FrameErrorCode, message: string, frameType?: string): FrameParse<F> {
  return {
    kind: 'invalid',
    error: new FrameError(code, message, frameType === undefined ? {} : { frameType }),
  };
}

export function parseFrame<F>(text: string, table: FrameTable<F>): FrameParse<F> {
  const bytes = utf8Bytes(text);
  if (bytes > RUNNER_FRAME_MAX_BYTES) {
    return invalid('too_large', `A frame of ${bytes} bytes is over the ${RUNNER_FRAME_MAX_BYTES}-byte limit`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('not_json', 'A frame is JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('not_object', 'A frame is a JSON object');
  }
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return invalid('no_type', 'A frame has a string type');
  const schema = table.get(type);
  if (!schema) return { kind: 'unknown', type };
  if (bytes > maxBytesOf(type)) {
    return invalid(
      'too_large',
      `A ${type} frame of ${bytes} bytes is over its ${maxBytesOf(type)}-byte limit`,
      type,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = `Invalid ${type} frame: ${parsed.error.issues.map(describeIssue).join('; ')}`;
    return {
      kind: 'invalid',
      error: new FrameError('invalid', message, { frameType: type, issues: parsed.error.issues }),
    };
  }
  return { kind: 'frame', frame: parsed.data };
}

function describeIssue(issue: z.core.$ZodIssue): string {
  return issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`;
}

/** A frame as the text to send; throws a `too_large` FrameError when it is over its limit. */
export function encodeFrameText(frame: { readonly type: string }): string {
  const text = JSON.stringify(frame);
  const bytes = utf8Bytes(text);
  if (bytes > maxBytesOf(frame.type)) {
    throw new FrameError(
      'too_large',
      `A ${frame.type} frame of ${bytes} bytes is over its ${maxBytesOf(frame.type)}-byte limit`,
      {
        frameType: frame.type,
      },
    );
  }
  return text;
}
