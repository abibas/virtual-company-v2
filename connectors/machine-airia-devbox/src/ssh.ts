import type { PowerRef, TunnelPorts } from '@mwc/machines-core';

/**
 * The box's `gcloud compute ssh` commands over Google IAP (docs/machines.md, "Installing a runner" and "Updating a
 * runner"), as argument arrays (no shell here): the standing reverse tunnel, and the runner's reinstall. Plain
 * `gcloud compute ssh` never starts a stopped box (`airia devbox ssh` would). The driver runs neither: it hands them to
 * whoever holds the tunnel or reinstalls the runner.
 */

/**
 * The ssh options of the standing tunnel: no shell on the box (`-N`), an exit when the box's port is taken
 * (`ExitOnForwardFailure`, so the holder retries), a dead link noticed within 45 s, a handshake that hangs given up
 * after 30 s (`ConnectTimeout`, which bounds the banner exchange through gcloud's IAP proxy command too; 2026-11-12,
 * after a flaky link left tries hanging), and never a prompt (`BatchMode`). No `TCPKeepAlive`: ssh talks to the IAP
 * helper over a pipe, so TCP keepalives never reach the link (and it is on by default); `ServerAliveInterval` covers it.
 */
export const TUNNEL_SSH_ARGS: readonly string[] = [
  '-N',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
  '-o',
  'ConnectTimeout=30',
  '-o',
  'BatchMode=yes',
];

/** The ports of a runner's reinstall: the server's own (`apiPort`) and the install's forward on the box (`installPort`). */
export interface RunnerUpdatePorts {
  readonly apiPort: number;
  readonly installPort: number;
}

/** `gcloud compute ssh <box>` over IAP in the project and zone, quiet, up to its `--`. */
const sshTo = (ref: PowerRef, project: string): string[] => [
  'compute',
  'ssh',
  ref.instance,
  '--project',
  project,
  '--zone',
  ref.zone,
  '--tunnel-through-iap',
  '--quiet',
];

/** The standing tunnel: the box's `127.0.0.1:remotePort` forwarded to this machine's `127.0.0.1:localPort`. */
export function tunnelArgs(ref: PowerRef, project: string, ports: TunnelPorts): string[] {
  const forward = `127.0.0.1:${ports.remotePort}:127.0.0.1:${ports.localPort}`;
  return [...sshTo(ref, project), '--strict-host-key-checking=no', '--', ...TUNNEL_SSH_ARGS, '-R', forward];
}

/**
 * The clearing of the box's end of the tunnel: ends, over a one-off session, whatever listens on the box's
 * `remotePort` (`fuser -k -TERM`, with sudo when it may run without a password, else as the user): the stale sshd
 * session of an earlier tunnel whose end the box never noticed. It always succeeds, so the tunnel's next try tells.
 */
export function clearPortArgs(ref: PowerRef, project: string, remotePort: number): string[] {
  const port = String(Math.trunc(remotePort));
  const kill = `fuser -k -TERM -n tcp ${port} 2>/dev/null`;
  return [...sshTo(ref, project), '--command', `sudo -n ${kill} || ${kill}; true`];
}

/**
 * The runner's reinstall: the box's `127.0.0.1:installPort` forwarded to this server's `127.0.0.1:apiPort` while
 * `install.sh` runs there without a token, downloading through it (`--via`) and keeping the enrollment and
 * `--server http://127.0.0.1:apiPort`, the address the standing tunnel serves; the session ends with the install.
 */
export function updateArgs(ref: PowerRef, project: string, ports: RunnerUpdatePorts): string[] {
  const via = `http://127.0.0.1:${ports.installPort}`;
  const install = `curl -fsSL ${via}/api/runner/install.sh | sh -s -- --server http://127.0.0.1:${ports.apiPort} --via ${via}`;
  const forward = `127.0.0.1:${ports.installPort}:127.0.0.1:${ports.apiPort}`;
  return [...sshTo(ref, project), '--', '-o', 'ExitOnForwardFailure=yes', '-R', forward, install];
}
