import {
  type DiscoveredMachine,
  type MachinePowerDriver,
  MachinePowerError,
  type PowerReading,
  type PowerRef,
  type ProcessCommand,
  type TunnelPorts,
} from '@mwc/machines-core';
import { isTimeZone, type PowerStatus } from '@mwc/shared/machines';
import { accountFrom, boxNameOf, ownerSlug } from './account.ts';
import { errorOf, spawnErrorOf } from './errors.ts';
import { parseInstance, parseInstances, readingOf, refOf } from './instance.ts';
import type { CommandRun, RunResult } from './run.ts';
import { type RunnerUpdatePorts, tunnelArgs, updateArgs } from './ssh.ts';

/** The airia CLI's GCP project. */
export const DEVBOX_PROJECT = 'airia-devbox';
/** How long `start` and `stop` may take (`airia devbox up --no-wait` re-pushes the box's scripts first). */
export const POWER_TIMEOUT_MS = 180_000;
/** How long every other command may take. */
export const QUERY_TIMEOUT_MS = 30_000;

export interface AiriaDevboxDriverOptions {
  /** Runs the commands; `processRun()` on a controller, a fake in tests. */
  readonly run: CommandRun;
  /** The airia CLI's command or path; defaults to `airia`. */
  readonly airia?: string;
  /** gcloud's command or path; defaults to `gcloud`. */
  readonly gcloud?: string;
  /** Defaults to `DEVBOX_PROJECT`. */
  readonly project?: string;
  readonly powerTimeoutMs?: number;
  readonly queryTimeoutMs?: number;
  /** The environment of the tunnel's process (`runEnv`'s, as the commands get); the runner's own when left out. */
  readonly env?: Readonly<Record<string, string>>;
}

const UP: readonly PowerStatus[] = ['running', 'starting'];
const DOWN: readonly PowerStatus[] = ['stopped', 'stopping'];

/**
 * The Airia devbox's power, with the signed-in user's own gcloud and airia CLI (docs/machines.md): `start` is
 * `airia devbox up --no-wait`, `stop` is `airia devbox stop`, everything else is read or written with gcloud. The CLI
 * acts on the signed-in account's own box (`dev-<slug>`) and creates one when there is none, so `start` and `stop`
 * check first that the box exists and is that box, and never run the CLI for any other.
 */
export class AiriaDevboxDriver implements MachinePowerDriver {
  readonly provider = 'airia_devbox' as const;
  readonly #run: CommandRun;
  readonly #airia: string;
  readonly #gcloud: string;
  readonly #project: string;
  readonly #powerTimeoutMs: number;
  readonly #queryTimeoutMs: number;
  readonly #env: Readonly<Record<string, string>> | undefined;

  constructor(options: AiriaDevboxDriverOptions) {
    this.#run = options.run;
    this.#airia = options.airia ?? 'airia';
    this.#gcloud = options.gcloud ?? 'gcloud';
    this.#project = options.project ?? DEVBOX_PROJECT;
    this.#powerTimeoutMs = options.powerTimeoutMs ?? POWER_TIMEOUT_MS;
    this.#queryTimeoutMs = options.queryTimeoutMs ?? QUERY_TIMEOUT_MS;
    this.#env = options.env;
  }

  async discover(): Promise<DiscoveredMachine[]> {
    const slug = ownerSlug(await this.#account());
    const filter = `labels.managed-by=devbox AND labels.owner=${slug}`;
    const listed = await this.#gcloudOk('Listing the devboxes', [
      'compute',
      'instances',
      'list',
      '--project',
      this.#project,
      '--filter',
      filter,
      '--format=json',
    ]);
    const found: DiscoveredMachine[] = [];
    for (const instance of parseInstances(listed.stdout)) {
      const ref = refOf(instance);
      if (ref !== null) found.push({ ref, ...readingOf(instance) });
    }
    return found;
  }

  async status(ref: PowerRef): Promise<PowerReading> {
    const result = await this.#exec(this.#gcloud, [...this.#instanceArgs('describe', ref), '--format=json']);
    if (result.exitCode !== 0) {
      const error = errorOf(result, 'Reading the box');
      if (error.code === 'not_found') return { status: 'missing', rules: null };
      throw error;
    }
    return readingOf(parseInstance(result.stdout));
  }

  async start(ref: PowerRef): Promise<PowerReading> {
    return this.#power(ref, UP, ['devbox', 'up', '--no-wait'], 'Starting the box');
  }

  async stop(ref: PowerRef): Promise<PowerReading> {
    return this.#power(ref, DOWN, ['devbox', 'stop'], 'Stopping the box');
  }

  async setTimezone(ref: PowerRef, timezone: string): Promise<PowerReading> {
    if (!isTimeZone(timezone)) throw new MachinePowerError('failed', `“${timezone}” is not a time zone.`);
    await this.#gcloudOk('Setting the box’s time zone', [
      ...this.#instanceArgs('add-metadata', ref),
      '--metadata',
      `devbox-tz=${timezone}`,
    ]);
    return this.status(ref);
  }

  /**
   * The box's standing reverse tunnel over Google IAP (docs/machines.md, "Installing a runner"): plain
   * `gcloud compute ssh`, which never starts a stopped box (`airia devbox ssh` would), with the box's
   * `127.0.0.1:remotePort` forwarded to this machine's `127.0.0.1:localPort`. Nothing runs here.
   */
  tunnelCommand(ref: PowerRef, ports: TunnelPorts): ProcessCommand {
    return this.#gcloudCommand(tunnelArgs(ref, this.#project, ports));
  }

  /**
   * The reinstall of the box's runner, for a runner too old to update itself (docs/machines.md, "Updating a runner"):
   * plain `gcloud compute ssh` over IAP (it never starts a stopped box), whose reverse forward makes the box's
   * `127.0.0.1:installPort` this server's `127.0.0.1:apiPort` while `install.sh` runs there without a token, so the
   * runner keeps its enrollment and `--server http://127.0.0.1:apiPort`, the address the standing tunnel serves. Nothing
   * runs here.
   */
  updateCommand(ref: PowerRef, ports: RunnerUpdatePorts): ProcessCommand {
    return this.#gcloudCommand(updateArgs(ref, this.#project, ports));
  }

  /** A long-lived gcloud process: by its path, with the commands' environment when the driver was given one. */
  #gcloudCommand(args: string[]): ProcessCommand {
    return { command: this.#gcloud, args, ...(this.#env === undefined ? {} : { env: this.#env }) };
  }

  /** Runs the airia CLI for the box unless it is already `there` (the reading then says `already`), then reads it again. */
  async #power(
    ref: PowerRef,
    there: readonly PowerStatus[],
    args: string[],
    what: string,
  ): Promise<PowerReading> {
    const before = await this.status(ref);
    if (before.status === 'missing') {
      throw new MachinePowerError(
        'not_found',
        `There is no devbox named ${ref.instance} in ${ref.zone}. Create it yourself with \`airia devbox up\`.`,
      );
    }
    if (there.includes(before.status)) return { ...before, already: true };
    const own = boxNameOf(await this.#account());
    if (own !== ref.instance) {
      throw new MachinePowerError(
        'failed',
        `The airia CLI powers only ${own}, the box of the signed-in gcloud account, not ${ref.instance}.`,
      );
    }
    await this.#ok(this.#airia, args, what, this.#powerTimeoutMs);
    return this.status(ref);
  }

  /** The signed-in gcloud account; `needs_gcloud_login` when there is none. */
  async #account(): Promise<string> {
    const result = await this.#gcloudOk('Reading the gcloud account', ['config', 'get-value', 'account']);
    const account = accountFrom(result.stdout);
    if (account === null || ownerSlug(account) === '') throw new MachinePowerError('needs_gcloud_login');
    return account;
  }

  #instanceArgs(verb: 'describe' | 'add-metadata', ref: PowerRef): string[] {
    return ['compute', 'instances', verb, ref.instance, '--project', this.#project, '--zone', ref.zone];
  }

  #gcloudOk(what: string, args: string[]): Promise<RunResult> {
    return this.#ok(this.#gcloud, args, what, this.#queryTimeoutMs);
  }

  async #ok(command: string, args: string[], what: string, timeoutMs: number): Promise<RunResult> {
    const result = await this.#exec(command, args, timeoutMs);
    if (result.exitCode !== 0) throw errorOf(result, what);
    return result;
  }

  /** Runs a command; a timeout or a missing tool rejects here, any other exit code is the caller's to read. */
  async #exec(command: string, args: string[], timeoutMs = this.#queryTimeoutMs): Promise<RunResult> {
    let result: RunResult;
    try {
      result = await this.#run(command, args, { timeoutMs });
    } catch (error) {
      throw spawnErrorOf(error, command);
    }
    if (result.timedOut || result.exitCode === 127) throw errorOf(result, command);
    return result;
  }
}
