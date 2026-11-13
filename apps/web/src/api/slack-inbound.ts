import type { InferRequestType, InferResponseType } from 'hono/client';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A Slack bot sign-in's inbound settings (2026-11-13, `/api/me/subscriptions/:credentialId/slack-inbound` and
 * `slack-people`): receiving messages through Socket Mode, the app token (write-only), who may wake agents, the default
 * agent, the hourly cap, the connection's status; and a search of the workspace's people.
 */

type OneSignIn = Api['api']['me']['subscriptions'][':credentialId'];

export type SlackInbound = InferResponseType<OneSignIn['slack-inbound']['$get'], 200>;
export type SlackInboundChange = InferRequestType<OneSignIn['slack-inbound']['$put']>['json'];
export type SlackPerson = SlackInbound['people'][number];
export type SlackAgentChoice = SlackInbound['agents'][number];

const route = (api: Api) => api.api.me.subscriptions[':credentialId'];

/** The sign-in's settings. */
export function useSlackInbound(credentialId: string): Loaded<SlackInbound> {
  const api = useApi();
  return useLoad(`slack-inbound:${credentialId}`, () =>
    call(route(api)['slack-inbound'].$get({ param: { credentialId } })),
  );
}

/** Saving the settings, and searching the workspace's people. */
export function slackInboundCalls(api: Api) {
  return {
    save: (credentialId: string, change: SlackInboundChange) =>
      call(route(api)['slack-inbound'].$put({ param: { credentialId }, json: change })),
    people: (credentialId: string, q: string) =>
      call(route(api)['slack-people'].$get({ param: { credentialId }, query: { q } })),
  };
}
