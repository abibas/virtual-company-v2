import type { LoginHelperMode } from '@mwc/shared/config';

/**
 * The sign-in helper's port (docs/subscriptions.md, "The sign-in helper"): it runs one official CLI login (Claude
 * Code's, Codex's) in an isolated sandbox that is thrown away afterwards, and lets the credentials module talk to it:
 * the CLI's output as it comes, typing into its terminal, reading the files it leaves in its home, and killing it. A
 * sandbox gets no mounts and no credentials from the host: its home starts empty. `docker.ts` and `local.ts` are the
 * two helpers, `select.ts` picks one from MWC_LOGIN_HELPER, and tests use a fake that replays scripted output.
 */

/** How the CLI stopped: its exit code (null when it was killed), or why it could not run at all. */
export interface SandboxExit {
  readonly code: number | null;
  /** Set when the process never ran: plain words for the person signing in, never output or a path. */
  readonly error?: string;
}

/** One CLI login running in its sandbox. Its output can carry secrets (a pasted code is echoed): never log it. */
export interface LoginSandbox {
  /** Every chunk the CLI writes to its terminal, as text; chunks written before the first listener are kept for it. */
  onOutput(listener: (chunk: string) => void): void;
  /** Called once when the CLI stops; a listener added later is called at once. */
  onExit(listener: (exit: SandboxExit) => void): void;
  /** Types into the CLI's terminal (a carriage return presses Enter); dropped once the CLI has stopped. */
  write(input: string): void;
  /** A file under the sandbox's home (`.claude/.credentials.json`), as text; undefined when it is not there. */
  readFile(path: string): Promise<string | undefined>;
  /** Stops the CLI and deletes the sandbox with everything in it. Calling it again returns the same promise. */
  kill(): Promise<void>;
}

/** The login to run: the CLI and its arguments, never typed in by a person. */
export interface LoginCommand {
  readonly argv: readonly string[];
}

/** Starts sandboxes: a throwaway container (`docker`) or a private temporary folder (`local`). */
export interface LoginHelper {
  readonly mode: Exclude<LoginHelperMode, 'none'>;
  start(command: LoginCommand): Promise<LoginSandbox>;
}

/** A sandbox that could not be made or started, in plain words for the person signing in. */
export class LoginHelperError extends Error {
  override readonly name = 'LoginHelperError';
}

/** A path under the sandbox's home: relative, with no `.` or `..` part and nothing a shell or `cat` would read as more. */
const HOME_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/;

/** Checks a path under the home; anything else (absolute, `..`, odd characters) is a programming error. */
export function homePath(path: string): string {
  if (!HOME_PATH.test(path)) throw new RangeError('A sandbox file is a plain path under its home');
  return path;
}
