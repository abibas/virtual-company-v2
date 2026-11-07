/**
 * What `mwc machine enroll-token` prints: the token and, for each kind of machine, the one command that installs a
 * runner with it (docs/machines.md, "Installing a runner"). Pure text from the server's addresses and the token.
 */
import { RUNNER_INSTALL_SCRIPT_PATH } from '@mwc/shared/runner-protocol';
import type { MeMembership } from '../api/session.ts';

/** The compose service of the container runner, and the server address it has unless told another. */
export const COMPOSE_COMMAND = 'docker compose -f deploy/compose.yml --profile runner up -d runner-local';
export const COMPOSE_SERVER_URL = 'http://host.docker.internal:9950';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/** True for an address only this machine reaches (localhost, 127.x, ::1). */
export function isLoopback(url: string): boolean {
  const { hostname } = new URL(url);
  return LOOPBACK.has(hostname) || hostname.startsWith('127.');
}

/** The installer, piped into sh, for a server. */
export function installCommand(server: string, token: string): string {
  return `curl -fsSL ${server}${RUNNER_INSTALL_SCRIPT_PATH} | sh -s -- --server ${server} --token ${token}`;
}

/** The port of an address: its own, else its protocol's (443 for https, 80 for http). */
export function portOf(url: string): number {
  const { port, protocol } = new URL(url);
  return Number(port || (protocol === 'https:' ? 443 : 80));
}

/**
 * The installer run on the Airia devbox through the company's CLI, from This Mac: `-R` makes the box's
 * `127.0.0.1:<port>` This Mac's API for the install, and the box's runner is enrolled with that address (afterwards
 * This Mac's runner holds the same forward over IAP). No public address is needed.
 */
export function devboxCommand(port: number, token: string): string {
  const forward = `127.0.0.1:${port}:127.0.0.1:${port}`;
  return `airia devbox ssh -- -R ${forward} '${installCommand(`http://127.0.0.1:${port}`, token)}'`;
}

/** The address a container on this machine reaches the server at: a loopback host becomes host.docker.internal. */
export function containerServerUrl(server: string): string {
  if (!isLoopback(server)) return server;
  const url = new URL(server);
  url.hostname = 'host.docker.internal';
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/** The compose command that enrolls and starts the container runner (the server's address only when not its own). */
export function containerCommand(server: string, token: string): string {
  const url = containerServerUrl(server);
  const serverUrl = url === COMPOSE_SERVER_URL ? '' : `MWC_SERVER_URL=${url} `;
  return `${serverUrl}MWC_ENROLL_TOKEN=${token} ${COMPOSE_COMMAND}`;
}

export interface EnrollTokenText {
  readonly company: Pick<MeMembership, 'name' | 'slug'>;
  readonly token: string;
  readonly expiresAt: string;
  /** The server the CLI talks to (This Mac reaches it). */
  readonly server: string;
  /** The API's own address (`/api/config`'s `apiUrl`), whose port the devbox reaches; the server's when unknown. */
  readonly apiUrl: string | null;
}

/** What the devbox's command needs first, and what it does. */
export const DEVBOX_HINT =
  "The Airia devbox (run it on This Mac, after This Mac's runner is installed: that runner keeps the box connected " +
  'afterwards; it starts the box if it is stopped, and the box costs its hourly rate while it is up):';

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
    DEVBOX_HINT,
    `  ${devboxCommand(portOf(t.apiUrl ?? t.server), t.token)}`,
    '',
    'A Docker container on This Mac (from the repository folder):',
    `  ${containerCommand(t.server, t.token)}`,
    '',
  ].join('\n');
}
