import type { InferRequestType, InferResponseType } from 'hono/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call, friendlyMessage } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * A Slack bot sign-in's inbound settings (2026-11-13, `/api/me/subscriptions/:credentialId/slack-inbound` and
 * `slack-people`): receiving messages through Socket Mode, the app token (write-only), who may wake agents, the default
 * agent, the hourly cap, the connection's status; and a search of the workspace's people, from the directory the
 * server keeps (loaded once in the background: the search says while it loads, and asks again until it has).
 */

type OneSignIn = Api['api']['me']['subscriptions'][':credentialId'];

export type SlackInbound = InferResponseType<OneSignIn['slack-inbound']['$get'], 200>;
export type SlackInboundChange = InferRequestType<OneSignIn['slack-inbound']['$put']>['json'];
export type SlackPerson = SlackInbound['people'][number];
export type SlackAgentChoice = SlackInbound['agents'][number];
export type SlackPeopleAnswer = InferResponseType<OneSignIn['slack-people']['$get'], 200>;
export type SlackFound = SlackPeopleAnswer['people'][number];

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
      call(route(api)['slack-people'].$get({ param: { credentialId }, query: q === '' ? {} : { q } })),
    reloadPeople: (credentialId: string) =>
      call(route(api)['slack-people'].refresh.$post({ param: { credentialId } })),
  };
}

/** How long the search waits after the last key, and between asks while the directory loads. */
const SEARCH_DELAY_MS = 150;
const LOADING_POLL_MS = 800;

/** The answer for some words. */
interface Searched {
  readonly q: string;
  readonly answer: SlackPeopleAnswer;
}

/**
 * The workspace's people matching `words`, once `warm` is true (the field has had focus): the latest answer and the
 * words it is for, a request in flight, the last failure, and a reload of the directory. Asks 150 ms after the last
 * key, and again every 800 ms while the server's directory is still loading.
 */
export function useSlackPeopleSearch(credentialId: string, words: string, warm: boolean) {
  const api = useApi();
  const calls = useMemo(() => slackInboundCalls(api), [api]);
  const [searched, setSearched] = useState<Searched>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const q = words.trim();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tick asks again while the directory loads.
  useEffect(() => {
    if (!warm) return;
    const id = ++latest.current;
    const timer = setTimeout(() => {
      setBusy(true);
      calls.people(credentialId, q).then(
        (answer) => {
          if (id !== latest.current) return;
          setSearched({ q, answer });
          setError(undefined);
          setBusy(false);
        },
        (failure: unknown) => {
          if (id !== latest.current) return;
          setError(friendlyMessage(failure));
          setBusy(false);
        },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [calls, credentialId, q, warm, tick]);

  const loading = searched?.answer.loading === true;
  useEffect(() => {
    if (!loading || busy) return;
    const timer = setTimeout(() => setTick((n) => n + 1), LOADING_POLL_MS);
    return () => clearTimeout(timer);
  }, [loading, busy]);

  const reload = () => {
    setBusy(true);
    calls.reloadPeople(credentialId).then(
      (answer) => {
        setSearched({ q: '', answer });
        setBusy(false);
        setTick((n) => n + 1);
      },
      (failure: unknown) => {
        setError(friendlyMessage(failure));
        setBusy(false);
      },
    );
  };

  return { searched, busy, error, reload };
}
