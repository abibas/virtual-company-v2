/**
 * The port map for Most Wanted Corp v2. Everything lives in 9950–9999 so v2 never
 * collides with v1 (3200, 8766, 54329), the AI gateway (8300) or the Airia stacks.
 * See docs/ports.md.
 */
export const PORTS = {
  api: 9950,
  web: 9951,
  postgres: 9952,
  runnerHealth: 9953,
  ngrokInspect: 9954,
  webPreview: 9955,
  drizzleStudio: 9956,
  prodLike: { api: 9990, web: 9991, postgres: 9992 },
} as const;

/** First port of the per-worktree slots: slot k uses 9960+3k (API), +1 (web), +2 (Postgres). */
export const SLOT_BASE = 9960;
export const SLOT_COUNT = 10;

export interface SlotPorts {
  readonly slot: number;
  readonly api: number;
  readonly web: number;
  readonly postgres: number;
}

/** Ports of an ephemeral instance (a task worktree, an e2e run) in slot 0..SLOT_COUNT-1. */
export function slotPorts(slot: number): SlotPorts {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new RangeError(`slot must be an integer in 0..${SLOT_COUNT - 1}, got ${String(slot)}`);
  }
  const api = SLOT_BASE + slot * 3;
  return { slot, api, web: api + 1, postgres: api + 2 };
}

/** A stable slot for a worktree path (FNV-1a over the path), so the same checkout always picks the same slot. */
export function slotFromPath(path: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % SLOT_COUNT;
}
