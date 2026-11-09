import type { ProcessCommand } from '../driver.ts';
import {
  TUNNEL_CLEAR_TIMEOUT_MS,
  TUNNEL_KILL_GRACE_MS,
  type TunnelChild,
  type TunnelDeps,
} from './process.ts';

/**
 * The clearing of a machine's port (`../tunnels.ts`): one short process from the driver's `clearPortCommand`, started
 * detached like a tunnel, given up to a minute (then its group gets SIGKILL). Its outcome does not matter: the tunnel's
 * next try tells.
 */

export interface Clearing {
  /** Resolves once its process is gone (or got SIGKILL, or never started). */
  readonly ended: Promise<void>;
  /** Stops it (SIGTERM to its group, SIGKILL after 5 s); `done` is then never called. */
  stop(): void;
}

export function clearPort(
  deps: Pick<TunnelDeps, 'spawn' | 'killGroup' | 'timers'>,
  command: ProcessCommand,
  done: () => void,
): Clearing {
  let finished = false;
  const { promise: ended, resolve } = Promise.withResolvers<void>();
  let timer: unknown;
  const finish = () => {
    resolve();
    if (finished) return;
    finished = true;
    deps.timers.clearTimeout(timer);
    done();
  };
  let child: TunnelChild;
  try {
    const env = command.env === undefined ? {} : { env: command.env };
    child = deps.spawn(command.command, command.args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
      ...env,
    });
  } catch {
    finish();
    return { ended, stop: () => {} };
  }
  const pid = child.pid;
  child.stderr?.on('data', () => {});
  child.once('close', () => finish());
  child.once('error', () => finish());
  timer = deps.timers.setTimeout(() => {
    if (pid !== undefined) deps.killGroup(pid, 'SIGKILL');
    finish();
  }, TUNNEL_CLEAR_TIMEOUT_MS);
  return {
    ended,
    stop: () => {
      if (finished) return;
      finished = true;
      deps.timers.clearTimeout(timer);
      if (pid === undefined) {
        resolve();
        return;
      }
      const kill = deps.timers.setTimeout(() => {
        deps.killGroup(pid, 'SIGKILL');
        resolve();
      }, TUNNEL_KILL_GRACE_MS);
      void ended.then(() => deps.timers.clearTimeout(kill));
      deps.killGroup(pid, 'SIGTERM');
    },
  };
}
