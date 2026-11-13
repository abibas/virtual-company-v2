import type { FolderError } from '@mwc/shared/runner-protocol';
import { type FolderScope, resolveFolder } from './paths.ts';

/**
 * How the folder frames refuse (docs/runner-protocol.md, "Folders"): a file system error's code as a folder code, a
 * refusal as `<code>: <words>`, and the path a frame names resolved or refused. Shared by the browser (`browse.ts`) and
 * the folder maker (`mkdirp.ts`).
 */

/** The folder code of a file system error. */
export function codeOf(error: unknown): FolderError {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ENOENT':
      return 'not_found';
    case 'ENOTDIR':
      return 'not_a_directory';
    case 'EACCES':
    case 'EPERM':
      return 'permission_denied';
    case 'EEXIST':
      return 'exists';
    default:
      return 'failed';
  }
}

/** A refusal of a frame: `<code>: <words>`. */
export class Refusal extends Error {
  readonly code: FolderError;

  constructor(code: FolderError, words: string) {
    super(`${code}: ${words}`);
    this.code = code;
  }
}

export const wordsOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'it failed';

/** A file system call's failure as a refusal naming `path`. */
export function refusalOf(path: string, error: unknown): Refusal {
  const code = codeOf(error);
  return new Refusal(code, code === 'failed' ? `${path}: ${wordsOf(error)}` : path);
}

/** Runs a file system call; its failure becomes a refusal naming `path`. */
export async function attempt<T>(path: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw refusalOf(path, error);
  }
}

/** The path the frame names, resolved, or a refusal. */
export function resolvePath(scope: FolderScope, input: string): string {
  const checked = resolveFolder(input, scope);
  if (!checked.ok) throw new Refusal(checked.code, checked.words);
  return checked.path;
}
