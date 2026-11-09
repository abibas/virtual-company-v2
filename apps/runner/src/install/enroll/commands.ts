import type { Log } from '../../system/log.ts';
import { CommandError, type Host } from '../host.ts';
import { type Enrolled, type EnrollInput, enrollMachine } from './enroll.ts';

/**
 * `mwc-runner enroll` for a person, and a container's first start (`MWC_ENROLL_TOKEN` and `MWC_SERVER_URL` in the
 * environment and no configuration yet), which enrolls the container before its runner starts.
 */

/** What enrolling did, in a sentence. */
export function enrolledText(enrolled: Enrolled): string {
  const { config, configPath, kind, provider } = enrolled;
  const powered = provider === 'none' ? kind : `${kind}, ${provider}`;
  return (
    `Enrolled this machine as "${config.name}" (${powered}), machine ${config.machineId}, on ${config.serverUrl}. ` +
    `Its runner key is in ${configPath} (readable by you only).\n`
  );
}

/** `mwc-runner enroll --server <url> --token <mwc_et_…> [--name <name>] [--slots <n>] [--force]`. */
export async function enrollCommand(host: Host, input: EnrollInput): Promise<number> {
  const enrolled = await enrollMachine(host, input);
  host.out(enrolledText(enrolled));
  host.out(`Run it as a service with: ${host.execPath} ${host.selfPath} install\n`);
  return 0;
}

/**
 * Enrolls a container on its first start; undefined when there is nothing to do or it enrolled, else the exit code
 * (the reason logged). An empty variable counts as unset.
 */
export async function enrollOnFirstBoot(
  host: Host,
  configPath: string,
  log: Log,
): Promise<number | undefined> {
  const { MWC_ENROLL_TOKEN: token, MWC_SERVER_URL: server } = host.env;
  if (host.fs.exists(configPath) || !token || !server) return undefined;
  log.info('enrolling this machine on its first start', { server });
  try {
    const enrolled = await enrollMachine(host, {
      server,
      token,
      name: host.env.MWC_RUNNER_NAME || undefined,
      slots: host.env.MWC_RUNNER_SLOTS || undefined,
    });
    const { machineId, name } = enrolled.config;
    log.info('enrolled', { machineId, name, kind: enrolled.kind, configPath });
    return undefined;
  } catch (error) {
    log.error(`cannot enroll this machine: ${(error as Error).message}`);
    return error instanceof CommandError ? error.code : 1;
  }
}
