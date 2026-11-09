import { DEVBOX_KEEPALIVE_DURATION } from '@mwc/shared/runner-protocol';
import type { Log } from '../system/log.ts';
import { runCommand, type Spawn } from '../system/process.ts';
import type { Clock, Timers } from '../system/time.ts';
import { DEVBOX_KEEPALIVE_BIN, DEVBOX_KEEPALIVE_FILE, type HoldDriver } from './driver.ts';

/**
 * The Airia devbox's hold: the box's own idle check counts the keepalive file (`/var/lib/devbox/keepalive`, an epoch
 * in seconds) as activity. While held, at the start and at every refresh (5 minutes), the driver reads the file and
 * runs `devbox-keepalive '20 minutes'` (always that text: `'20m'` writes nothing) only when the current end comes
 * sooner than now + 20 minutes, so it never shortens a longer hold someone set; it never writes `off`. On release it
 * stops refreshing and the file runs out by itself, then the box's idle policy takes over.
 */

/** What `devbox-keepalive '20 minutes'` sets: now + 20 minutes. */
export const DEVBOX_KEEPALIVE_MS = 20 * 60_000;

export interface DevboxDeps {
  readonly spawn: Spawn;
  readonly readFile: (path: string) => Promise<string>;
  readonly clock: Clock;
  readonly timers: Timers;
  readonly log: Log;
}

/** The keepalive's end in milliseconds, or null when the file is missing or holds no epoch. */
export async function readKeepalive(readFile: (path: string) => Promise<string>): Promise<number | null> {
  try {
    const text = (await readFile(DEVBOX_KEEPALIVE_FILE)).trim();
    return /^\d+$/.test(text) ? Number(text) * 1000 : null;
  } catch {
    return null;
  }
}

export function devboxDriver(deps: DevboxDeps): HoldDriver {
  let held = false;
  let end: number | null = null;

  const refresh = async (): Promise<number | null> => {
    const now = deps.clock.now();
    const before = await readKeepalive(deps.readFile);
    held = true;
    if (before !== null && before >= now + DEVBOX_KEEPALIVE_MS) {
      end = before;
      return end;
    }
    const result = await runCommand(DEVBOX_KEEPALIVE_BIN, [DEVBOX_KEEPALIVE_DURATION], deps);
    const after = await readKeepalive(deps.readFile);
    if (result.code !== 0 || after === null || after <= (before ?? 0)) {
      deps.log.warn('devbox-keepalive did not extend the hold', {
        code: result.code,
        error: result.error,
        before,
        after,
      });
    }
    end = after ?? before;
    return end;
  };

  return {
    kind: 'devbox_keepalive',
    apply: async (until) => {
      if (until === null) {
        held = false;
        end = null;
        return null;
      }
      return held ? end : refresh();
    },
    refresh: async () => refresh(),
    close: async () => {
      held = false;
      end = null;
    },
  };
}
