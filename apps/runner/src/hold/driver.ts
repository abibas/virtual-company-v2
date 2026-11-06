import { HoldDriver as HoldDriverKind } from '@mwc/shared/machines';

/**
 * How the runner keeps its machine awake while it is held (docs/machines.md). The driver is chosen by what the
 * machine has: the devbox's own `devbox-keepalive`, `caffeinate` on macOS, or nothing (a container, which is awake
 * while its host is). `MWC_RUNNER_HOLD` overrides the choice (`none` on a Mac that should never be kept awake).
 */

export { HoldDriverKind };

export interface HoldDriver {
  readonly kind: HoldDriverKind;
  /**
   * Holds the machine until `until` (milliseconds), or releases it with null; called on every change. Returns the end
   * the driver guarantees, null when it holds nothing.
   */
  apply(until: number | null): Promise<number | null>;
  /** The periodic refresh while held (every `DEVBOX_KEEPALIVE_REFRESH_MS`); returns the end it guarantees. */
  refresh(until: number): Promise<number | null>;
  /** Releases the machine and frees what the driver holds (on the runner's exit). */
  close(): Promise<void>;
}

/** The devbox's keepalive command and the file it writes (an epoch in seconds). */
export const DEVBOX_KEEPALIVE_BIN = '/usr/local/bin/devbox-keepalive';
export const DEVBOX_KEEPALIVE_FILE = '/var/lib/devbox/keepalive';
export const CAFFEINATE_BIN = '/usr/bin/caffeinate';

export interface DetectDeps {
  readonly platform: NodeJS.Platform;
  readonly exists: (path: string) => boolean;
  /** `MWC_RUNNER_HOLD`, when set. */
  readonly override?: string | undefined;
}

/** The hold driver this machine has: the override, else the devbox's keepalive, else `caffeinate` on macOS, else none. */
export function detectHoldDriver(deps: DetectDeps): HoldDriverKind {
  if (deps.override) {
    const parsed = HoldDriverKind.safeParse(deps.override);
    if (!parsed.success) {
      throw new Error(`MWC_RUNNER_HOLD must be one of ${HoldDriverKind.options.join(', ')}`);
    }
    return parsed.data;
  }
  if (deps.exists(DEVBOX_KEEPALIVE_BIN)) return 'devbox_keepalive';
  if (deps.platform === 'darwin' && deps.exists(CAFFEINATE_BIN)) return 'caffeinate';
  return 'none';
}

/** The driver of a machine that needs no holding: it reports the hold it is given and does nothing. */
export function noneDriver(): HoldDriver {
  return {
    kind: 'none',
    apply: async (until) => until,
    refresh: async (until) => until,
    close: async () => {},
  };
}
