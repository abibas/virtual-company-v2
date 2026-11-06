import type { Log } from '../log.ts';
import type { ChildLike, Spawn } from '../system/process.ts';
import { CAFFEINATE_BIN, type HoldDriver } from './driver.ts';

/**
 * This Mac's hold: while held, one `caffeinate -i -w <runner pid>` child keeps the Mac from idle-sleeping (it shows in
 * `pmset -g assertions`). It is killed on release and when the runner stops; `-w` ends it by itself if the runner dies
 * without stopping it. A child that ends while the hold goes on is started again at the next refresh.
 */

export interface CaffeinateDeps {
  readonly spawn: Spawn;
  /** The runner's own process id, for `-w`. */
  readonly pid: number;
  readonly log: Log;
}

export function caffeinateDriver(deps: CaffeinateDeps): HoldDriver {
  let child: ChildLike | undefined;

  const start = () => {
    if (child) return;
    let started: ChildLike;
    try {
      started = deps.spawn(CAFFEINATE_BIN, ['-i', '-w', String(deps.pid)], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch (error) {
      deps.log.error('cannot start caffeinate', { error });
      return;
    }
    child = started;
    const forget = () => {
      if (child === started) child = undefined;
    };
    started.once('exit', (code, signal) => {
      if (child === started) deps.log.warn('caffeinate ended while the Mac is held', { code, signal });
      forget();
    });
    started.once('error', (error) => {
      deps.log.error('caffeinate failed', { error });
      forget();
    });
  };

  const stop = () => {
    const running = child;
    child = undefined;
    running?.kill('SIGTERM');
  };

  return {
    kind: 'caffeinate',
    apply: async (until) => {
      if (until === null) {
        stop();
        return null;
      }
      start();
      return child ? until : null;
    },
    refresh: async (until) => {
      start();
      return child ? until : null;
    },
    close: async () => stop(),
  };
}
