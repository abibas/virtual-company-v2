/** The commands that install a runner with an enrollment token (docs/machines.md, "Installing a runner"; pure). */

/** The machines the add sheet offers. */
export type NewMachineKind = 'mac' | 'devbox' | 'container';

export type InstallCommand =
  | { readonly kind: 'command'; readonly command: string }
  /** No command yet: what to do first. */
  | { readonly kind: 'note'; readonly note: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** True for an address only this computer reaches (localhost and its kin). */
export function isLocalAddress(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return LOCAL_HOSTS.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return true;
  }
}

/** The installer run on a machine that reaches the server at `url`. */
const curlInstall = (url: string, token: string) =>
  `curl -fsSL ${url}/api/runner/install.sh | sh -s -- --server ${url} --token ${token}`;

/**
 * The command for a kind of machine: This Mac with the API's address; the devbox over `airia devbox ssh` with the
 * public address (none while the server knows only a local one); the container through compose.
 */
export function installCommand(
  kind: NewMachineKind,
  token: string,
  config: { readonly apiUrl: string; readonly publicUrl: string | null },
): InstallCommand {
  if (kind === 'mac') return { kind: 'command', command: curlInstall(config.apiUrl, token) };
  if (kind === 'container') {
    return {
      kind: 'command',
      command: `MWC_ENROLL_TOKEN=${token} docker compose -f deploy/compose.yml --profile runner up -d runner-local`,
    };
  }
  if (config.publicUrl === null || isLocalAddress(config.publicUrl)) {
    return { kind: 'note', note: 'Set MWC_PUBLIC_URL to your ngrok address first' };
  }
  return { kind: 'command', command: `airia devbox ssh -- '${curlInstall(config.publicUrl, token)}'` };
}

/** Where to run it and what it installs, under the command. */
export const COMMAND_HINTS: Readonly<Record<NewMachineKind, string>> = {
  mac: 'Run it in a Terminal on this Mac. It installs the runner as a launchd agent; it needs Node 22 or newer.',
  devbox:
    'Run it on this Mac; it installs the runner on the box as a systemd user service. The box costs its hourly rate while it is up.',
  container: 'Run it in the repository folder. It starts the runner-local service from deploy/compose.yml.',
};
