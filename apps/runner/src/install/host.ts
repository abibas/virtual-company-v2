/**
 * The machine as the runner's own commands see it (`enroll`, `install`, `status`, `uninstall`, and a container's first
 * start): its environment, files, process starts and HTTP. `install/system.ts` is the real one; tests pass a temporary
 * home with a fake `exec` and `fetch`. The Mac's security agent bills every process start, so these commands start
 * few: one `claude --version`, and the service manager's own commands.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** How a process ended: its exit code (null when it did not start or was killed), its output, and why it failed. */
export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not start or did not end by itself. */
  readonly error?: string;
}

export interface ExecOptions {
  /** The child's whole environment; the command's own by default. */
  readonly env?: Env;
}

/** The files the commands read and write. */
export interface HostFs {
  exists(path: string): boolean;
  /** A file the user may execute (a program on `PATH`). */
  isExecutable(path: string): boolean;
  readFile(path: string): string;
  /** A file's bytes (the runner hashes its own bundle). */
  readBytes(path: string): Uint8Array;
  /** Writes `text` to `path` with `mode`, replacing the file; its folder must exist. */
  writeFile(path: string, text: string, mode: number): void;
  /** Writes bytes to `path` as a new file with `mode`; one there already is an error (a self-update's temporary files). */
  writeBytes(path: string, bytes: Uint8Array, mode: number): void;
  /** Renames a file or a folder over `to`, atomically on one file system. */
  rename(from: string, to: string): void;
  /** Copies a file over `to`, which then has mode 0644. */
  copyFile(from: string, to: string): void;
  /** Copies a folder and everything in it to `to` (made), keeping the files' modes. */
  copyTree(from: string, to: string): void;
  /** Makes a folder and its parents; new ones get `mode`. */
  mkdir(path: string, mode: number): void;
  /** Removes a file or a folder with everything in it; a missing one is fine. */
  remove(path: string): void;
}

export interface Host {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Node's own path (`process.execPath`): the service runs the runner with it. */
  readonly execPath: string;
  /** The script this process runs (`process.argv[1]`): the bundle `install` copies. */
  readonly selfPath: string;
  /** The user's id (`launchctl bootstrap gui/<uid>`, `/run/user/<uid>`). */
  readonly uid: number;
  /** This runner's version. */
  readonly version: string;
  hostname(): string;
  homedir(): string;
  /** The Unix user's name; throws when the uid has no name (a container's arbitrary uid). */
  username(): string;
  readonly fs: HostFs;
  /** Starts a program by its path or name and waits for it; never throws. */
  exec(file: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Waits (between two tries of a service manager's command). */
  sleep(ms: number): Promise<void>;
  /** What the command says to the person who ran it. */
  out(text: string): void;
  err(text: string): void;
}

/** A command's failure: what to say, and the exit code (sysexits where one fits, as `start.ts`'s `EXIT`). */
export class CommandError extends Error {
  override readonly name = 'CommandError';
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

/** The home folder: `HOME`, else the system's. */
export const homeOf = (host: Host): string => host.env.HOME || host.homedir();

/** The Unix user's name: the system's, else `USER`, else `uid-<n>` (a container's uid without a name). */
export function unixUser(host: Host): string {
  try {
    return host.username();
  } catch {
    return host.env.USER || `uid-${host.uid}`;
  }
}

/** A failed command in a few words: the last line it printed on stderr, else why it did not run, else its code. */
export function failure(result: ExecResult): string {
  const said = result.stderr.trim().split('\n').at(-1);
  if (said) return said;
  return result.error ?? `exit code ${result.code}`;
}
