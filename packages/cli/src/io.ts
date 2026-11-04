import { resolve } from 'node:path';

/** What every command gets: where its output goes and where it was started. */
export interface MainIo {
  stdout(s: string): void;
  stderr(s: string): void;
  /** The directory relative paths are resolved against when `env.INIT_CWD` is not set. */
  readonly cwd: string;
  /** pnpm runs scripts from the package root and passes the caller's directory as `INIT_CWD`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The repository root: commands run their steps from here. */
export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
