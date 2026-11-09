/**
 * What `mwc machine enroll-token` prints: the token and, for each kind of machine, the one command that installs a
 * runner with it (docs/machines.md, "Installing a runner"). Pure text from the server's addresses and the token.
 */
import { containerRunnerCommand, DEFAULT_CONTAINER_RUNNER } from '@mwc/shared/container-runner';
import { INSTALL_PORT } from '@mwc/shared/ports';
import { RUNNER_INSTALL_SCRIPT_PATH } from '@mwc/shared/runner-protocol';
import type { MeMembership } from '../api/session.ts';

export { containerServerUrl, isLoopback } from '@mwc/shared/container-runner';

/** The installer, piped into sh, for a server (downloaded and enrolled through `via` when given). */
export function installCommand(server: string, token: string, via?: string): string {
  const from = via ?? server;
  const through = via === undefined ? '' : ` --via ${via}`;
  return `curl -fsSL ${from}${RUNNER_INSTALL_SCRIPT_PATH} | sh -s -- --server ${server}${through} --token ${token}`;
}

/** The port of an address: its own, else its protocol's (443 for https, 80 for http). */
export function portOf(url: string): number {
  const { port, protocol } = new URL(url);
  return Number(port || (protocol === 'https:' ? 443 : 80));
}

/**
 * The installer run on the Airia devbox through the company's CLI, from This Mac: `-R` makes the box's
 * `127.0.0.1:9954` (INSTALL_PORT) This Mac's API for the install's downloads and enroll (`--via`), and the box's runner
 * keeps `--server http://127.0.0.1:<port>`, which only the standing tunnel serves (the server's, or This Mac's
 * runner's). Nothing then holds
 * the install's session open, so it ends with the install. No public address is needed.
 */
export function devboxCommand(port: number, token: string): string {
  const forward = `127.0.0.1:${INSTALL_PORT}:127.0.0.1:${port}`;
  const install = installCommand(`http://127.0.0.1:${port}`, token, `http://127.0.0.1:${INSTALL_PORT}`);
  return `airia devbox ssh -- -R ${forward} '${install}'`;
}

/**
 * The compose command that enrolls and starts a container runner with the defaults ("Docker runner", 2 CPUs, 4 GB, 2
 * runs at once) in its own compose project; the server's address only when compose's default does not reach it.
 */
export function containerCommand(server: string, token: string, composeFile: string | null = null): string {
  return containerRunnerCommand({ ...DEFAULT_CONTAINER_RUNNER, token, composeFile, server });
}

export interface EnrollTokenText {
  readonly company: Pick<MeMembership, 'name' | 'slug'>;
  readonly token: string;
  readonly expiresAt: string;
  /** The server the CLI talks to (This Mac reaches it). */
  readonly server: string;
  /** The API's own address (`/api/config`'s `apiUrl`), whose port the devbox reaches; the server's when unknown. */
  readonly apiUrl: string | null;
  /** The server drives the devboxes itself (`/api/config`'s `localPower`): it holds the box's tunnel, not This Mac's runner. */
  readonly localPower?: boolean;
  /** The absolute path of the server's deploy/compose.yml (`/api/config`'s `composeFile`); null in production or unknown. */
  readonly composeFile?: string | null;
}

/** What the devbox's command needs first, and what it does. */
export const DEVBOX_HINT =
  "The Airia devbox (run it on This Mac, after This Mac's runner is installed: that runner keeps the box connected " +
  'afterwards; it starts the box if it is stopped, and the box costs its hourly rate while it is up; the box connects ' +
  "once This Mac's runner holds its tunnel):";

/** The devbox's hint when the server drives the airia CLI itself: no runner on This Mac is needed. */
export const DEVBOX_HINT_SERVER =
  'The Airia devbox (run it on This Mac; it starts the box if it is stopped, and the box costs its hourly rate while ' +
  'it is up; the box connects once the server holds its tunnel):';

/** The token, then the command for This Mac, the Airia devbox and a container. */
export function enrollTokenText(t: EnrollTokenText): string {
  return [
    `An enrollment token for ${t.company.name} (${t.company.slug}), good for one machine until ${t.expiresAt}:`,
    '',
    `  ${t.token}`,
    '',
    'Run one of these to install a runner with it (one token enrolls one machine; make another for the next):',
    '',
    'This Mac:',
    `  ${installCommand(t.server, t.token)}`,
    '',
    t.localPower === true ? DEVBOX_HINT_SERVER : DEVBOX_HINT,
    `  ${devboxCommand(portOf(t.apiUrl ?? t.server), t.token)}`,
    '',
    t.composeFile
      ? 'A Docker container on This Mac (2 CPUs, 4 GB, 2 runs at once; change MWC_RUNNER_* to taste):'
      : 'A Docker container on This Mac (from the repository folder; 2 CPUs, 4 GB, 2 runs at once):',
    `  ${containerCommand(t.server, t.token, t.composeFile ?? null)}`,
    '',
  ].join('\n');
}
