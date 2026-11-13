import type { SlackInboundMessage } from '@mwc/tools-core';
import { obj, str } from '../map.ts';

/**
 * Socket Mode's frames (2026-11-13): what Slack sends on the connection (`hello`, `disconnect`, and envelopes that
 * carry an Events API payload, a slash command or an interaction), read into what the connection needs; and the
 * message events read into `SlackInboundMessage`. Anything else is nothing. Pure.
 */

/** One frame as the connection reads it. */
export type Frame =
  | { readonly kind: 'hello' }
  | { readonly kind: 'disconnect'; readonly reason: string }
  | {
      readonly kind: 'envelope';
      readonly envelopeId: string;
      /** The Events API's id; null for a slash command or an interaction. */
      readonly eventId: string | null;
      /** The message it carries; null for anything else, which is acked and left. */
      readonly message: SlackInboundMessage | null;
    }
  | { readonly kind: 'other' };

const OTHER: Frame = { kind: 'other' };

/** A frame's JSON, or undefined when it is none. */
function parsed(data: unknown): Record<string, unknown> | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const value = JSON.parse(data) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The message event an Events API payload carries, or null. */
export function messageOf(payload: Record<string, unknown>): SlackInboundMessage | null {
  const event = obj(payload.event);
  const type = event.type;
  if (type !== 'app_mention' && type !== 'message') return null;
  const channel = str(event.channel);
  const ts = str(event.ts);
  if (channel === null || ts === null) return null;
  return {
    eventId: str(payload.event_id),
    teamId: str(payload.team_id) ?? str(event.team),
    type,
    channel,
    channelType: str(event.channel_type),
    user: str(event.user),
    botId: str(event.bot_id),
    subtype: str(event.subtype),
    text: typeof event.text === 'string' ? event.text : '',
    ts,
    threadTs: str(event.thread_ts),
    edited: event.edited !== undefined && event.edited !== null,
  };
}

/** A frame Slack sent, read (see above). */
export function frameOf(data: unknown): Frame {
  const frame = parsed(data);
  if (frame === undefined) return OTHER;
  if (frame.type === 'hello') return { kind: 'hello' };
  if (frame.type === 'disconnect') return { kind: 'disconnect', reason: str(frame.reason) ?? 'unknown' };
  const envelopeId = str(frame.envelope_id);
  if (envelopeId === null) return OTHER;
  if (frame.type !== 'events_api') return { kind: 'envelope', envelopeId, eventId: null, message: null };
  const payload = obj(frame.payload);
  return { kind: 'envelope', envelopeId, eventId: str(payload.event_id), message: messageOf(payload) };
}

/** Ids seen lately, the oldest forgotten past `max`. */
export function recentIds(max: number) {
  const seen = new Set<string>();
  return {
    /** True when `id` was seen before; else remembers it. */
    seen(id: string): boolean {
      if (seen.has(id)) return true;
      seen.add(id);
      if (seen.size > max) seen.delete(seen.values().next().value as string);
      return false;
    },
  };
}
