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

/** What a turn on a plan (a login or setup token) costs, in the popover and the turn's footer. */
export const PLAN_COST = 'included in your plan';

/**
 * A cost as the popover shows it: "included in your plan" for a plan's turns (unless others cost money), the money
 * when the harness gave it, else "—".
 */
export function costText(usd: number | undefined, onPlan: boolean): string {
  if (usd === undefined) return onPlan ? PLAN_COST : '—';
  return onPlan ? `${money(usd)} + ${PLAN_COST}` : money(usd);
}

/** Dollars to the cent; a cost below a cent is "<$0.01", none is "$0.00". */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/**
 * The meter's one line: "Context 476k / 1M · 48%", the size alone for an unknown window, "Context —" before any; an
 * estimate (Codex) reads "Context ≈45k / 272k · 17%".
 */
export function meterLine(
  used: number | undefined,
  window: number | null,
  percent: number | undefined,
  estimate = false,
): string {
  if (used === undefined) return 'Context —';
  const size = `${estimate ? '≈' : ''}${short(used)}`;
  if (!window || percent === undefined) return `Context ${size}`;
  return `Context ${size} / ${short(window)} · ${percent}%`;
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
