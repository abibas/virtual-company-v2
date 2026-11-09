import type { Machine } from '../../../api/types.ts';

/** When a machine card offers to update its runner, and what it says while it does (pure). */

/**
 * True when the runner needs the update: it is connected and runs another build than the one the server hands out, or
 * it has no terminal (a runner older than the terminal). An offline machine says nothing: its runner is unknown.
 */
export function runnerOutOfDate(machine: Pick<Machine, 'runner'>, online: boolean): boolean {
  return online && (machine.runner.current === false || !machine.runner.terminal);
}

/** How long after an update the card loads again: the runner restarts about 10 s after it (its service's wait). */
export const RELOAD_AFTER_MS = 15_000;

/** What the card says once the server did its part. */
export const UPDATED_TEXT: Readonly<Record<'self_update' | 'ssh_reinstall', string>> = {
  self_update:
    'The runner put the new build in place and is restarting. This card shows it in a few seconds.',
  ssh_reinstall:
    'The runner was reinstalled on the box and is restarting. This card shows it in a few seconds.',
};
