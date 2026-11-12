import type { AiProvider } from '@mwc/shared/enums';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import type {
  AccessProfile,
  AccessProfileChanges,
  LimitsList,
  NewAccessProfile,
  NewSubscription,
  NewToolSignIn,
  SignInProvider,
  Subscription,
} from './types.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The signed-in person's own subscriptions, sign-ins, limits and access profiles (`/api/me/...`). Personal, never a
 * company's, and managed only with a Clerk session (an API key is refused). Answers carry metadata, never a secret.
 */

/** The person's subscriptions, oldest first. */
export function useSubscriptions(): Loaded<{ readonly subscriptions: readonly Subscription[] }> {
  const api = useApi();
  return useLoad('subscriptions', () => call(api.api.me.subscriptions.$get()));
}

export interface LiveLimits extends Loaded<LimitsList> {
  /** A refresh the person asked for is on its way. */
  readonly refreshing: boolean;
  /** Asks the providers again now (`?refresh=1`; the server checks each subscription at most once a minute). */
  refresh(): void;
}

/** How often an open, visible page asks again; the server's floor for the logins' usage APIs is the same. */
export const LIMITS_EVERY_MS = 3 * 60_000;
/** How long after a window's reset the page asks again, so the provider has the new window by then. */
const AFTER_RESET_MS = 30_000;
/** The server checks a subscription at most once a minute, so asking sooner after the last answer brings nothing new. */
const SERVER_CAP_MS = 61_000;

/**
 * How long until the next automatic refresh: 3 minutes after the last answer, or sooner, about 30 seconds after the
 * first window that resets after that answer (never within the server's minute).
 */
export function nextRefreshIn(data: LimitsList | undefined, lastAnswerAt: number, now: number): number {
  let at = lastAnswerAt + LIMITS_EVERY_MS;
  for (const window of (data?.limits ?? []).flatMap((item) => item.windows)) {
    const resetsAt = window.resetsAt === null ? Number.NaN : new Date(window.resetsAt).getTime();
    if (resetsAt > lastAnswerAt)
      at = Math.min(at, Math.max(resetsAt + AFTER_RESET_MS, lastAnswerAt + SERVER_CAP_MS));
  }
  return Math.max(0, at - now);
}

/**
 * Keeps the limits fresh while the page is visible: the next refresh from `nextRefreshIn`, paused while the tab is
 * hidden, and at once when it shows again after more than 3 minutes away.
 */
function useAutoRefresh(
  data: LimitsList | undefined,
  loading: boolean,
  lastAnswerAt: { readonly current: number },
  ask: () => void,
) {
  useEffect(() => {
    if (loading) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = document.hidden ? Date.now() : null;
    const schedule = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(ask, nextRefreshIn(data, lastAnswerAt.current, Date.now()));
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        clearTimeout(timer);
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > LIMITS_EVERY_MS) ask();
      else schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [data, loading, lastAnswerAt, ask]);
}

/**
 * The limits of the person's subscriptions: the server's answer on load, again on their own while the page is visible
 * (`useAutoRefresh`), and on request (the button). Both go through the same loader and request; the automatic one
 * leaves out `?refresh=1`, since a plain request already checks what is past its floor or reset, and a forced one
 * would probe a setup-token every 3 minutes, spending its usage. Only the button shows it spinning.
 */
export function useSubscriptionLimits(): LiveLimits {
  const api = useApi();
  const wanted = useRef(false);
  const lastAnswerAt = useRef(Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const loaded = useLoad('subscription-limits', async () => {
    const refresh = wanted.current;
    wanted.current = false;
    try {
      return await call(api.api.me.subscriptions.limits.$get({ query: refresh ? { refresh: '1' } : {} }));
    } finally {
      lastAnswerAt.current = Date.now();
      if (refresh) setRefreshing(false);
    }
  });
  const { reload } = loaded;
  const refresh = useCallback(() => {
    wanted.current = true;
    setRefreshing(true);
    reload();
  }, [reload]);
  useAutoRefresh(loaded.data, loaded.loading, lastAnswerAt, reload);
  return { ...loaded, refreshing, refresh };
}

/** The person's access profiles, Claude's and OpenAI's, each with its subscription, gateway and the agents using it. */
export function useAccessProfiles(): Loaded<{ readonly profiles: readonly AccessProfile[] }> {
  const api = useApi();
  return useLoad('access-profiles', () => call(api.api.me['access-profiles'].$get()));
}

/** The person's changes to their subscriptions: add a pasted one, rename, remove, the sign-ins and the tool sign-ins. */
export function subscriptionCalls(api: Api) {
  const subscriptions = api.api.me.subscriptions;
  const one = subscriptions[':credentialId'];
  const signIn = subscriptions['sign-in'];
  return {
    list: () => call(subscriptions.$get()),
    add: (subscription: NewSubscription) => call(subscriptions.$post({ json: subscription })),
    rename: (credentialId: string, label: string) =>
      call(one.$patch({ param: { credentialId }, json: { label } })),
    remove: (credentialId: string) => call(one.$delete({ param: { credentialId } })),
    /** Starts a sign-in; with `credentialId` (Sign in again), it renews that subscription in place. */
    startSignIn: (provider: SignInProvider, credentialId?: string) =>
      call(signIn.$post({ json: credentialId === undefined ? { provider } : { provider, credentialId } })),
    signIn: (signInId: string) => call(signIn[':signInId'].$get({ param: { signInId } })),
    sendCode: (signInId: string, code: string) =>
      call(signIn[':signInId'].code.$post({ param: { signInId }, json: { code } })),
    cancelSignIn: (signInId: string) => call(signIn[':signInId'].$delete({ param: { signInId } })),
    /** Adds a GitHub token or an Atlassian sign-in once its provider accepts it; with `credentialId`, renews that one. */
    addTool: (body: NewToolSignIn) => call(subscriptions.tools.$post({ json: body })),
    /** Check again: asks GitHub or Atlassian now. */
    checkTool: (credentialId: string) => call(one.check.$post({ param: { credentialId } })),
  };
}

export type SubscriptionCalls = ReturnType<typeof subscriptionCalls>;

/** The person's changes to their access profiles, and their default of each provider in a company. */
export function profileCalls(api: Api) {
  const profiles = api.api.me['access-profiles'];
  return {
    create: (profile: NewAccessProfile) => call(profiles.$post({ json: profile })),
    update: (profileId: string, changes: AccessProfileChanges) =>
      call(profiles[':profileId'].$patch({ param: { profileId }, json: changes })),
    remove: (profileId: string) => call(profiles[':profileId'].$delete({ param: { profileId } })),
    setDefault: (companyId: string, provider: AiProvider, profileId: string | null) =>
      call(
        api.api.companies[':companyId'].me['default-profile'].$put({
          param: { companyId },
          json: { provider, profileId },
        }),
      ),
  };
}

export type ProfileCalls = ReturnType<typeof profileCalls>;
