import type { Machine } from '../../../api/types.ts';

/** The command that opens a shell on a machine from the user's own Terminal, with where to run it (pure). */
export interface ConnectCommand {
  readonly command: string;
  readonly hint: string;
}

/** The devbox's own CLI command, or `docker exec` into a container (its hostname is its short id); none for a Mac. */
export function connectCommand(
  machine: Pick<Machine, 'kind' | 'provider' | 'hostname'>,
): ConnectCommand | null {
  if (machine.provider === 'airia_devbox') {
    return {
      command: 'airia devbox ssh',
      hint: 'Run it in a Terminal on this Mac. It starts the box if it is stopped, and the box costs its hourly rate while it is up.',
    };
  }
  if (machine.kind === 'container') {
    return {
      command: `docker exec -it ${machine.hostname} bash`,
      hint: 'Run it on the computer where Docker runs this container.',
    };
  }
  return null;
}
