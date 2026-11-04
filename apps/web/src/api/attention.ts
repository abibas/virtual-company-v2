import type { AttentionItem } from '../components/feed/kinds.ts';

export interface Attention {
  /** What needs the person, across their companies, newest first. */
  readonly items: readonly AttentionItem[];
  readonly loading: boolean;
}

const NOTHING_YET: Attention = { items: [], loading: false };

/**
 * The attention feed of the signed-in person. S5's inbox (`modules/inbox`) will fill it from the API; until then
 * it is empty, and the feed says so.
 */
export function useAttention(): Attention {
  return NOTHING_YET;
}
