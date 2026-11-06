import type { MachineKind } from '@mwc/shared/enums';
import { MACHINE_NAME } from '@mwc/shared/machines';
import { type Host, unixUser } from '../install/host.ts';
import { findOnPath } from '../install/paths.ts';

/**
 * What a machine says about itself when it enrolls (docs/runner-protocol.md, "Enrollment"): its kind, system, CPU
 * architecture, host name, the runner's Unix user, and Claude Code's version from one `claude --version` when Claude
 * Code is on the PATH (no process start otherwise).
 */

/** The file Docker puts in every container. */
export const CONTAINER_MARKER = '/.dockerenv';

/** macOS is a laptop (This Mac); a container is one (`/.dockerenv`, or `MWC_RUNNER_IN_CONTAINER=1`); else a VM. */
export function machineKind(host: Host): MachineKind {
  if (host.platform === 'darwin') return 'laptop';
  if (host.env.MWC_RUNNER_IN_CONTAINER === '1' || host.fs.exists(CONTAINER_MARKER)) return 'container';
  return 'vm';
}

/** The longest Claude Code version the protocol takes (`ClaudeVersion`). */
const CLAUDE_VERSION_MAX = 100;

/** The first line `claude --version` prints (`2.1.3 (Claude Code)`), or null without Claude Code or an answer. */
export async function claudeVersion(host: Host): Promise<string | null> {
  const claude = findOnPath('claude', host.env.PATH, host.fs.isExecutable);
  if (claude === undefined) return null;
  const result = await host.exec(claude, ['--version']);
  const line = result.code === 0 ? result.stdout.trim().split('\n')[0]?.trim() : undefined;
  return line ? line.slice(0, CLAUDE_VERSION_MAX) : null;
}

/** The host name without macOS's `.local`. */
export const shortHostname = (hostname: string): string => hostname.replace(/\.local$/i, '');

/** A machine's name unless one is given: the devbox's own, else the short host name (a container's says so). */
export function defaultName(kind: MachineKind, devbox: boolean, hostname: string): string {
  if (devbox) return 'Airia devbox';
  const short = shortHostname(hostname) || 'machine';
  return (kind === 'container' ? `container ${short}` : short).slice(0, MACHINE_NAME.max);
}

export interface MachineFacts {
  readonly kind: MachineKind;
  /** `darwin`, `linux`. */
  readonly os: string;
  /** `arm64`, `x64`. */
  readonly arch: string;
  readonly hostname: string;
  readonly unixUser: string;
  readonly claudeVersion: string | null;
}

/** Everything a machine says about itself but its provider (`devbox.ts`). */
export async function machineFacts(host: Host): Promise<MachineFacts> {
  return {
    kind: machineKind(host),
    os: host.platform,
    arch: host.arch,
    hostname: host.hostname().slice(0, 255),
    unixUser: unixUser(host).slice(0, 64),
    claudeVersion: await claudeVersion(host),
  };
}
