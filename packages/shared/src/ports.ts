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
  /** `vite preview` of the production web build. */
  webPreview: 9955,
  drizzleStudio: 9956,
  prodLike: { api: 9990, web: 9991, postgres: 9992 },
  /**
   * The remote-debugging port (Chrome DevTools Protocol) of the visible test browser on the developer's
   * machine, for checks by hand in a real browser (e.g. the Clerk sign-in and invitation flows). Nothing
   * in the repository starts or drives it.
   */
  testBrowserDebug: 9993,
} as const;

/**
 * The devbox install forward: the Airia devbox's `127.0.0.1:9954` while its install command runs (docs/machines.md,
 * "Installing a runner"). It is a port on the box, not on this machine (where 9954 is ngrok's inspect UI): the install
 * downloads and enrolls through it, so its SSH session ends with the install, and the box's `127.0.0.1:<api port>`
 * stays free for This Mac's standing tunnel, which the installed runner uses.
 */
export const INSTALL_PORT = 9954;

/** First port of the per-worktree slots: slot k uses 9960+3k (API), +1 (web), +2 (Postgres). */
export const SLOT_BASE = 9960;
export const SLOT_COUNT = 10;

export interface SlotPorts {
  readonly slot: number;
  readonly api: number;
  readonly web: number;
  readonly postgres: number;
}

/** Ports of an ephemeral instance (a task worktree) in slot 0..SLOT_COUNT-1. */
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
