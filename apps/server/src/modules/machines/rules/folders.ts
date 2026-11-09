import {
  FOLDERS_TIMEOUT_MS,
  type FolderError,
  type FsResult,
  folderErrorCode,
} from '@mwc/shared/runner-protocol';
import { type Refusal, refuse } from '../rules.ts';

/**
 * The folder browser's pure rules (S5.1d, docs/machines.md "The folder browser"): its refusals, the runner's refusal
 * codes as the API's 422s in plain words, a runner's listing with its defaults, and where agents' home folders go by
 * default on a machine.
 */

export const RUNNER_OUTDATED = refuse(
  409,
  'runner_outdated',
  "The machine's runner is older than the folder browser: update it on the Machines page",
);

export const FOLDERS_TIMED_OUT = refuse(
  504,
  'runner_timeout',
  `The machine's runner did not answer within ${FOLDERS_TIMEOUT_MS / 1000} seconds`,
);

type RunnerRefusal = Exclude<FolderError, 'unsupported'>;

/** Each runner refusal as the API's code and its words, given the runner's own (the path, mostly). */
const REFUSALS: Readonly<Record<RunnerRefusal, readonly [string, (words: string) => string]>> = {
  not_found: ['folder_not_found', (words) => `There is no folder ${words} on the machine`],
  not_a_directory: ['not_a_directory', (words) => `${words} is a file, not a folder`],
  permission_denied: ['permission_denied', (words) => `The runner's user may not open ${words}`],
  outside_volume: [
    'outside_volume',
    (words) => `A Docker runner keeps its folders in its work volume, /work (${words})`,
  ],
  exists: ['folder_exists', (words) => `${words} is there already`],
  invalid_path: ['invalid_path', (words) => `Give an absolute path, starting with / or ~/ (${words})`],
  failed: ['folder_failed', (words) => `The machine could not read the folder: ${words}`],
};

/** The runner's words without their code (`not_found: /x` reads `/x`). */
const wordsOf = (error: string | undefined) => (error ?? 'no reason given').replace(/^[a-z_]+: ?/, '');

/** A runner's refusal of `fs.list` or `fs.mkdir`: a 409 for a runner that cannot browse, else a 422 in plain words. */
export function folderRefusal(error: string | undefined): Refusal<409> | Refusal<422> {
  const code = folderErrorCode(error);
  if (code === 'unsupported') return RUNNER_OUTDATED;
  const [apiCode, words] = REFUSALS[code];
  return refuse(422, apiCode, words(wordsOf(error)));
}

/** Where agents' home folders go by default: the container's root, else `agents` in the runner user's home. */
export const agentsRootOf = (home: string, root: string | null): string =>
  root ?? `${home.replace(/\/+$/, '')}/agents`;

/** A listing as the API answers it, from a runner's `ok` `fs.result` (its missing fields at their defaults). */
export function listingOf(reply: FsResult, asked: string | null) {
  const home = reply.home ?? '/';
  const root = reply.root ?? null;
  return {
    path: reply.path ?? asked ?? root ?? home,
    parent: reply.parent ?? null,
    entries: (reply.entries ?? []).map(({ name, git, claudeMd }) => ({ name, git, claudeMd })),
    truncated: reply.truncated ?? false,
    home,
    root,
    agentsRoot: agentsRootOf(home, root),
  };
}
export type FolderListing = ReturnType<typeof listingOf>;
