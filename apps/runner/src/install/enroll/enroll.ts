import { dirname } from 'node:path';
import type { MachineKind, MachineProvider } from '@mwc/shared/enums';
import { MACHINE_NAME } from '@mwc/shared/machines';
import {
  ENROLLMENT_TOKEN_PATTERN,
  RUNNER_ENROLL_PATH,
  RUNNER_SLOTS_MAX,
  RunnerEnrollRequest,
  RunnerEnrollResponse,
} from '@mwc/shared/runner-protocol';
import { isServerUrl, type RunnerConfig, runnerConfigPath, writeRunnerConfig } from '../../config.ts';
import { EXIT } from '../../daemon/start.ts';
import { CommandError, type Host } from '../host.ts';
import { detectProvider, NO_PROVIDER } from './devbox.ts';
import { defaultName, machineFacts } from './facts.ts';

/**
 * Enrolling this machine (`mwc-runner enroll`, the first step of `install`, a container's first start): the facts it
 * says about itself, a one-time enrollment token traded at `POST /api/runner/enroll` for its id and runner key, and
 * the runner's configuration written with them (`config.ts`, 0600). The token is never printed or logged.
 */

/** How many runs a machine takes at once unless `--slots` says. */
export const DEFAULT_SLOTS = 2;
/** How long the enrollment call may take. */
export const ENROLL_TIMEOUT_MS = 15_000;

export interface EnrollInput {
  readonly server?: string | undefined;
  /**
   * The address this enrollment reaches the server at, when it is not `server` (install's `--via`: the devbox's own
   * install forward); `server` stays the address saved for the runner.
   */
  readonly via?: string | undefined;
  readonly token?: string | undefined;
  readonly name?: string | undefined;
  /** Text, as the command line or the environment gives it. */
  readonly slots?: string | undefined;
  /** Enroll again although this machine has a configuration (a new machine on the server). */
  readonly force?: boolean | undefined;
}

export interface Enrolled {
  readonly config: RunnerConfig;
  readonly configPath: string;
  readonly kind: MachineKind;
  readonly provider: MachineProvider;
}

const usage = (message: string) => new CommandError(message, EXIT.usage);

/** The server's HTTP address for the runner's server URL (ws becomes http, wss https), without a trailing slash. */
export function httpBase(serverUrl: string): string {
  return serverUrl.replace(/^ws(s?):/, 'http$1:').replace(/\/+$/, '');
}

/** `--via` checked, without a trailing slash; undefined without it. */
export function viaOf(via: string | undefined): string | undefined {
  if (via === undefined) return undefined;
  if (!isServerUrl(via)) {
    throw usage('--via needs the address this install reaches the server at (https://… or http://…)');
  }
  return via.replace(/\/+$/, '');
}

/**
 * The checked input: a server address, the address to enroll through (`--via`, else the server), an enrollment
 * token, a name of 1–80 characters, a slot count.
 */
export function checkInput(input: EnrollInput) {
  const { server, token, name } = input;
  if (!server || !isServerUrl(server))
    throw usage('--server needs the server address (https://… or http://…)');
  const via = viaOf(input.via);
  if (!token || !ENROLLMENT_TOKEN_PATTERN.test(token)) {
    throw usage('--token needs an enrollment token (mwc_et_…; mwc machine enroll-token makes one)');
  }
  const trimmed = name?.trim();
  if (name !== undefined && (!trimmed || trimmed.length > MACHINE_NAME.max)) {
    throw usage(`--name needs ${MACHINE_NAME.min} to ${MACHINE_NAME.max} characters`);
  }
  const slots = input.slots === undefined ? DEFAULT_SLOTS : Number(input.slots);
  if (!Number.isInteger(slots) || slots < 0 || slots > RUNNER_SLOTS_MAX) {
    throw usage(`--slots needs a whole number from 0 to ${RUNNER_SLOTS_MAX}`);
  }
  const base = server.replace(/\/+$/, '');
  return { server: base, via: via ?? base, token, name: trimmed, slots };
}

/** What this machine sends with the token. */
export async function enrollRequest(host: Host, token: string, name?: string): Promise<RunnerEnrollRequest> {
  const facts = await machineFacts(host);
  const provider = facts.kind === 'vm' ? await detectProvider(host) : NO_PROVIDER;
  const request = {
    token,
    name: name ?? defaultName(facts.kind, provider.provider === 'airia_devbox', facts.hostname),
    ...facts,
    runnerVersion: host.version,
    ...provider,
  };
  const parsed = RunnerEnrollRequest.safeParse(request);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new CommandError(`this machine cannot enroll as it is: ${issues.join('; ')}`);
  }
  return parsed.data;
}

/** The error body's message (`{ error: { message } }`), or the status. */
async function refusalOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => undefined)) as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === 'string' ? message : `the server answered ${res.status}`;
}

/** Trades the token at `POST /api/runner/enroll`; a CommandError that says why not. */
export async function postEnroll(host: Host, server: string, request: RunnerEnrollRequest) {
  let res: Response;
  try {
    res = await host.fetch(`${httpBase(server)}${RUNNER_ENROLL_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(ENROLL_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: unknown } }).cause?.code;
    throw new CommandError(
      `cannot reach ${server}: ${(error as Error).message}${typeof cause === 'string' ? ` (${cause})` : ''}`,
    );
  }
  if (res.status === 401) {
    throw new CommandError(
      'the server refused the enrollment token: it is unknown, used or expired (one token enrolls one machine ' +
        'within the hour); make a new one with mwc machine enroll-token',
      EXIT.unauthorized,
    );
  }
  if (res.status !== 201) throw new CommandError(`${server} refused the enrollment: ${await refusalOf(res)}`);
  const parsed = RunnerEnrollResponse.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new CommandError(`${server} does not answer like the mwc API`);
  return parsed.data;
}

/** Enrolls this machine and writes the runner's configuration; a CommandError (with its exit code) when it cannot. */
export async function enrollMachine(host: Host, input: EnrollInput): Promise<Enrolled> {
  const { server, via, token, name, slots } = checkInput(input);
  const configPath = runnerConfigPath(host.env);
  if (host.fs.exists(configPath) && !input.force) {
    throw new CommandError(
      `this machine is already enrolled (${configPath}). Pass --force to enroll it again as a new machine, or run ` +
        'install without --token to reinstall the service with the enrollment it has.',
    );
  }
  // The folder first: a configuration that cannot be written would lose the key the token is traded for.
  host.fs.mkdir(dirname(configPath), 0o700);
  const request = await enrollRequest(host, token, name);
  const enrolled = await postEnroll(host, via, request);
  const config: RunnerConfig = { serverUrl: server, ...enrolled, name: request.name, slots };
  try {
    writeRunnerConfig(configPath, config);
  } catch (error) {
    throw new CommandError(`cannot write ${configPath}: ${(error as Error).message}`, EXIT.config);
  }
  return { config, configPath, kind: request.kind, provider: request.provider };
}
