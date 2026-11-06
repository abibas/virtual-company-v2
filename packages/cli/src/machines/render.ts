/**
 * What `mwc machine enroll-token` prints: the token and, for each kind of machine, the one command that installs a
 * runner with it (docs/machines.md, "Installing a runner"). Pure text from the server's addresses and the token.
 */
import { RUNNER_INSTALL_SCRIPT_PATH } from '@mwc/shared/runner-protocol';
import type { MeMembership } from '../api/session.ts';

/** The compose service of the container runner, and the server address it has unless told another. */
export const COMPOSE_COMMAND = 'docker compose -f deploy/compose.yml --profile runner up -d runner-local';
export const COMPOSE_SERVER_URL = 'http://host.docker.internal:9950';

/** A placeholder for the public address a server without MWC_PUBLIC_URL does not know. */
export const PUBLIC_PLACEHOLDER = 'https://<your public address>';

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

/** The installer run on the Airia devbox through the company's CLI, from This Mac. */
export function devboxCommand(server: string, token: string): string {
  return `airia devbox ssh -- '${installCommand(server, token)}'`;
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
  /** The server's public address (MWC_PUBLIC_URL), null when it has none. */
  readonly publicUrl: string | null;
}

/** The token, then the command for This Mac, the Airia devbox and a container. */
export function enrollTokenText(t: EnrollTokenText): string {
  const reachable = t.publicUrl !== null && !isLoopback(t.publicUrl);
  const devbox = reachable
    ? 'The Airia devbox (you run it on This Mac; the box reaches the server at its public address):'
    : "The Airia devbox (you run it on This Mac): the box needs the server's public address, which this server does not " +
      'know. Set MWC_PUBLIC_URL to it (the ngrok static domain), restart the server, and run:';
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
    devbox,
    `  ${devboxCommand(reachable ? (t.publicUrl as string) : PUBLIC_PLACEHOLDER, t.token)}`,
    '',
    'A Docker container on This Mac (from the repository folder):',
    `  ${containerCommand(t.server, t.token)}`,
    '',
  ].join('\n');
}
