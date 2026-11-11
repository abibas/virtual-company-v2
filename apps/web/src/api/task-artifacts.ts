import type { InferResponseType } from 'hono/client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { ApiError, call } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A task's artifacts (S5.3b, `GET …/tasks/{taskId}/artifacts` and `…/{artifactId}/content`): the list without bytes,
 * read again when the task changes, and an artifact's bytes. The content route takes a bearer token only, so the bytes
 * are fetched through the client and shown from an object URL (as agent icons are), one fetch per artifact version
 * shared by its thumbnail and its viewer.
 */

type ArtifactRoutes = Api['api']['companies'][':companyId']['tasks'][':taskId']['artifacts'];
export type TaskArtifact = InferResponseType<ArtifactRoutes['$get'], 200>['artifacts'][number];

const routes = (api: Api) => api.api.companies[':companyId'].tasks[':taskId'].artifacts;

/** The calls on a company's task artifacts. */
export function artifactCalls(api: Api, companyId: string) {
  return {
    list: async (taskId: string) =>
      (await call(routes(api).$get({ param: { companyId, taskId } }))).artifacts,
    /** An artifact's bytes, as the server keeps them (its type on the blob). */
    bytes: async (taskId: string, artifactId: string): Promise<Blob> => {
      const response = await routes(api)[':artifactId'].content.$get({
        param: { companyId, taskId, artifactId },
      });
      if (!response.ok)
        throw new ApiError(response.status, 'artifact_not_found', 'The file could not be read');
      return response.blob();
    },
  };
}

/** The task's artifacts, oldest first; read again whenever `version` (the task's last change) moves. */
export function useTaskArtifacts(
  companyId: string,
  taskId: string,
  version: string,
): Loaded<readonly TaskArtifact[]> {
  const api = useApi();
  const loaded = useLoad(`task-artifacts:${companyId}:${taskId}`, () =>
    artifactCalls(api, companyId).list(taskId),
  );
  const seen = useRef(version);
  const { reload } = loaded;
  useEffect(() => {
    if (seen.current === version) return;
    seen.current = version;
    reload();
  }, [version, reload]);
  return loaded;
}

/** An object URL by artifact version: undefined while it loads, null when it failed. */
const urls = new Map<string, string | null | undefined>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The artifact's version: its id and its hash (a file collected again gets a new hash). */
export const artifactKey = (artifact: TaskArtifact) => `${artifact.id}:${artifact.sha256 ?? ''}`;

/**
 * The bytes of `artifact` as an object URL, fetched once per version with `load` while `wanted`: undefined while it
 * loads, null when it could not be read.
 */
export function useArtifactUrl(
  artifact: TaskArtifact,
  load: (artifact: TaskArtifact) => Promise<Blob>,
  wanted = true,
): string | null | undefined {
  const key = artifactKey(artifact);
  const url = useSyncExternalStore(subscribe, () => urls.get(key));
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    if (!wanted || urls.has(key)) return;
    urls.set(key, undefined);
    loader
      .current(artifact)
      .then(
        (blob) => URL.createObjectURL(blob),
        () => null,
      )
      .then((made) => {
        urls.set(key, made);
        for (const listener of listeners) listener();
      });
  }, [key, wanted, artifact]);
  return url;
}
