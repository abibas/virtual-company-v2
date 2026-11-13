import type { GitHubApi } from '@mwc/tools-core';
import { githubHttp, type HttpOptions } from './http.ts';
import { pullsApi } from './pulls.ts';
import { reposApi } from './repos.ts';

/**
 * The GitHub connector (S7.1d): `@mwc/tools-core`'s `GitHubApi` over `api.github.com`, through the injected `fetch` with
 * its retries and deadlines (`http.ts`). The server wires it in `app.ts` with its provider client, so tests pass a fake
 * and nothing reaches GitHub.
 */
export function githubClient(options: HttpOptions): GitHubApi {
  const request = githubHttp(options);
  return { ...pullsApi(request), ...reposApi(request) };
}
