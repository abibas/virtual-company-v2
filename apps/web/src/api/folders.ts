import { useCallback, useMemo, useRef, useState } from 'react';
import { useApi } from './context.ts';
import { ApiError } from './errors.ts';
import { machineCalls } from './machines.ts';
import type { FolderList } from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A machine's folders as its runner reads them (docs/machines.md, "The folder browser"): the default start with the
 * runner's home and where agents go (for the suggested home folder), and the browser's state: the folder shown, going to
 * another, and making a new one in it.
 */

/** The runner's default start of a machine (its home, and where agents' home folders go); null while not wanted. */
export function useFolderStart(
  companyId: string,
  machineId: string,
  wanted: boolean,
): Loaded<FolderList | null> {
  const api = useApi();
  return useLoad(`folder-start:${companyId}:${machineId}:${wanted}`, () =>
    wanted && machineId !== '' ? machineCalls(api, companyId).folders(machineId) : Promise.resolve(null),
  );
}

/**
 * Whether a saved home folder is missing on its machine (2026-11-13): false when the runner lists it, true when it says
 * there is no such folder (`folder_not_found`), undefined while not wanted or when it cannot tell (offline, an old
 * runner). `create` makes it with its parents (`POST …/folders`, `parents`) and asks again.
 */
export function useFolderMissing(
  companyId: string,
  machineId: string,
  path: string,
  wanted: boolean,
): { readonly missing: boolean | undefined; create(): Promise<void> } {
  const api = useApi();
  const calls = useMemo(() => machineCalls(api, companyId), [api, companyId]);
  const asked = useLoad(`folder-missing:${companyId}:${machineId}:${path}:${wanted}`, () =>
    wanted
      ? calls.folders(machineId, path).then(
          () => false,
          (error: unknown) =>
            error instanceof ApiError && error.code === 'folder_not_found' ? true : undefined,
        )
      : Promise.resolve(undefined),
  );
  return {
    missing: asked.data,
    create: async () => {
      await calls.makeFolder(machineId, path, true);
      asked.reload();
    },
  };
}

export interface FolderBrowserState {
  /** The folder shown, once one loaded. */
  readonly listing: FolderList | undefined;
  /** Why the last move failed. */
  readonly error: unknown;
  readonly loading: boolean;
  /** Shows the folder `path` (the runner's default start when left out). */
  go(path?: string): Promise<void>;
  /** Shows the first of `paths` that lists (a 422 tries the next), then the default start. */
  openAt(paths: readonly string[]): Promise<void>;
  /** Makes `path` and shows it; throws the refusal (shown by the form). */
  make(path: string): Promise<void>;
}

/** The folder browser of one machine: only the latest move's answer is kept. */
export function useFolderBrowser(companyId: string, machineId: string): FolderBrowserState {
  const api = useApi();
  const calls = useMemo(() => machineCalls(api, companyId), [api, companyId]);
  const [listing, setListing] = useState<FolderList>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  const show = useCallback(
    async (paths: readonly (string | undefined)[]) => {
      const move = ++latest.current;
      setLoading(true);
      setError(undefined);
      let failure: unknown;
      for (const path of paths) {
        try {
          const next = await calls.folders(machineId, path);
          if (move === latest.current) setListing(next);
          failure = undefined;
          break;
        } catch (refusal) {
          failure = refusal;
          if (!(refusal instanceof ApiError && refusal.status === 422)) break;
        }
      }
      if (move !== latest.current) return;
      setError(failure);
      setLoading(false);
    },
    [calls, machineId],
  );

  return {
    listing,
    error,
    loading,
    go: (path) => show([path]),
    openAt: (paths) => show([...paths, undefined]),
    make: async (path) => {
      const made = await calls.makeFolder(machineId, path);
      await show([made.path]);
    },
  };
}
