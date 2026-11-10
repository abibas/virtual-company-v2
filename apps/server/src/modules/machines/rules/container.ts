import { z } from 'zod';

/**
 * A container runner as Docker describes it, and how this server rebuilds it (docs/machines.md, "Updating a runner";
 * pure). The add sheet starts each container runner as the `runner-local` service of its own compose project
 * (`mwc-runner-<slug>`); its labels name the project, the compose files and the folder it was started from, and its
 * limits and three settings are read back so the rebuild recreates it as it was. Nothing else is read from its
 * environment (it still holds its used enrollment token, which never leaves Docker).
 */

/** The compose service every container runner is. */
export const RUNNER_SERVICE = 'runner-local';

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const FILES_LABEL = 'com.docker.compose.project.config_files';
const FOLDER_LABEL = 'com.docker.compose.project.working_dir';

/** The settings the compose service reads that are kept across a rebuild: the only values read from its environment. */
export const KEPT_SETTINGS = ['MWC_SERVER_URL', 'MWC_RUNNER_NAME', 'MWC_RUNNER_SLOTS'] as const;
type KeptSetting = (typeof KEPT_SETTINGS)[number];

/** A container runner, as far as its rebuild needs. */
export interface RunnerContainer {
  /** Its id, short (12 hex digits). */
  readonly id: string;
  readonly project: string;
  /** The compose files it was started with, by their absolute paths. */
  readonly files: readonly string[];
  /** The folder compose ran in (its project directory); null when the label is missing. */
  readonly folder: string | null;
  /** Docker's CPU limit in billionths of a CPU (0: none). */
  readonly nanoCpus: number;
  /** Docker's memory limit in bytes (0: none). */
  readonly memory: number;
  readonly settings: Readonly<Partial<Record<KeptSetting, string>>>;
  /** Docker's state of it (`running`, `exited`, `created`, `restarting`, `paused`, `removing`, `dead`). */
  readonly state: string;
  /** Its health check's state (`starting`, `healthy`, `unhealthy`); null without one or while it is not running. */
  readonly health: string | null;
  /** How long `docker stop` waits before SIGKILL (compose's `stop_grace_period`), in seconds; null when unset. */
  readonly stopTimeout: number | null;
}

const Inspected = z
  .array(
    z.object({
      Id: z.string().regex(/^[0-9a-f]{12,64}$/),
      State: z.object({ Status: z.string(), Health: z.object({ Status: z.string() }).nullish() }).nullish(),
      Config: z.object({
        Labels: z.record(z.string(), z.string()).nullish(),
        Env: z.array(z.string()).nullish(),
        StopTimeout: z.number().int().nullish(),
      }),
      HostConfig: z.object({ NanoCpus: z.number().nullish(), Memory: z.number().nullish() }),
    }),
  )
  .min(1);

/** A project name compose accepts, under the runners' prefix (`containerRunnerProject`), so never an option. */
const PROJECT = /^mwc-runner-[a-z0-9][a-z0-9_-]*$/;

/** The kept settings from `KEY=value` entries; every other entry is skipped unread. */
function keptSettings(env: readonly string[]): Partial<Record<KeptSetting, string>> {
  const settings: Partial<Record<KeptSetting, string>> = {};
  for (const entry of env) {
    const key = KEPT_SETTINGS.find((name) => entry.startsWith(`${name}=`));
    if (key !== undefined) settings[key] = entry.slice(key.length + 1);
  }
  return settings;
}

/**
 * The container runner in `docker inspect`'s answer, or undefined when it is none: not the `runner-local` service of a
 * runners' project, or started from compose files other than `composeFile` (this server's own deploy/compose.yml, when
 * it knows it; else any absolute paths).
 */
export function runnerContainerOf(stdout: string, composeFile: string | null): RunnerContainer | undefined {
  let parsed: z.infer<typeof Inspected>;
  try {
    parsed = Inspected.parse(JSON.parse(stdout));
  } catch {
    return undefined;
  }
  const [first] = parsed;
  if (first === undefined) return undefined;
  const labels = first.Config.Labels ?? {};
  const project = labels[PROJECT_LABEL] ?? '';
  const files = (labels[FILES_LABEL] ?? '').split(',').filter((file) => file !== '');
  const folder = labels[FOLDER_LABEL] ?? null;
  if (labels[SERVICE_LABEL] !== RUNNER_SERVICE || !PROJECT.test(project)) return undefined;
  const absolute = (path: string) => path.startsWith('/');
  if (files.length === 0 || !files.every(absolute) || (folder !== null && !absolute(folder)))
    return undefined;
  if (composeFile !== null && (files.length !== 1 || files[0] !== composeFile)) return undefined;
  return {
    id: first.Id.slice(0, 12),
    project,
    files,
    folder,
    nanoCpus: first.HostConfig.NanoCpus ?? 0,
    memory: first.HostConfig.Memory ?? 0,
    settings: keptSettings(first.Config.Env ?? []),
    state: first.State?.Status ?? 'unknown',
    health: first.State?.Health?.Status ?? null,
    stopTimeout: first.Config.StopTimeout ?? null,
  };
}

/** `docker inspect` of one container. */
export const inspectArgs = (id: string): string[] => ['inspect', '--type', 'container', id];

/** `docker ps` of a project's runner container, running or not: its ids, one per line. */
export const projectArgs = (project: string): string[] => [
  'ps',
  '--all',
  '--filter',
  `label=${PROJECT_LABEL}=${project}`,
  '--filter',
  `label=${SERVICE_LABEL}=${RUNNER_SERVICE}`,
  '--format',
  '{{.ID}}',
];

/** The ids `docker ps --format {{.ID}}` printed. */
export const idsOf = (stdout: string): string[] =>
  stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9a-f]{12,64}$/.test(line));

/** Docker's CPU limit as compose's `cpus` (2, 1.5); undefined without one. */
export function cpusValue(nanoCpus: number): string | undefined {
  return nanoCpus > 0 ? String(Math.round(nanoCpus / 1e7) / 100) : undefined;
}

/** Docker's memory limit as compose's `mem_limit` (`4g`, `1536m`, `1000b`); undefined without one. */
export function memoryValue(bytes: number): string | undefined {
  if (bytes <= 0) return undefined;
  const mib = 1024 * 1024;
  if (bytes % (1024 * mib) === 0) return `${bytes / (1024 * mib)}g`;
  return bytes % mib === 0 ? `${bytes / mib}m` : `${bytes}b`;
}

/**
 * The rebuild: `docker compose -p <project> -f <files> [--project-directory <folder>] --profile runner up -d --build
 * runner-local`, with its kept settings and its limits (so the recreated container has the same ones) and an empty
 * enrollment token (its runner.json in the state volume keeps the enrollment).
 */
export function rebuildCommand(container: RunnerContainer): {
  readonly args: string[];
  readonly env: Record<string, string>;
} {
  const cpus = cpusValue(container.nanoCpus);
  const memory = memoryValue(container.memory);
  return {
    args: [
      'compose',
      '-p',
      container.project,
      ...container.files.flatMap((file) => ['-f', file]),
      ...(container.folder === null ? [] : ['--project-directory', container.folder]),
      '--profile',
      'runner',
      'up',
      '-d',
      '--build',
      RUNNER_SERVICE,
    ],
    env: {
      ...container.settings,
      MWC_ENROLL_TOKEN: '',
      ...(cpus === undefined ? {} : { MWC_RUNNER_CPUS: cpus }),
      ...(memory === undefined ? {} : { MWC_RUNNER_MEMORY: memory }),
    },
  };
}
