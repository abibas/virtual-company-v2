import { COMPOSE_FILE_RELATIVE, containerRunnerProject, shellWord } from '@mwc/shared/container-runner';
import type { MachineKind, MachineProvider } from '@mwc/shared/enums';
import { INSTALL_PORT } from '@mwc/shared/ports';
import { type Refusal, refuse } from '../rules.ts';

/**
 * A machine's runner as the machines API shows it, and how to update one (docs/machines.md, "Updating a runner"; pure):
 * whether it runs the build this server hands out, and, for a runner that cannot update itself and that this server
 * cannot reinstall, the command a person runs instead.
 */

/** The runner of a machine: its version, its build, whether that is the served one, and what it can do. */
export interface RunnerFacts {
  /** The version it runs: its connection's, else the one on record from its last hello. */
  readonly version: string;
  /** When its bundle was built (UTC, ISO 8601); null offline, from its sources or from an older runner. */
  readonly builtAt: string | null;
  /** The SHA-256 of the bundle it runs; null when it is not connected, runs from its sources or did not say. */
  readonly build: string | null;
  /** True when it runs the served bundle, false when another; null when either side is unknown. */
  readonly current: boolean | null;
  /** It opens terminals (`caps.terminal`); false while it is not connected. */
  readonly terminal: boolean;
  /** It updates itself over its link (`caps.selfUpdate`); false while it is not connected. */
  readonly selfUpdate: boolean;
}

/** What the hub knows of a connected runner, as far as these facts go. */
export interface ConnectedFacts {
  readonly version: string;
  readonly builtAt: string | null;
  readonly build: string | null;
  readonly caps: { readonly terminal: boolean; readonly selfUpdate: boolean };
}

/**
 * The runner's facts from its connection (none while offline), the build this server hands out (null unbuilt) and the
 * version on record (`recorded`, from its last hello). `current` compares builds only, never versions.
 */
export function runnerFacts(
  connected: ConnectedFacts | undefined,
  served: string | null,
  recorded: string,
): RunnerFacts {
  const build = connected?.build ?? null;
  return {
    version: connected?.version ?? recorded,
    builtAt: connected?.builtAt ?? null,
    build,
    current: build === null || served === null ? null : build === served,
    terminal: connected?.caps.terminal ?? false,
    selfUpdate: connected?.caps.selfUpdate ?? false,
  };
}

/** The port of an address: its own, else its protocol's (443 for https, 80 for http). */
export function portOf(url: string): number {
  const { port, protocol } = new URL(url);
  return Number(port || (protocol === 'https:' ? 443 : 80));
}

/** Where a person runs a runner's update command, and the command itself. */
export interface ManualUpdate {
  readonly command: string;
  readonly where: string;
}

/**
 * The command that updates a runner by hand, by machine (its install command without a token, which keeps the
 * enrollment): a container's image rebuilt in its own compose project (`mwc-runner-<slug of its name>`, as the add
 * sheet started it) from the compose file's absolute path when the server knows it; the devbox's install run on This
 * Mac through `airia devbox ssh` with the install's own forward; any other machine's `install.sh` piped from the API.
 */
export function manualUpdate(
  machine: { readonly kind: MachineKind; readonly provider: MachineProvider; readonly name: string },
  at: { readonly apiUrl: string; readonly composeFile: string | null },
): ManualUpdate {
  const { apiUrl } = at;
  if (machine.kind === 'container') {
    const file = at.composeFile === null ? COMPOSE_FILE_RELATIVE : shellWord(at.composeFile);
    return {
      command: `docker compose -p ${containerRunnerProject(machine.name)} -f ${file} --profile runner up -d --build runner-local`,
      where:
        at.composeFile === null
          ? 'in the repository folder: it rebuilds the container with the new runner, keeping its enrollment and volumes'
          : 'in a Terminal on the computer running Docker: it rebuilds the container with the new runner, keeping its enrollment and volumes',
    };
  }
  if (machine.provider === 'airia_devbox') {
    const port = portOf(apiUrl);
    const via = `http://127.0.0.1:${INSTALL_PORT}`;
    const install = `curl -fsSL ${via}/api/runner/install.sh | sh -s -- --server http://127.0.0.1:${port} --via ${via}`;
    return {
      command: `airia devbox ssh -- -R 127.0.0.1:${INSTALL_PORT}:127.0.0.1:${port} '${install}'`,
      where: 'in a Terminal on This Mac: it reinstalls the runner on the box, keeping its enrollment',
    };
  }
  return {
    command: `curl -fsSL ${apiUrl}/api/runner/install.sh | sh -s -- --server ${apiUrl}`,
    where: 'in a Terminal on that machine: it reinstalls the runner, keeping its enrollment',
  };
}

/** A refusal that comes with the command to run instead. */
export interface UnsupportedUpdate extends Refusal<409> {
  readonly command: string;
}

/** Neither path updates this runner: it cannot update itself, and this server cannot reinstall it. */
export function updateUnsupported(manual: ManualUpdate): UnsupportedUpdate {
  return {
    ...refuse(
      409,
      'update_unsupported',
      `This runner cannot update itself from here. Run this ${manual.where}.`,
    ),
    command: manual.command,
  };
}

/** The runner refused: it has live work. */
export const runnerBusy = (why: string): Refusal<409> =>
  refuse(409, 'runner_busy', `The runner is busy and kept its build: ${why}`);

/** The update was tried and failed; the runner goes on as it was. */
export const updateFailed = (why: string): Refusal<502> =>
  refuse(502, 'update_failed', `The runner was not updated: ${why.slice(0, 500)}`);
