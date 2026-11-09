import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { RunnerPtyTarget } from '@mwc/shared/runner-protocol';
import { machineKind } from '../install/enroll/facts.ts';
import { type Host, homeOf } from '../install/host.ts';
import { SERVICE_MANAGER_ENV } from '../install/launchd.ts';
import { installedBundle } from '../install/paths.ts';
import { ptyTarget } from '../terminal/loader.ts';

/**
 * Which build a runner runs, and whether it can update itself (docs/machines.md, "Updating a runner"): the build is the
 * SHA-256 of the `runner.mjs` it was started from, hashed once at start and said in `runner.hello`, so the server tells
 * an old runner from a current one (every bundle says version 0.1.0). Only an installed copy that its service manager
 * restarts updates itself (`caps.selfUpdate`).
 */

/** A SHA-256 in lower-case hex, as `install.sh` and the server compute it. */
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The build this runner runs: its bundle's SHA-256; null from the sources (`main.ts`) or a bundle it cannot read. */
export function runnerBuild(host: Pick<Host, 'selfPath' | 'fs'>): string | null {
  if (!host.selfPath.endsWith('.mjs')) return null;
  try {
    return sha256(host.fs.readBytes(host.selfPath));
  } catch {
    return null;
  }
}

/** The service managers that restart a runner after it exits for its update. */
export type ServiceKind = 'launchd' | 'systemd';

/** Where an installed runner updates itself: its service manager, its bundle and its system's PTY (none built for it). */
export interface UpdateTarget {
  readonly manager: ServiceKind;
  /** `~/.local/share/mwc-runner/runner.mjs`, the file it runs. */
  readonly bundle: string;
  readonly pty: RunnerPtyTarget | undefined;
}

/**
 * The runner's update target when it can update itself: it runs the installed copy (`install`'s
 * `~/.local/share/mwc-runner/runner.mjs`) under launchd or systemd (their service files say which in
 * `MWC_RUNNER_SERVICE`), which start it again when it exits; never in a container (its image is rebuilt) or from the
 * sources. Undefined otherwise.
 */
export function updateTarget(host: Host): UpdateTarget | undefined {
  const manager = host.env[SERVICE_MANAGER_ENV];
  if (manager !== 'launchd' && manager !== 'systemd') return undefined;
  if (machineKind(host) === 'container') return undefined;
  const bundle = installedBundle(host.env, homeOf(host));
  if (resolve(host.selfPath) !== bundle) return undefined;
  return { manager, bundle, pty: ptyTarget(host.platform, host.arch) };
}
