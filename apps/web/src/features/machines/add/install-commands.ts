/** The commands that install a runner with an enrollment token (docs/machines.md, "Installing a runner"; pure). */

import {
  type ContainerRunnerSettings,
  containerRunnerCommand,
  DEFAULT_CONTAINER_RUNNER,
} from '@mwc/shared/container-runner';
import { INSTALL_PORT } from '@mwc/shared/ports';

/** The machines the add sheet offers. */
export type NewMachineKind = 'mac' | 'devbox' | 'container';

/** The port of an address: its own, else its protocol's (443 for https, 80 for http). */
export function portOf(url: string): number {
  const { port, protocol } = new URL(url);
  return Number(port || (protocol === 'https:' ? 443 : 80));
}

/** The installer run on a machine that reaches the server at `url` (downloading and enrolling through `via`). */
function curlInstall(url: string, token: string, via?: string): string {
  const through = via === undefined ? '' : ` --via ${via}`;
  return `curl -fsSL ${via ?? url}/api/runner/install.sh | sh -s -- --server ${url}${through} --token ${token}`;
}

/**
 * The devbox's installer, run on this Mac: `airia devbox ssh` with a reverse forward that makes the box's
 * `127.0.0.1:9954` (INSTALL_PORT) this Mac's API for the install's downloads and enroll (`--via`); the box's runner
 * keeps `127.0.0.1:<port>`, which the standing tunnel serves (the server's, or This Mac's runner's), so the install's
 * session ends with it.
 */
export function devboxCommand(port: number, token: string): string {
  const install = curlInstall(`http://127.0.0.1:${port}`, token, `http://127.0.0.1:${INSTALL_PORT}`);
  return `airia devbox ssh -- -R 127.0.0.1:${INSTALL_PORT}:127.0.0.1:${port} '${install}'`;
}

/**
 * The command for a kind of machine: This Mac with the API's address; the devbox over `airia devbox ssh` with the
 * port of the API's address (no public address needed); the container through compose, in its own compose project
 * with the chosen limits, naming the server's compose file by its absolute path when the server knows it.
 */
export function installCommand(
  kind: NewMachineKind,
  token: string,
  config: { readonly apiUrl: string; readonly composeFile: string | null },
  container: ContainerRunnerSettings = DEFAULT_CONTAINER_RUNNER,
): string {
  if (kind === 'mac') return curlInstall(config.apiUrl, token);
  if (kind === 'devbox') return devboxCommand(portOf(config.apiUrl), token);
  return containerRunnerCommand({
    ...container,
    token,
    composeFile: config.composeFile,
    server: config.apiUrl,
  });
}

/** Where to run it and what it installs, under the command. */
export const COMMAND_HINTS: Readonly<Record<NewMachineKind, string>> = {
  mac: 'Run it in a Terminal on this Mac. It installs the runner as a launchd agent; it needs Node 22 or newer.',
  devbox:
    "Run it on this Mac, after This Mac's runner is installed: that runner keeps the box connected afterwards. It " +
    'installs the runner on the box as a systemd user service. It starts the box if it is stopped, and the box costs ' +
    "its hourly rate while it is up. The box connects once This Mac's runner holds its tunnel.",
  container:
    'Run it in the repository folder. It starts the runner in its own compose project, with its own state volume, ' +
    'from deploy/compose.yml.',
};

/** The container's hint when the server names its compose file by its absolute path (`composeFile`). */
const CONTAINER_HINT_ANYWHERE =
  'Run it in a Terminal on this Mac, from any folder. It starts the runner in its own compose project, with its own ' +
  "state volume, from the repository's deploy/compose.yml.";

/** The devbox's hint when the server drives the airia CLI itself (`localPower`): no runner on this Mac is needed. */
const DEVBOX_HINT_SERVER =
  'Run it on this Mac. It installs the runner on the box as a systemd user service. It starts the box if it is ' +
  'stopped, and the box costs its hourly rate while it is up. The box connects once the server holds its tunnel.';

/** The hint for a kind of machine, as the server powers the devbox (`localPower`) and knows its compose file. */
export function commandHint(
  kind: NewMachineKind,
  config: { readonly localPower: boolean; readonly composeFile: string | null },
): string {
  if (kind === 'devbox' && config.localPower) return DEVBOX_HINT_SERVER;
  if (kind === 'container' && config.composeFile !== null) return CONTAINER_HINT_ANYWHERE;
  return COMMAND_HINTS[kind];
}
