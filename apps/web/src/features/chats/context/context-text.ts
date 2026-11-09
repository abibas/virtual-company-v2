import { ApiError } from '../../../api/errors.ts';
import { refusalText } from '../chat-text.ts';

/** What the context meter says: sizes, money, its tone by how full the conversation is, and the refusals. Pure. */

/** Past this share of the window the meter turns amber and offers Compact beside it. */
export const COMPACT_AT = 70;
/** Past this share it turns red. */
export const FULL_AT = 90;

export type Fullness = 'room' | 'filling' | 'full';

/** How full the conversation is, by its percentage; `room` when unknown. */
export function fullness(percent: number | undefined): Fullness {
  if (percent === undefined || percent <= COMPACT_AT) return 'room';
  return percent > FULL_AT ? 'full' : 'filling';
}

/** A size in tokens as people read it: 812, 4.2k, 476k, 1M, 1.2M. */
export function short(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${Number((count / 1000).toFixed(count < 10_000 ? 1 : 0))}k`;
  return `${Number((count / 1_000_000).toFixed(1))}M`;
}

/** Dollars to the cent; a cost below a cent is "<$0.01", none is "$0.00". */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** The meter's one line: "Context 476k / 1M · 48%", the size alone for an unknown window, "Context —" before any. */
export function meterLine(
  used: number | undefined,
  window: number | null,
  percent: number | undefined,
): string {
  if (used === undefined) return 'Context —';
  if (!window || percent === undefined) return `Context ${short(used)}`;
  return `Context ${short(used)} / ${short(window)} · ${percent}%`;
}

const REFUSALS: Readonly<Record<string, string>> = {
  nothing_to_compact: "There's nothing to compact yet: send a message first.",
  compact_unsupported: 'Codex compacts its conversation by itself: use Clear to start over.',
  nothing_to_clear: "There's nothing to clear: this chat has no conversation yet.",
};

/** A refusal of Compact or Clear in plain words; the chat's other refusals as the composer words them. */
export function conversationRefusal(error: unknown): string {
  if (error instanceof ApiError && REFUSALS[error.code]) return REFUSALS[error.code] as string;
  return refusalText(error);
}
