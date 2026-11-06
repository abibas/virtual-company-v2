import { execFile as nodeExecFile } from 'node:child_process';

export interface RunOptions {
  /** The command is killed after this long, and its result says `timedOut`. */
  readonly timeoutMs: number;
}

/** How a command ended: its exit code (null when killed), its output, and whether it ran out of time. */
export interface RunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Runs one command with an argument array, never through a shell. It resolves whatever the exit code, and rejects
 * only when the command cannot be started, with Node's spawn error (`code: 'ENOENT'` for a tool that is not on the
 * PATH). The driver never logs what it returns.
 */
export type CommandRun = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>;

/** The short PATH the commands run with: Homebrew's (bash 4+ for the airia CLI), then the system's. */
export const DEFAULT_PATH_DIRS: readonly string[] = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

/** The variables passed through from the runner's environment: gcloud finds its sign-in under HOME. */
export const PASSED_ENV: readonly string[] = ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'CLOUDSDK_CONFIG'];

/** The most output kept from one command (a describe lists the box's scripts in its metadata). */
export const RUN_MAX_BUFFER = 8 * 1024 * 1024;

const MAX_BUFFER_CODE = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/** What `execFile`'s callback gets on failure. */
export interface ExecFileError extends Error {
  readonly code?: number | string | null | undefined;
  readonly killed?: boolean | undefined;
  readonly signal?: string | null | undefined;
}

export interface ExecFileOptions {
  readonly env: Record<string, string>;
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly encoding: 'utf8';
  readonly shell: false;
  readonly windowsHide: true;
}

/** `child_process.execFile`, as far as `processRun` uses it (injected in tests). */
export type ExecFile = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => unknown;

export interface ProcessRunOptions {
  /** Defaults to `child_process.execFile`. */
  readonly execFile?: ExecFile;
  /** Where `PASSED_ENV` is read from; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The PATH, in order; defaults to `DEFAULT_PATH_DIRS`. Add the folders of `airia` and `gcloud` when elsewhere. */
  readonly pathDirs?: readonly string[];
}

/** The environment a command gets: the short PATH, the passed variables that are set, and gcloud's prompts off. */
export function runEnv(
  source: Readonly<Record<string, string | undefined>>,
  pathDirs: readonly string[],
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: pathDirs.join(':'),
    CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
    NO_COLOR: '1',
  };
  for (const name of PASSED_ENV) {
    const value = source[name];
    if (value !== undefined && value !== '') env[name] = value;
  }
  return env;
}

/** The real `CommandRun`, on `execFile` (no shell) with `runEnv`'s environment. */
export function processRun(options: ProcessRunOptions = {}): CommandRun {
  const execFile = options.execFile ?? (nodeExecFile as unknown as ExecFile);
  const env = runEnv(options.env ?? process.env, options.pathDirs ?? DEFAULT_PATH_DIRS);
  return (command, args, { timeoutMs }) =>
    new Promise((resolve, reject) => {
      const execOptions: ExecFileOptions = {
        env,
        timeout: timeoutMs,
        maxBuffer: RUN_MAX_BUFFER,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      };
      execFile(command, [...args], execOptions, (error, stdout, stderr) => {
        if (error === null) return resolve({ exitCode: 0, stdout, stderr, timedOut: false });
        const { code } = error;
        if (typeof code === 'string' && code !== MAX_BUFFER_CODE) return reject(error);
        const timedOut = error.killed === true && code !== MAX_BUFFER_CODE;
        resolve({ exitCode: typeof code === 'number' ? code : null, stdout, stderr, timedOut });
      });
    });
}
