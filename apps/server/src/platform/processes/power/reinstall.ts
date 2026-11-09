import type { ProcessCommand } from '@mwc/machines-core';
import { lastLine, type TunnelDeps, type TunnelKill, type TunnelSpawn } from '@mwc/machines-core/tunnels';

/**
 * One process the server runs to its end for the machines module, with a time limit: the reinstall of a devbox runner
 * over SSH (docs/machines.md, "Updating a runner"). It runs in its own process group (gcloud starts ssh and an IAP
 * helper), its standard error kept for its last line; past the limit the group gets SIGTERM, then SIGKILL 5 s later.
 */

/** How long a runner's reinstall may take: the box downloads the runner and its PTY, then restarts its service. */
export const REINSTALL_TIMEOUT_MS = 3 * 60_000;

/** How long a process past its limit has after SIGTERM before its group gets SIGKILL. */
export const KILL_GRACE_MS = 5_000;

/** How a process ended: well, or why not (its last line on stderr, its exit code, its signal, or the time limit). */
export type RunOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export interface RunDeps {
  readonly spawn: TunnelSpawn;
  readonly killGroup: TunnelKill;
  readonly timers: TunnelDeps['timers'];
}

/** How much of the process's standard error is kept. */
const KEPT = 4096;

/** Runs `command` to its end, or stops it after `timeoutMs`; never rejects. */
export function runToEnd(
  deps: RunDeps,
  command: ProcessCommand,
  timeoutMs = REINSTALL_TIMEOUT_MS,
): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<TunnelSpawn>;
    try {
      child = deps.spawn(command.command, command.args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: true,
        ...(command.env === undefined ? {} : { env: command.env }),
      });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    let output = '';
    let timedOut = false;
    let killTimer: unknown;
    let done = false;
    child.stderr?.on('data', (chunk) => {
      output = `${output}${String(chunk)}`.slice(-KEPT);
    });
    const timer = deps.timers.setTimeout(() => {
      timedOut = true;
      const { pid } = child;
      if (pid === undefined) return;
      deps.killGroup(pid, 'SIGTERM');
      killTimer = deps.timers.setTimeout(() => deps.killGroup(pid, 'SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);
    const finish = (outcome: RunOutcome) => {
      if (done) return;
      done = true;
      deps.timers.clearTimeout(timer);
      deps.timers.clearTimeout(killTimer);
      resolve(outcome);
    };
    child.once('error', (error) => finish({ ok: false, error: error.message }));
    child.once('close', (code, signal) => {
      if (timedOut) finish({ ok: false, error: `it did not end within ${timeoutMs / 1000} s` });
      else if (code === 0) finish({ ok: true });
      else
        finish({
          ok: false,
          error: lastLine(output) ?? (code === null ? `ended by ${signal}` : `exit code ${code}`),
        });
    });
  });
}
