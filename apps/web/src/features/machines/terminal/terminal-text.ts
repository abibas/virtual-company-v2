import type { TerminalToBrowser } from '@mwc/shared/runner-protocol';
import { ApiError, friendlyMessage } from '../../../api/errors.ts';

/** What the terminal panel says for each way a terminal fails or ends (docs/machines.md, "Terminal"; pure). */

/** How a terminal ended: the words for the status line, and whether it went wrong. */
export interface TerminalEnd {
  readonly reason: string;
  readonly failed: boolean;
}

/** The runner's or the server's reasons for ending a terminal, and the refusals of a ticket. */
const REASONS: Readonly<Record<string, string>> = {
  idle_timeout: 'Closed after 60 minutes without input',
  machine_disconnected: 'The machine disconnected',
  machine_offline: 'The machine is offline',
  runner_stopping: 'The runner on the machine stopped',
  too_many_sessions: 'This machine has 4 terminals open already',
  terminal_unavailable: "This machine's runner has no terminal yet: reinstall it",
  forbidden: 'Only owners open a terminal',
  machine_not_found: 'This machine no longer exists. Refresh the page.',
};

/** Why a code ended the terminal: the known words, `spawn_failed: …` as the shell not starting, else the code. */
export function reasonText(code: string): string {
  const known = REASONS[code];
  if (known) return known;
  if (code.startsWith('spawn_failed')) {
    const detail = code.replace(/^spawn_failed:?\s*/, '');
    return detail ? `The shell did not start (${detail})` : 'The shell did not start';
  }
  return code;
}

/** `{type: 'exit'}`: the runner's or the server's reason, else the shell's exit code or signal. */
export function exitText(exit: Extract<TerminalToBrowser, { type: 'exit' }>): TerminalEnd {
  if (exit.error) return { reason: reasonText(exit.error), failed: true };
  if (exit.code === null) return { reason: `Ended by ${exit.signal ?? 'a signal'}`, failed: true };
  return { reason: `Exit code ${exit.code}`, failed: exit.code !== 0 };
}

/** A ticket the server refused (409 `machine_offline`, `terminal_unavailable`, 403 for non-owners), or any failure. */
export function ticketErrorText(error: unknown): string {
  if (error instanceof ApiError && REASONS[error.code]) return reasonText(error.code);
  return friendlyMessage(error);
}

/**
 * A socket that closed without the server saying why. Before the shell opened it is a refused upgrade (a browser sees
 * only 1006): most likely an expired ticket; after, a dropped connection.
 */
export function closedText(opened: boolean): string {
  return opened
    ? 'The connection to the server dropped'
    : 'The link expired or was refused. Reconnect to open it again.';
}
