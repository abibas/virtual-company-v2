/** The commands that install a runner with an enrollment token (docs/machines.md, "Installing a runner"; pure). */

/** The machines the add sheet offers. */
export type NewMachineKind = 'mac' | 'devbox' | 'container';

/** The port of an address: its own, else its protocol's (443 for https, 80 for http). */
export function portOf(url: string): number {
  const { port, protocol } = new URL(url);
  return Number(port || (protocol === 'https:' ? 443 : 80));
}

/** The installer run on a machine that reaches the server at `url`. */
const curlInstall = (url: string, token: string) =>
  `curl -fsSL ${url}/api/runner/install.sh | sh -s -- --server ${url} --token ${token}`;

/**
 * The devbox's installer, run on this Mac: `airia devbox ssh` with a reverse forward that makes the box's
 * `127.0.0.1:<port>` this Mac's API for the install, and the box's runner enrolled with that address (afterwards This
 * Mac's runner holds the same forward over IAP).
 */
export function devboxCommand(port: number, token: string): string {
  const local = `http://127.0.0.1:${port}`;
  return `airia devbox ssh -- -R 127.0.0.1:${port}:127.0.0.1:${port} '${curlInstall(local, token)}'`;
}

/**
 * The command for a kind of machine: This Mac with the API's address; the devbox over `airia devbox ssh` with the
 * port of the API's address (no public address needed); the container through compose.
 */
export function installCommand(
  kind: NewMachineKind,
  token: string,
  config: { readonly apiUrl: string },
): string {
  if (kind === 'mac') return curlInstall(config.apiUrl, token);
  if (kind === 'devbox') return devboxCommand(portOf(config.apiUrl), token);
  return `MWC_ENROLL_TOKEN=${token} docker compose -f deploy/compose.yml --profile runner up -d runner-local`;
}

/** Where to run it and what it installs, under the command. */
export const COMMAND_HINTS: Readonly<Record<NewMachineKind, string>> = {
  mac: 'Run it in a Terminal on this Mac. It installs the runner as a launchd agent; it needs Node 22 or newer.',
  devbox:
    "Run it on this Mac, after This Mac's runner is installed: that runner keeps the box connected afterwards. It " +
    'installs the runner on the box as a systemd user service. It starts the box if it is stopped, and the box costs ' +
    'its hourly rate while it is up.',
  container: 'Run it in the repository folder. It starts the runner-local service from deploy/compose.yml.',
};
