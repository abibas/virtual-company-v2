import { useContext } from 'react';
import type { Api } from '../client.ts';
import { ApiContext } from '../context.ts';
import { call } from '../errors.ts';
import type { AgentIconChoice } from '../types.ts';
import { clearImage, imageFile, objectUrlOf, primeImage, useVersionedImage } from './store.ts';

/**
 * Agents' icon images on screen, from the shared image store (`store.ts`): every place that shows the agent shares one
 * fetch and one URL per icon's version.
 */

const keyOf = (companyId: string, agentId: string) => `agent:${companyId}:${agentId}`;
const iconRoute = (api: Api) => api.api.companies[':companyId'].agents[':agentId'].icon;

/**
 * The agent's icon image as an object URL, or null while it loads, when its icon is not an image (`version` null or
 * undefined) or when it could not be fetched. Keyed by agent and version: a new version is fetched once and shared;
 * no version leaves the shared entry alone.
 */
export function useAgentIconImage(
  companyId: string | undefined,
  agentId: string,
  version: string | null | undefined,
): string | null {
  const api = useContext(ApiContext);
  const fetch =
    api &&
    companyId &&
    version &&
    (async () =>
      objectUrlOf(await iconRoute(api).$get({ param: { companyId, agentId }, query: { v: version } })));
  return useVersionedImage(keyOf(companyId ?? '', agentId), version, fetch || undefined, {
    keepWhenNone: true,
  });
}

/** Changing an agent's icon (admins and owners): upload an image, choose the face or an emoji. */
export function agentIconCalls(api: Api, companyId: string) {
  const route = iconRoute(api);
  return {
    /** `PUT .../icon` with the prepared bytes; the new version shows at once. */
    async upload(agentId: string, blob: Blob) {
      const { icon } = await call(
        route.$put({ param: { companyId, agentId }, form: { file: imageFile(blob, 'icon') } }),
      );
      if (icon.kind === 'image') primeImage(keyOf(companyId, agentId), icon.version, blob);
      return icon;
    },
    /** `PATCH .../icon`: the drawn face, or one emoji; any image goes. */
    async choose(agentId: string, choice: AgentIconChoice) {
      const { icon } = await call(route.$patch({ param: { companyId, agentId }, json: choice }));
      clearImage(keyOf(companyId, agentId));
      return icon;
    },
  };
}

export type AgentIconCalls = ReturnType<typeof agentIconCalls>;
