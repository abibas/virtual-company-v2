import type { AtlassianApi } from '@mwc/tools-core';
import { confluenceApi } from './confluence.ts';
import { atlassianHttp, type HttpOptions } from './http.ts';
import { jiraApi } from './jira.ts';

/**
 * The Atlassian connector (S7.1c): `@mwc/tools-core`'s `AtlassianApi` over Jira's REST API v3 and Confluence's v2,
 * through the injected `fetch` with its retries and deadlines (`http.ts`). The server wires it in `app.ts` with its
 * provider client, so tests pass a fake and nothing reaches Atlassian.
 */
export function atlassianClient(options: HttpOptions): AtlassianApi {
  const request = atlassianHttp(options);
  return { ...jiraApi(request), ...confluenceApi(request) };
}
